// Scheduled sweep (pg_cron): finds pending approvals left untouched past a
// risk-scaled threshold (_shared/escalation.ts) and fires a stronger alert
// + opens an incident for each. Service-role only — this is a cron entry
// point, not something a client ever calls directly.
//
// Pillar 3 top-10 item 3: previously only ever fetched/claimed rows with
// escalated_at IS NULL -- a real nudge, sent once, then permanent silence no
// matter how much longer the approval sat afterward. escalated_at now means
// "when was the last nudge," so this also re-checks already-escalated rows
// and re-arms the claim optimistically against whatever value was actually
// read, instead of assuming it's always NULL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isOverdueForEscalation, hoursSince, type PendingApprovalLike } from "../_shared/escalation.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = PendingApprovalLike & {
  id: string;
  user_id: string;
  action_type: string;
  provider: string;
  decision_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: rows, error } = await admin
    .from("pending_approvals")
    .select("id, user_id, action_type, provider, risk_tier, created_at, escalated_at, status, decision_id")
    .eq("status", "pending");
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  let escalated = 0;
  for (const row of (rows ?? []) as Row[]) {
    if (!isOverdueForEscalation(row, now)) continue;
    const isRepeatNudge = row.escalated_at != null;

    // Atomic: only the sweep that actually flips escalated_at gets to
    // alert — a second sweep racing on the same row (unlikely at a 30-min
    // cadence, but cheap to guard) sees no row back and skips. Re-arms
    // optimistically against whatever escalated_at was actually read
    // (null for a first nudge, a real timestamp for a repeat one) rather
    // than assuming it's always null.
    let claimQuery = admin
      .from("pending_approvals")
      .update({ escalated_at: now.toISOString() })
      .eq("id", row.id);
    claimQuery = isRepeatNudge ? claimQuery.eq("escalated_at", row.escalated_at as string) : claimQuery.is("escalated_at", null);
    const { data: claimed } = await claimQuery.select("id").maybeSingle();
    if (!claimed) continue;

    const waitedHours = Math.round(hoursSince(row.created_at, now));
    await sendCriticalAlert(admin, row.user_id, {
      event: "approval_escalated",
      summary: isRepeatNudge
        ? `A ${row.risk_tier} risk "${row.action_type}" approval is STILL waiting ${waitedHours}h with no response -- this is a repeat nudge.`
        : `A ${row.risk_tier} risk "${row.action_type}" approval has been waiting ${waitedHours}h with no response.`,
      decisionId: row.decision_id,
      actionType: row.action_type,
      provider: row.provider,
      // The first nudge already opened an incident for this approval;
      // openIncident() has no dedup logic, so a repeat nudge about the SAME
      // still-stuck approval must not spawn another one.
      skipIncident: isRepeatNudge,
    });
    await triggerWebhooks(admin, row.user_id, "approval_escalated", {
      approval_id: row.id, action_type: row.action_type, provider: row.provider, risk_tier: row.risk_tier,
      waited_hours: waitedHours, repeat_nudge: isRepeatNudge,
    });
    try {
      await admin.from("pending_approval_events").insert({
        approval_id: row.id, user_id: row.user_id, event_type: "escalated",
        note: `${isRepeatNudge ? "Still w" : "W"}aited ${waitedHours}h with no response`,
      });
    } catch { /* the escalation itself already happened; a missing timeline entry must never block it */ }
    escalated++;
  }

  return json({ ok: true, checked: (rows ?? []).length, escalated });
});
