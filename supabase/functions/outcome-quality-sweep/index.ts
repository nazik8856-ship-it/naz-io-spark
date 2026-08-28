// Scheduled (pg_cron, daily): "knowledge & autonomy" plan item 5 --
// automatically pulls an API key's on_uncertain policy back toward
// caution when its own auto-resolved (never-escalated) decisions have
// measurably negative real-world outcomes, not just when the key
// BEHAVES badly (abuse volume, callback failures -- both already
// covered by control-api-abuse-sweep's own downgrade trigger, item 4 of
// the prior round). Reuses the exact same downgrade mechanics
// (policy-downgrade.ts, the on_uncertain_downgraded_at/_reason columns,
// the "on_uncertain_auto_downgraded" alert/incident kind) that sweep
// already established -- this only adds a new TRIGGER condition, never
// a second downgrade mechanism.
//
// A daily cadence, not the 15-minute abuse-sweep cadence: real business
// outcomes take real time to measure (decision_outcomes is populated by
// a separate, unscheduled sweep), so there's nothing new to see between
// runs much faster than that.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isBadOutcomeTrouble, summarizePolicyDowngrade } from "../_shared/policy-downgrade.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { openIncident } from "../_shared/incidents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Wide enough to gather a real, meaningful sample of measured outcomes
// (which is sparse coverage by nature -- see precedent-search.ts's own
// loadOutcomeDirections comment) without judging a key on ancient history.
const LOOKBACK_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  // Same nested-select join pattern calibrate-confidence already uses
  // (decision_outcomes -> agent_decisions!inner) -- "autonomous" is the
  // same escalated=false definition roi-report.ts and last round's
  // decision-consistency check already established, not a new one.
  const { data, error } = await admin
    .from("decision_outcomes")
    .select("direction, agent_decisions!inner(api_key_id, user_id, escalated, created_at)")
    .not("agent_decisions.api_key_id", "is", null)
    .eq("agent_decisions.escalated", false)
    .gte("agent_decisions.created_at", since)
    .limit(20000);
  if (error) return json({ error: error.message }, 500);

  type Row = { direction: string; agent_decisions: { api_key_id: string; user_id: string } | null };
  type KeyTotals = { userId: string; total: number; negative: number };
  const byKey = new Map<string, KeyTotals>();
  for (const r of (data ?? []) as Row[]) {
    const dec = r.agent_decisions;
    if (!dec?.api_key_id) continue;
    const dir = String(r.direction || "").toLowerCase();
    if (dir !== "negative" && dir !== "positive") continue; // neutral/unknown carry no signal either way
    const totals = byKey.get(dec.api_key_id) ?? { userId: dec.user_id, total: 0, negative: 0 };
    totals.total += 1;
    if (dir === "negative") totals.negative += 1;
    byKey.set(dec.api_key_id, totals);
  }

  const downgraded: string[] = [];
  for (const [apiKeyId, totals] of byKey.entries()) {
    if (!isBadOutcomeTrouble(totals.negative, totals.total)) continue;

    const { data: keyRow } = await admin
      .from("api_keys")
      .select("key_prefix, on_uncertain_downgraded_at")
      .eq("id", apiKeyId)
      .maybeSingle();
    const key = keyRow as { key_prefix?: string; on_uncertain_downgraded_at?: string | null } | null;
    if (key?.on_uncertain_downgraded_at) continue; // already downgraded -- don't re-alert on the same standing condition

    const ratePct = `${Math.round((totals.negative / totals.total) * 100)}%`;
    const summary = summarizePolicyDowngrade("bad_outcomes", ratePct);
    try {
      const now = new Date().toISOString();
      const { error: updErr } = await admin.from("api_keys").update({
        on_uncertain: "human_review",
        on_uncertain_downgraded_at: now,
        on_uncertain_downgrade_reason: summary,
      }).eq("id", apiKeyId);
      if (updErr) { console.error(`[OUTCOME QUALITY SWEEP] failed to downgrade ${apiKeyId}: ${updErr.message}`); continue; }
      downgraded.push(apiKeyId);
      await sendCriticalAlert(admin, totals.userId, { event: "on_uncertain_auto_downgraded", summary });
      await openIncident(admin, totals.userId, { kind: "on_uncertain_auto_downgraded", summary });
    } catch (e) {
      console.error(`[OUTCOME QUALITY SWEEP] downgrade failed for ${apiKeyId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({ ok: true, keys_scanned: byKey.size, keys_downgraded: downgraded.length, downgraded });
});
