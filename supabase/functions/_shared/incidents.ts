// Incident tracking — promotes the "abnormal" critical alerts (an automatic
// kill-switch trip, a circuit breaker tripping, the gate itself failing
// closed, a self-audit regression, a pending approval left unattended too
// long) from "a decision row + a Slack ping" into a real incident object
// with a timeline and a resolution note. Deliberate human actions
// (flipping the kill switch on/off) and routine enforcement working as
// intended (a hard rule blocking something) are NOT incidents — nothing
// went wrong there, the system did exactly what it was told to. A
// break-glass override IS an incident despite also being a deliberate
// human action -- it's a human bypassing a safety control, not routine
// use of one, and is worth surfacing for later review every time.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CriticalAlertEvent } from "./critical-alerts.ts";
import { triggerWebhooks } from "./webhooks.ts";

export const INCIDENT_KINDS = [
  "kill_switch_auto",
  "circuit_breaker_trip",
  "gate_error",
  "self_audit_regression",
  "approval_escalated",
  "confidence_miscalibrated",
  "break_glass_override",
  "correlated_breaker_trip",
  "audit_integrity_failure",
  "webhook_delivery_exhausted",
  "integration_revoked",
  "control_api_abuse",
  // "Zero human review" plan, item 8: a distinct kind from plain
  // "gate_error" -- a fail-OPEN outcome is operationally far more
  // significant than a normal fail-closed one (something ran UNJUDGED
  // during an outage, not merely blocked), so it must never be
  // indistinguishable from an ordinary gate_error incident in a report.
  "gate_error_fail_open",
  // "Zero human review" plan, item 14: a sharply higher-than-normal share
  // of an account's decisions suddenly being auto-resolved with no human
  // review, compared to that account's own recent baseline.
  "auto_resolution_share_spike",
  // "Real precedent memory" plan, item 14: an api key's memory pipeline
  // has quietly stopped working -- real decisions keep flowing in, but
  // hardly any of them are getting embedded, and nothing about any one
  // decision looked wrong in the moment.
  "precedent_pipeline_stale",
] as const;
export type IncidentKind = typeof INCIDENT_KINDS[number];

/** Pure — which alert events are worth opening an incident for. */
export function isIncidentWorthy(event: CriticalAlertEvent): event is IncidentKind {
  return (INCIDENT_KINDS as readonly string[]).includes(event);
}

/** Best-effort: opens a new incident row for an incident-worthy alert. Never throws. */
export async function openIncident(
  admin: SupabaseClient,
  userId: string,
  opts: {
    kind: IncidentKind;
    summary: string;
    actionType?: string | null;
    provider?: string | null;
    decisionId?: string | null;
    alertId?: string | null;
  },
): Promise<void> {
  try {
    const { data } = await admin.from("incidents").insert({
      user_id: userId,
      kind: opts.kind,
      summary: opts.summary.slice(0, 2000),
      action_type: opts.actionType ?? null,
      provider: opts.provider ?? null,
      decision_id: opts.decisionId ?? null,
      alert_id: opts.alertId ?? null,
    }).select("id").maybeSingle();
    const id = (data as { id?: string } | null)?.id ?? null;
    if (id) {
      await triggerWebhooks(admin, userId, "incident_opened", {
        incident_id: id, kind: opts.kind, summary: opts.summary, action_type: opts.actionType ?? null, provider: opts.provider ?? null,
      });
    }
  } catch { /* incident tracking must never break the alert path */ }
}
