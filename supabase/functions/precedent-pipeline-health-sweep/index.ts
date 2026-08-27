// "Real precedent memory" plan, item 14: scheduled sweep (pg_cron) that
// notices when an api key's real-precedent memory has quietly stopped
// growing -- real decisions keep flowing in, but hardly any of them are
// getting embedded (a bug, a provider change, the spend cap silently
// eating every call). Nothing about any single decision looks wrong in
// the moment, so without this nobody would notice until the account's
// automation had been running blind on stale/empty memory for weeks.
//
// Same "notice quietly-stopped-working, alert once, clear on recovery"
// shape already proven by integration-revocation-sweep and
// auto-resolution-share-sweep, applied here to the embedding pipeline
// per api key rather than per integration/account.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  summarizeEmbeddingCoverage, isEmbeddingPipelineStale, summarizeStalePipeline, type DecisionRow,
} from "../_shared/precedent-pipeline-health.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { openIncident } from "../_shared/incidents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RECENT_WINDOW_DAYS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const windowStart = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: decisionRows, error } = await admin
    .from("agent_decisions")
    .select("id, user_id, api_key_id")
    .not("api_key_id", "is", null)
    .gte("created_at", windowStart);
  if (error) return json({ error: error.message }, 500);

  const decisions = (decisionRows ?? []) as { id: string; user_id: string; api_key_id: string }[];
  const userIdByKey = new Map(decisions.map((d) => [d.api_key_id, d.user_id]));

  // Windowed against the decisions above, NOT against embeddings created
  // in this same window -- a backfilled row's own created_at is long
  // after the original decision's, so windowing both sides identically
  // would make a healthy backfill look like a broken live pipeline.
  const { data: embeddedRows } = decisions.length
    ? await admin.from("decision_embeddings").select("decision_id").in("decision_id", decisions.map((d) => d.id))
    : { data: [] };
  const embeddedIds = ((embeddedRows ?? []) as { decision_id: string }[]).map((r) => r.decision_id);

  const coverage = summarizeEmbeddingCoverage(decisions as DecisionRow[], embeddedIds);
  const checkedKeyIds = new Set(coverage.map((c) => c.apiKeyId));

  let alerted = 0;
  let cleared = 0;

  for (const row of coverage) {
    const userId = userIdByKey.get(row.apiKeyId);
    if (!userId) continue;

    const { data: keyRow } = await admin
      .from("api_keys").select("embedding_pipeline_alerted_at").eq("id", row.apiKeyId).maybeSingle();
    const alreadyAlerted = !!(keyRow as { embedding_pipeline_alerted_at?: string | null } | null)?.embedding_pipeline_alerted_at;
    const stale = isEmbeddingPipelineStale(row);

    if (stale && !alreadyAlerted) {
      const summary = summarizeStalePipeline(row, RECENT_WINDOW_DAYS);
      try {
        await sendCriticalAlert(admin, userId, { event: "precedent_pipeline_stale", summary });
        const { error: updErr } = await admin
          .from("api_keys").update({ embedding_pipeline_alerted_at: new Date().toISOString() }).eq("id", row.apiKeyId);
        if (updErr) console.error(`[PRECEDENT PIPELINE HEALTH SWEEP] failed to stamp ${row.apiKeyId}: ${updErr.message}`);
        else {
          alerted++;
          await openIncident(admin, userId, { kind: "precedent_pipeline_stale", summary });
        }
      } catch (e) {
        console.error(`[PRECEDENT PIPELINE HEALTH SWEEP] alert failed for ${row.apiKeyId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (!stale && alreadyAlerted) {
      const { error: clearErr } = await admin
        .from("api_keys").update({ embedding_pipeline_alerted_at: null }).eq("id", row.apiKeyId);
      if (!clearErr) cleared++;
    }
  }

  // Same reasoning as auto-resolution-share-sweep's own second pass: a
  // key that was flagged and then sent zero recent decisions at all
  // (dormant, revoked, whatever) never appears in `coverage` above, so
  // it would otherwise stay "alerted" forever. No traffic to judge is,
  // by definition, not a broken pipeline.
  const { data: flaggedKeys } = await admin
    .from("api_keys").select("id").not("embedding_pipeline_alerted_at", "is", null);
  for (const row of (flaggedKeys ?? []) as { id: string }[]) {
    if (checkedKeyIds.has(row.id)) continue;
    const { error: clearErr } = await admin
      .from("api_keys").update({ embedding_pipeline_alerted_at: null }).eq("id", row.id);
    if (!clearErr) cleared++;
  }

  return json({ ok: true, keysChecked: coverage.length, alerted, cleared });
});
