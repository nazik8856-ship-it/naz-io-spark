// Scheduled (pg_cron, daily): "knowledge & autonomy" plan item 3 --
// auto-drafts a knowledge-base entry, ALWAYS disabled and pending
// review, from a strong recurring override-reason pattern (a human
// keeps resolving the same shape of escalated decision for the same
// structured reason). See knowledge-base-auto-draft.ts for the
// detection logic.
//
// A drafted entry is a completely normal knowledge_base_entries insert
// -- the exact same shape a human's own entry would have, just with
// enabled=false/pending_review=true/auto_drafted=true (see the
// migration) -- so it changes nothing live and needs no dual-control
// approval (nothing here is a deterministic block/allow rule). The
// existing log_knowledge_base_entries_changes trigger already records
// every insert into config_changes regardless of actor, and this
// sweep's service-role insert has no auth.uid() -- so a drafted entry
// shows up with a null actor_id, distinguishing it from a human-
// authored one for free, no extra column needed (same reasoning as
// last round's rule-auto-draft-sweep).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectRecurringReasonPatterns, draftKnowledgeBaseEntryFromPattern, type ReasonCodedResolution } from "../_shared/knowledge-base-auto-draft.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Same order of magnitude as rule-auto-draft-sweep's own lookback -- a
// recurring pattern worth drafting guidance from should be a recent
// habit, not ancient history.
const LOOKBACK_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await admin
    .from("pending_approvals")
    .select("user_id, action_type, provider, reason_code")
    .not("reason_code", "is", null)
    .gte("resolved_at", since)
    .limit(20000);
  if (error) return json({ error: error.message }, 500);

  type Row = { user_id: string; action_type: string; provider: string | null; reason_code: string | null };
  const byUser = new Map<string, ReasonCodedResolution[]>();
  for (const r of (data ?? []) as Row[]) {
    if (!r.user_id || !r.action_type) continue;
    const rows = byUser.get(r.user_id) ?? [];
    rows.push({ action_type: r.action_type, provider: r.provider, reason_code: r.reason_code });
    byUser.set(r.user_id, rows);
  }

  const drafted: { user_id: string; action_type: string; provider: string | null; reason_code: string; sample_size: number }[] = [];
  const draftedThisRun = new Set<string>();

  for (const [userId, rows] of byUser.entries()) {
    for (const pattern of detectRecurringReasonPatterns(rows)) {
      const dedupeKey = `${userId}::${pattern.action_type}::${pattern.provider ?? ""}`;
      if (draftedThisRun.has(dedupeKey)) continue;

      // Never draft a duplicate for a shape that already has ANY
      // knowledge-base entry (live or still-pending-review) covering it
      // -- a human either already wrote real guidance for this, or
      // already has a draft of their own to review.
      let existingQuery = admin.from("knowledge_base_entries").select("id").eq("user_id", userId).eq("action_type_pattern", pattern.action_type).limit(1);
      existingQuery = pattern.provider ? existingQuery.eq("provider", pattern.provider) : existingQuery.is("provider", null);
      const { data: existing } = await existingQuery;
      if (existing && existing.length) continue;

      const draft = draftKnowledgeBaseEntryFromPattern(pattern);
      const { error: insertErr } = await admin.from("knowledge_base_entries").insert({
        user_id: userId,
        entry_text: draft.entry_text,
        action_type_pattern: draft.action_type_pattern,
        provider: draft.provider,
        enabled: draft.enabled,
        pending_review: draft.pending_review,
        auto_drafted: draft.auto_drafted,
      });
      if (!insertErr) {
        draftedThisRun.add(dedupeKey);
        drafted.push({ user_id: userId, action_type: pattern.action_type, provider: pattern.provider, reason_code: pattern.reason_code, sample_size: pattern.sample_size });
      }
    }
  }

  return json({ ok: true, accounts_scanned: byUser.size, entries_drafted: drafted.length, drafted });
});
