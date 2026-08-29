// "Zero human review" plan, item 14: scheduled sweep (pg_cron) warning an
// account when a sharply higher-than-normal share of its resolved
// decisions are suddenly being auto-resolved with no human review --
// once items 1/2/4 exist, an account could set a policy that's quietly
// too permissive and never find out, because by definition nobody's
// watching each individual decision anymore.
//
// Compares a recent 24h window against the preceding 14-day baseline
// (excluding the recent window itself, so a fresh spike doesn't dilute
// or inflate its own comparison point) -- same shape as
// control-api-abuse-sweep's own recent-window classification, applied to
// a ratio across ALL of an account's pending_approvals (both api-key- and
// human-driven), not one key's raw call volume.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  summarizeResolutionActivity, detectAutoResolutionShareSpike, summarizeAutoResolutionSpike,
  type ResolvedApprovalRow,
} from "../_shared/auto-resolution-anomaly.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { openIncident } from "../_shared/incidents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RESOLVED_STATUSES = ["approved", "rejected", "auto_approved", "auto_rejected"];
const RECENT_WINDOW_HOURS = 24;
const BASELINE_WINDOW_DAYS = 14;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const now = new Date();
  const recentStart = new Date(now.getTime() - RECENT_WINDOW_HOURS * 60 * 60 * 1000);
  const baselineStart = new Date(recentStart.getTime() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [{ data: recentRows, error: recentErr }, { data: baselineRows, error: baselineErr }] = await Promise.all([
    admin.from("pending_approvals").select("user_id, status").in("status", RESOLVED_STATUSES).gte("created_at", recentStart.toISOString()),
    admin.from("pending_approvals").select("user_id, status").in("status", RESOLVED_STATUSES)
      .gte("created_at", baselineStart.toISOString()).lt("created_at", recentStart.toISOString()),
  ]);
  if (recentErr) return json({ error: recentErr.message }, 500);
  if (baselineErr) return json({ error: baselineErr.message }, 500);

  const recentActivity = summarizeResolutionActivity((recentRows ?? []) as ResolvedApprovalRow[]);
  const baselineByUser = new Map(
    summarizeResolutionActivity((baselineRows ?? []) as ResolvedApprovalRow[]).map((a) => [a.userId, a]),
  );

  const alerted: string[] = [];
  const cleared: string[] = [];
  const recentUserIds = new Set(recentActivity.map((a) => a.userId));

  for (const recent of recentActivity) {
    const baseline = baselineByUser.get(recent.userId) ?? { userId: recent.userId, total: 0, auto: 0 };
    const check = detectAutoResolutionShareSpike(recent.total, recent.auto, baseline.total, baseline.auto);

    const { data: profileRow } = await admin
      .from("profiles").select("auto_resolution_share_alerted_at").eq("id", recent.userId).maybeSingle();
    const alreadyAlerted = !!(profileRow as { auto_resolution_share_alerted_at?: string | null } | null)?.auto_resolution_share_alerted_at;

    if (check.anomalous && !alreadyAlerted) {
      const summary = summarizeAutoResolutionSpike(check.recentSharePct, check.baselineSharePct, recent.total);
      try {
        await sendCriticalAlert(admin, recent.userId, { event: "auto_resolution_share_spike", summary });
        const { error: updErr } = await admin
          .from("profiles").update({ auto_resolution_share_alerted_at: now.toISOString() }).eq("id", recent.userId);
        if (updErr) console.error(`[AUTO-RESOLUTION SHARE SWEEP] failed to stamp ${recent.userId}: ${updErr.message}`);
        else {
          alerted.push(recent.userId);
          await openIncident(admin, recent.userId, { kind: "auto_resolution_share_spike", summary });
        }
      } catch (e) {
        console.error(`[AUTO-RESOLUTION SHARE SWEEP] alert failed for ${recent.userId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (!check.anomalous && alreadyAlerted) {
      const { error: clearErr } = await admin
        .from("profiles").update({ auto_resolution_share_alerted_at: null }).eq("id", recent.userId);
      if (!clearErr) cleared.push(recent.userId);
    }
  }

  // Same reasoning as control-api-abuse-sweep's own second pass: an
  // account that was flagged and then had ZERO resolved decisions at all
  // in the recent window (quiet since) never appears in `recentActivity`
  // above, so it would otherwise stay "alerted" forever. Zero recent
  // activity is, by definition, not a spike.
  const { data: flaggedRows } = await admin
    .from("profiles").select("id").not("auto_resolution_share_alerted_at", "is", null);
  for (const row of (flaggedRows ?? []) as { id: string }[]) {
    if (recentUserIds.has(row.id)) continue;
    const { error: clearErr } = await admin
      .from("profiles").update({ auto_resolution_share_alerted_at: null }).eq("id", row.id);
    if (!clearErr) cleared.push(row.id);
  }

  return json({ ok: true, accountsChecked: recentActivity.length, alerted: alerted.length, cleared: cleared.length });
});
