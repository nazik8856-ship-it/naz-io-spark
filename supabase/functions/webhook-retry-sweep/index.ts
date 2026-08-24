// Scheduled (pg_cron, every 5 min): resends webhook deliveries that
// previously failed and are now due for another attempt, per
// _shared/webhook-retry.ts's exponential backoff. Each attempt is its own
// append-only row in webhook_deliveries (never overwrites the original),
// linked via original_delivery_id so "how many attempts for this event"
// is a simple query. Service-role only, same auth pattern as every other
// scheduled function this session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSignaturePayload, handleWebhookDeliveryOutcome } from "../_shared/webhooks.ts";
import { isRetryEligible, computeNextRetryAt } from "../_shared/webhook-retry.ts";
import { previousSecretActive } from "../_shared/webhook-secret-rotation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type DueDelivery = {
  id: string;
  webhook_id: string;
  user_id: string;
  event: string;
  payload: Record<string, unknown> | null;
  attempt: number;
  original_delivery_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Clear out expired previous_secret values -- once a rotated-out secret's
  // grace window has passed, deliveries should stop dual-signing with it.
  // Piggybacks on this sweep's existing 5-minute cron rather than a new
  // scheduled function, since it's a small, unrelated-but-webhook-scoped
  // cleanup pass over the same table.
  const { error: rotationClearErr } = await admin
    .from("webhooks")
    .update({ previous_secret: null, previous_secret_expires_at: null })
    .not("previous_secret_expires_at", "is", null)
    .lt("previous_secret_expires_at", new Date().toISOString());
  if (rotationClearErr) console.error(`[WEBHOOK RETRY SWEEP] failed to clear expired previous_secret values: ${rotationClearErr.message}`);

  const { data: due, error: dueErr } = await admin
    .from("webhook_deliveries")
    .select("id, webhook_id, user_id, event, payload, attempt, original_delivery_id")
    .eq("ok", false)
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", new Date().toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(200);
  if (dueErr) return json({ error: dueErr.message }, 500);

  const results: { id: string; retried: boolean; ok?: boolean }[] = [];

  for (const d of (due ?? []) as DueDelivery[]) {
    const { data: hookRow } = await admin
      .from("webhooks")
      .select("id, url, secret, enabled, alerted_at, previous_secret, previous_secret_expires_at")
      .eq("id", d.webhook_id)
      .maybeSingle();
    const hook = hookRow as {
      id: string; url: string; secret: string; enabled: boolean; alerted_at: string | null;
      previous_secret: string | null; previous_secret_expires_at: string | null;
    } | null;
    if (!hook || !hook.enabled) {
      results.push({ id: d.id, retried: false });
      continue;
    }

    const body = JSON.stringify(d.payload ?? { event: d.event, data: {}, sent_at: new Date().toISOString() });
    const timestamp = Date.now().toString();
    let statusCode: number | null = null;
    let ok = false;
    let errMsg: string | null = null;
    try {
      const signaturePayload = buildSignaturePayload(timestamp, body);
      const signature = await hmacHex(hook.secret, signaturePayload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-NazAI-Event": d.event,
        "X-NazAI-Timestamp": timestamp,
        "X-NazAI-Signature": signature,
        "X-NazAI-Retry-Attempt": String(d.attempt + 1),
      };
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

    const nextAttempt = d.attempt + 1;
    const originalId = d.original_delivery_id ?? d.id;
    await admin.from("webhook_deliveries").insert({
      webhook_id: d.webhook_id,
      user_id: d.user_id,
      event: d.event,
      status_code: statusCode,
      ok,
      error: errMsg,
      payload: d.payload,
      attempt: nextAttempt,
      original_delivery_id: originalId,
      next_retry_at: isRetryEligible(nextAttempt, ok) ? computeNextRetryAt(nextAttempt, new Date()).toISOString() : null,
    });

    // The original row's own next_retry_at is cleared either way -- it's
    // been acted on, the newest row in the chain is now the live one.
    await admin.from("webhook_deliveries").update({ next_retry_at: null }).eq("id", d.id);

    await handleWebhookDeliveryOutcome(admin, d.user_id, hook, { ok, attempt: nextAttempt });

    results.push({ id: d.id, retried: true, ok });
  }

  return json({ ok: true, checked: (due ?? []).length, results });
});
