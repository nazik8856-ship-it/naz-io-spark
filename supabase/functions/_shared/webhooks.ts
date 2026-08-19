// Generic outbound webhooks — decision/approval created, approval
// escalated, incident opened/resolved. Delivery is best-effort and always
// logged (webhook_deliveries), independent of whether the receiving
// endpoint actually responded 2xx — same durability reasoning as
// critical_alerts earlier this session: a silently-failing webhook (wrong
// URL, endpoint down, timeout) must never be invisible.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const WEBHOOK_EVENTS = [
  "approval_created",
  "approval_escalated",
  "incident_opened",
  "incident_resolved",
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

type Hook = { id: string; url: string; secret: string; events: string[] };

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
      .select("id, url, secret, events")
      .eq("user_id", userId)
      .eq("enabled", true);
    const hooks = ((data ?? []) as Hook[]).filter((h) => Array.isArray(h.events) && h.events.includes(event));
    if (!hooks.length) return;

    const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });
    const timestamp = Date.now().toString();

    await Promise.all(hooks.map(async (hook) => {
      let statusCode: number | null = null;
      let ok = false;
      let errMsg: string | null = null;
      try {
        const signature = await hmacHex(hook.secret, buildSignaturePayload(timestamp, body));
        const resp = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-NazAI-Event": event,
            "X-NazAI-Timestamp": timestamp,
            "X-NazAI-Signature": signature,
          },
          body,
          signal: AbortSignal.timeout(8000),
        });
        statusCode = resp.status;
        ok = resp.ok;
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }
      try {
        await admin.from("webhook_deliveries").insert({
          webhook_id: hook.id,
          user_id: userId,
          event,
          status_code: statusCode,
          ok,
          error: errMsg,
        });
      } catch { /* delivery logging must never break the caller's own flow */ }
    }));
  } catch { /* webhook delivery must never break the caller's own flow */ }
}
