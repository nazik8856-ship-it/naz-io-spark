// Generic outbound webhooks — decision/approval created, approval
// escalated, incident opened/resolved. Delivery is best-effort and always
// logged (webhook_deliveries), independent of whether the receiving
// endpoint actually responded 2xx — same durability reasoning as
// critical_alerts earlier this session: a silently-failing webhook (wrong
// URL, endpoint down, timeout) must never be invisible.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRetryEligible, isExhausted, computeNextRetryAt } from "./webhook-retry.ts";
import { sendCriticalAlert } from "./critical-alerts.ts";
import { previousSecretActive } from "./webhook-secret-rotation.ts";

export const WEBHOOK_EVENTS = [
  "approval_created",
  "approval_escalated",
  "incident_opened",
  "incident_resolved",
  // Fires on every logged decision (SIEM/observability export) -- opt-in,
  // like every other event: a webhook only receives it if "decision_logged"
  // is explicitly in its own `events` list. Wired from every real
  // decision-logging chokepoint: control-gate.ts's logStop (deterministic
  // stops), decision-scoring.ts's logDecision (the model-scored path, also
  // used by control-engine's real /undo route), spend-guard.ts's two
  // direct kill-switch-trip inserts, and the two human_override inserts
  // (control-engine's break-glass /override route, agent-runtime's
  // low-confidence-escalation resume flow) that bypass logStop/logDecision.
  // control-gate.ts's gate_error and circuit_breaker_trip event inserts
  // still bypass this -- a real, separate, out-of-scope gap, not silent.
  "decision_logged",
] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

/** Pure — canonical string to sign, so the receiver verifies without ambiguity about field order/whitespace. */
export function buildSignaturePayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Hook = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  previous_secret?: string | null;
  previous_secret_expires_at?: string | null;
};

/**
 * Clears a webhook's dead-letter flag on any successful delivery, or fires
 * (and records) a one-time webhook_delivery_exhausted alert the first time
 * its retries exhaust. alerted_at lives on the webhook itself, not the
 * individual delivery row -- a permanently-broken endpoint gets a FRESH
 * delivery chain (and its own independent exhaustion) for every new event
 * that fires while it's down, so scoping the flag to one delivery row would
 * only silence that one chain, not the endpoint. Never throws.
 */
export async function handleWebhookDeliveryOutcome(
  admin: SupabaseClient,
  userId: string,
  hook: { id: string; url: string; alerted_at?: string | null },
  outcome: { ok: boolean; attempt: number },
): Promise<void> {
  try {
    if (outcome.ok) {
      if (hook.alerted_at) {
        await admin.from("webhooks").update({ alerted_at: null }).eq("id", hook.id);
      }
      return;
    }
    if (!isExhausted(outcome.attempt, outcome.ok) || hook.alerted_at) return;
    await sendCriticalAlert(admin, userId, {
      event: "webhook_delivery_exhausted",
      summary: `Webhook deliveries to ${hook.url} have failed ${outcome.attempt} times in a row and retries are now exhausted. No further attempts will be made for this event — new events will still be attempted fresh.`,
    });
    await admin.from("webhooks").update({ alerted_at: new Date().toISOString() }).eq("id", hook.id);
  } catch { /* dead-letter alerting must never break delivery */ }
}

/** Best-effort: delivers `event` to every enabled webhook subscribed to it. Never throws. */
export async function triggerWebhooks(
  admin: SupabaseClient,
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data } = await admin
      .from("webhooks")
      .select("id, url, secret, events, alerted_at, previous_secret, previous_secret_expires_at")
      .eq("user_id", userId)
      .eq("enabled", true);
    const hooks = ((data ?? []) as (Hook & { alerted_at?: string | null })[]).filter((h) => Array.isArray(h.events) && h.events.includes(event));
    if (!hooks.length) return;

    const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });
    const timestamp = Date.now().toString();

    await Promise.all(hooks.map(async (hook) => {
      let statusCode: number | null = null;
      let ok = false;
      let errMsg: string | null = null;
      try {
        const signaturePayload = buildSignaturePayload(timestamp, body);
        const signature = await hmacHex(hook.secret, signaturePayload);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-NazAI-Event": event,
          "X-NazAI-Timestamp": timestamp,
          "X-NazAI-Signature": signature,
        };
        // While a rotated-out secret is still inside its grace window, sign
        // with it too so the receiver can swap in the new secret on their
        // own schedule instead of at the exact moment of rotation.
        if (previousSecretActive(hook)) {
          headers["X-NazAI-Signature-Previous"] = await hmacHex(hook.previous_secret as string, signaturePayload);
        }
        const resp = await fetch(hook.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(8000),
        });
        statusCode = resp.status;
        ok = resp.ok;
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }
      const attempt = 1;
      try {
        await admin.from("webhook_deliveries").insert({
          webhook_id: hook.id,
          user_id: userId,
          event,
          status_code: statusCode,
          ok,
          error: errMsg,
          payload: JSON.parse(body),
          attempt,
          next_retry_at: isRetryEligible(attempt, ok) ? computeNextRetryAt(attempt, new Date()).toISOString() : null,
        });
      } catch { /* delivery logging must never break the caller's own flow */ }
      await handleWebhookDeliveryOutcome(admin, userId, hook, { ok, attempt });
    }));
  } catch { /* webhook delivery must never break the caller's own flow */ }
}
