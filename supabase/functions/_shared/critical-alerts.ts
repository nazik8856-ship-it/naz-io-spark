// Real-time alerting for safety events only.
//
// Fires ONLY for kill-switch trips (manual or automatic), hard-rule blocks,
// circuit-breaker trips, self-audit regressions, gate errors (the gate
// itself failing closed on an unexpected exception), escalated pending
// approvals (untouched past the risk-scaled threshold), a severely
// miscalibrated confidence bucket (the model claims a confidence range it
// doesn't actually earn), a break-glass override of a blocked action, a
// correlated (multi-agent, fleet-wide) circuit breaker trip, an audit
// trail integrity failure (a signature mismatch or an unsigned decision),
// a webhook endpoint whose deliveries have exhausted every retry, a
// connected integration whose token was revoked or expired, and an
// api_keys key whose recent call volume or non-allow rate through the
// public control-api endpoint looks like abuse (a leaked key being
// probed, or a misbehaving external integration).
// Routine allow / modify / deferred verdicts never alert.
//
// Delivery: Slack via slack_post_message when the account has a connected Slack
// integration; otherwise a prominent server log. Never throws — alerting must
// never break the decision path.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { slackPostMessage } from "./provider-writes.ts";
import { isIncidentWorthy, openIncident } from "./incidents.ts";
import { resolveNotificationRecipients, type MemberRow, type PreferenceRow } from "./notification-preferences.ts";

export type CriticalAlertEvent =
  | "kill_switch_on"
  | "kill_switch_off"
  | "kill_switch_auto"
  | "hard_rule_block"
  | "circuit_breaker_trip"
  | "self_audit_regression"
  | "gate_error"
  // "Zero human review" plan, item 8: a DIFFERENT event from plain
  // "gate_error" -- that one always means the gate failed CLOSED, so its
  // fixed label text below ("...and failed closed") would be actively
  // WRONG for a key that chose to fail open instead. Never reuse
  // "gate_error" for this outcome, even though both originate from the
  // exact same catch block in control-gate.ts.
  | "gate_error_fail_open"
  | "approval_escalated"
  | "confidence_miscalibrated"
  | "break_glass_override"
  | "correlated_breaker_trip"
  | "audit_integrity_failure"
  | "webhook_delivery_exhausted"
  | "integration_revoked"
  | "control_api_abuse"
  // "Zero human review" plan, item 14: a sharply higher-than-normal share
  // of an account's decisions are suddenly being auto-resolved with no
  // human review, compared to that same account's own recent baseline.
  | "auto_resolution_share_spike"
  // "Real precedent memory" plan, item 14: an api key keeps sending real
  // decisions, but hardly any of them are actually getting embedded --
  // the memory pipeline has quietly stopped working (a bug, a provider
  // change, a spend cap) and nothing about any single decision looks
  // wrong in the moment, so nobody would otherwise notice.
  | "precedent_pipeline_stale"
  // "Policy autonomy" plan, item 2: an account's Control API traffic,
  // summed across MULTIPLE keys, looks abusive even though no single
  // key crosses its own per-key threshold -- a pattern the existing
  // per-key control_api_abuse check can't see by design.
  | "control_api_coordinated_abuse";

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
  gate_error_fail_open: "⚠️ Control gate hit an unexpected error and failed OPEN (per API key policy)",
  approval_escalated: "⏰ A pending approval has been waiting too long",
  confidence_miscalibrated: "📉 The model is overconfident in a real confidence range",
  break_glass_override: "🔓 A blocked action was overridden by a human",
  correlated_breaker_trip: "🕸️ Multiple agents tripped the same circuit breaker",
  audit_integrity_failure: "🧾 Audit trail integrity check failed",
  webhook_delivery_exhausted: "📡 A webhook endpoint stopped receiving deliveries",
  integration_revoked: "🔌 A connected integration was revoked or expired",
  control_api_abuse: "🚩 Unusual activity on a public Control API key",
  auto_resolution_share_spike: "🤖 An unusually large share of decisions are being resolved automatically",
  precedent_pipeline_stale: "🧠 An API key's real-precedent memory has gone stale",
  control_api_coordinated_abuse: "🚩 Unusual activity spread across multiple Control API keys",
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
): Promise<string | null> {
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
  return alertId;
}

/**
 * Email fallback for when Slack delivery didn't happen (not connected, or
 * slackPostMessage failed) -- until now that meant zero out-of-band signal
 * beyond a server log line. Uses the same owner/member notification-
 * preference resolution the digest and weekly-trend emails already use.
 * Never throws — alerting must never break the decision path.
 */
async function sendCriticalAlertEmail(
  admin: SupabaseClient,
  userId: string,
  opts: { event: CriticalAlertEvent; summary: string; decisionId?: string | null; actionType?: string | null; provider?: string | null; actor?: string | null },
  alertId: string | null,
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;

    const [{ data: authUser, error: authErr }, { data: members }, { data: prefs }] = await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin.from("account_members").select("member_id, email, status").eq("account_owner_id", userId),
      admin.from("notification_preferences")
        .select("recipient_id, digest_enabled, weekly_trend_enabled, critical_alert_email_enabled")
        .eq("account_owner_id", userId),
    ]);
    const ownerEmail = authErr ? null : authUser?.user?.email ?? null;
    const recipients = resolveNotificationRecipients(
      userId, ownerEmail, (members ?? []) as MemberRow[], (prefs ?? []) as PreferenceRow[], "critical_alert_email_enabled",
    );
    if (!recipients.length) return;

    const link = decisionLink(opts.decisionId);
    await Promise.all(recipients.map((r) =>
      fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          templateName: "critical-alert",
          recipientEmail: r.email,
          idempotencyKey: `critical-alert-${alertId ?? `${userId}-${opts.event}`}-${r.recipientId}`,
          templateData: {
            eventLabel: LABELS[opts.event],
            summary: opts.summary,
            actionType: opts.actionType ?? null,
            provider: opts.provider ?? null,
            actor: opts.actor ?? null,
            decisionUrl: link,
          },
        }),
      }).catch(() => null)
    ));
  } catch { /* email fallback must never break alerting */ }
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
  const alertId = await persistAlert(admin, userId, opts, "log");
  await sendCriticalAlertEmail(admin, userId, opts, alertId);
  return "log";
}
