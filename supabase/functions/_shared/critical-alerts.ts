// Real-time alerting for safety events only.
//
// Fires ONLY for kill-switch trips (manual or automatic), hard-rule blocks,
// circuit-breaker trips, self-audit regressions, gate errors (the gate
// itself failing closed on an unexpected exception), escalated pending
// approvals (untouched past the risk-scaled threshold), and a severely
// miscalibrated confidence bucket (the model claims a confidence range it
// doesn't actually earn). Routine allow / modify / deferred verdicts never
// alert.
//
// Delivery: Slack via slack_post_message when the account has a connected Slack
// integration; otherwise a prominent server log. Never throws — alerting must
// never break the decision path.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { slackPostMessage } from "./provider-writes.ts";
import { isIncidentWorthy, openIncident } from "./incidents.ts";

export type CriticalAlertEvent =
  | "kill_switch_on"
  | "kill_switch_off"
  | "kill_switch_auto"
  | "hard_rule_block"
  | "circuit_breaker_trip"
  | "self_audit_regression"
  | "gate_error"
  | "approval_escalated"
  | "confidence_miscalibrated";

const APP_BASE_URL = "https://www.nazai.net";

// Exported so a test can assert every CriticalAlertEvent has a real label —
// a missing entry here is only ever a silent runtime `undefined` (LABELS is
// keyed by a string union, not a discriminated type TS can exhaustively
// check), which is exactly how "gate_error" briefly alerted with the text
// "*undefined*" until this list caught up with the union above.
export const LABELS: Record<CriticalAlertEvent, string> = {
  kill_switch_on: "🛑 Kill switch ON",
  kill_switch_off: "✅ Kill switch OFF",
  kill_switch_auto: "🛑 Kill switch auto-tripped",
  hard_rule_block: "⛔ Hard rule blocked an action",
  circuit_breaker_trip: "⚡ Circuit breaker tripped",
  self_audit_regression: "🧪 Weekly control-system self-audit found a regression",
  gate_error: "🚨 Control gate hit an unexpected error and failed closed",
  approval_escalated: "⏰ A pending approval has been waiting too long",
  confidence_miscalibrated: "📉 The model is overconfident in a real confidence range",
};

export function decisionLink(decisionId?: string | null): string | null {
  return decisionId ? `${APP_BASE_URL}/control-system?decision=${decisionId}` : null;
}

/**
 * Best-effort, durable record of the alert — independent of whether Slack
 * delivery works. Also opens an incident for the events that mean something
 * actually went wrong (not a deliberate human toggle or a rule doing its
 * job). Never throws.
 */
async function persistAlert(
  admin: SupabaseClient,
  userId: string,
  opts: { event: CriticalAlertEvent; summary: string; decisionId?: string | null; actionType?: string | null; provider?: string | null; actor?: string | null },
  deliveredVia: "slack" | "log",
): Promise<void> {
  let alertId: string | null = null;
  try {
    const { data } = await admin.from("critical_alerts").insert({
      user_id: userId,
      event: opts.event,
      summary: opts.summary.slice(0, 2000),
      action_type: opts.actionType ?? null,
      provider: opts.provider ?? null,
      decision_id: opts.decisionId ?? null,
      actor: opts.actor ?? null,
      delivered_via: deliveredVia,
    }).select("id").maybeSingle();
    alertId = (data as { id?: string } | null)?.id ?? null;
  } catch { /* the alert itself must never depend on this succeeding */ }

  if (isIncidentWorthy(opts.event)) {
    await openIncident(admin, userId, {
      kind: opts.event,
      summary: opts.summary,
      actionType: opts.actionType,
      provider: opts.provider,
      decisionId: opts.decisionId,
      alertId,
    });
  }
}

export async function sendCriticalAlert(
  admin: SupabaseClient,
  userId: string,
  opts: {
    event: CriticalAlertEvent;
    summary: string;
    decisionId?: string | null;
    actionType?: string | null;
    provider?: string | null;
    actor?: string | null;
  },
): Promise<"slack" | "log"> {
  const link = decisionLink(opts.decisionId);
  const lines = [
    `*${LABELS[opts.event]}*`,
    opts.summary,
    opts.actionType ? `Action: \`${opts.actionType}\`${opts.provider ? ` · ${opts.provider}` : ""}` : null,
    opts.actor ? `By: ${opts.actor}` : null,
    link ? `Decision record: ${link}` : null,
  ].filter(Boolean) as string[];
  const text = lines.join("\n");

  try {
    const { data } = await admin
      .from("agent_integrations")
      .select("provider, metadata")
      .eq("user_id", userId)
      .eq("provider", "slack")
      .eq("status", "connected")
      .maybeSingle();

    if (data) {
      const channel = (data as { metadata?: Record<string, unknown> }).metadata?.default_channel;
      const res = await slackPostMessage(admin, userId, "", {
        channel: String(channel || "#general"),
        text,
      });
      if (res.ok) {
        await persistAlert(admin, userId, opts, "slack");
        return "slack";
      }
      console.error(`[CONTROL ALERT] Slack delivery failed: ${res.summary}`);
    }
  } catch (err) {
    console.error("[CONTROL ALERT] Slack delivery threw:", String((err as Error)?.message || err));
  }

  console.error(`[CONTROL ALERT] ${LABELS[opts.event]} — ${text.replace(/\n/g, " | ")}`);
  await persistAlert(admin, userId, opts, "log");
  return "log";
}
