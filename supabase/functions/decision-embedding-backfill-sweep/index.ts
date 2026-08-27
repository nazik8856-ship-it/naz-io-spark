// "Real precedent memory" plan, item 2: scheduled sweep (pg_cron) that
// catches up any external-api decision still missing an embedding --
// old (predates item 1's live pipeline) or freshly failed (a transient
// provider hiccup on the live path), no distinction between the two.
// Same shape as retention-sweep/audit-integrity-sweep. Bounded to one
// batch per run, oldest-first, so a single invocation never tries an
// account's entire history (or exhausts an embedding-provider rate
// limit) at once.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildBackfillEmbeddingInput, generateEmbedding, formatEmbeddingLiteral, type BackfillableDecisionRow } from "../_shared/decision-embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH_SIZE = 100;

type Row = BackfillableDecisionRow & { id: string; user_id: string; api_key_id: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: candidates, error } = await admin
    .from("agent_decisions")
    .select("id, user_id, api_key_id, action_type, provider, description, params, decision, reasoning")
    .not("api_key_id", "is", null)
    .is("embedding_backfill_checked_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) return json({ error: error.message }, 500);

  const rows = (candidates ?? []) as Row[];
  if (!rows.length) return json({ ok: true, checked: 0, embedded: 0, already_embedded: 0 });

  // A row this batch touches might already have a real embedding from
  // the live path (item 1) -- never re-embed it (decision_id is UNIQUE
  // on decision_embeddings) or waste an API call on it, just advance
  // its cursor below like every other row in this batch.
  const { data: existing } = await admin
    .from("decision_embeddings")
    .select("decision_id")
    .in("decision_id", rows.map((r) => r.id));
  const alreadyEmbedded = new Set(((existing ?? []) as { decision_id: string }[]).map((r) => r.decision_id));

  let embedded = 0;
  let alreadyEmbeddedCount = 0;
  for (const row of rows) {
    if (alreadyEmbedded.has(row.id)) {
      alreadyEmbeddedCount++;
    } else {
      const text = buildBackfillEmbeddingInput(row);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        const { error: insErr } = await admin.from("decision_embeddings").insert({
          user_id: row.user_id,
          decision_id: row.id,
          api_key_id: row.api_key_id,
          action_type: row.action_type ?? "unknown",
          provider: row.provider ?? "unknown",
          embedding: formatEmbeddingLiteral(embedding),
        });
        if (!insErr) embedded++;
      }
    }
    // Stamped regardless of outcome -- advances the cursor either way,
    // so a row whose embedding genuinely failed is never retried
    // forever by this sweep (same "best-effort enrichment, never a
    // guaranteed or required step" posture as embedDecisionIfExternal
    // itself).
    try {
      await admin.from("agent_decisions").update({ embedding_backfill_checked_at: new Date().toISOString() }).eq("id", row.id);
    } catch { /* a missed cursor stamp just means this row is reconsidered next run -- never worse than that */ }
  }

  return json({ ok: true, checked: rows.length, embedded, already_embedded: alreadyEmbeddedCount });
});
