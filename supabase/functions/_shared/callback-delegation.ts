// "Zero human review" plan, item 4: instead of a NazAI employee resolving
// an unsure case, an API key can be set to "callback" -- NazAI notifies
// the calling company's own system (an HMAC-signed POST, same scheme
// outbound webhooks already use) and waits a short, bounded window for
// that system's own answer via a new inbound endpoint
// (POST /control-api/v1/decisions/:id/resolve), falling back to the
// key's configured callback_fallback if nothing comes back in time.
//
// This wait is deliberately synchronous, inside the same Control API
// request that created the pending_approvals row -- "a short, bounded
// amount of time," per the plan's own framing, not a background job.
// callback_timeout_seconds is capped at 60 in the migration for exactly
// this reason: Supabase Edge Functions have their own wall-clock
// execution limit.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hmacHex, buildSignaturePayload } from "./webhooks.ts";
import { claimRowOnce } from "./idempotency.ts";
import { classifyPendingApprovalStatus } from "./api-key-policy.ts";

export type CallbackConfig = {
  url: string;
  secret: string;
  timeoutSeconds: number;
  fallback: "auto_allow" | "auto_deny";
};

export type CallbackOutcome = {
  resolution: "approved" | "rejected";
  // "Policy autonomy" plan, item 4: true only when nothing ever arrived
  // and the configured fallback had to be used -- false for a real
  // answer, whether it arrived during the poll or won the final-instant
  // claim race. Lets a caller track "this callback attempt failed to
  // get a real answer" separately from what the eventual resolution was.
  usedFallback: boolean;
};

const POLL_INTERVAL_MS = 1000;
const NOTIFY_TIMEOUT_MS = 5000;

/**
 * Best-effort: POSTs the pending decision to the account's configured
 * callback URL. Never throws -- a delivery failure just means the
 * account's own system won't know to answer in time, which the
 * subsequent poll-then-fallback loop already handles correctly on its
 * own (it simply times out and falls back, same as if the endpoint had
 * silently ignored a successful delivery).
 */
async function notifyCallback(
  url: string,
  secret: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const body = JSON.stringify({ event: "decision_needs_resolution", data: payload, sent_at: new Date().toISOString() });
    const timestamp = Date.now().toString();
    const signature = await hmacHex(secret, buildSignaturePayload(timestamp, body));
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NazAI-Event": "decision_needs_resolution",
        "X-NazAI-Timestamp": timestamp,
        "X-NazAI-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
  } catch { /* the poll-then-fallback loop below handles a missed notification the same as a missed answer */ }
}

/**
 * Notifies the callback URL, then polls the pending_approvals row until
 * either an answer arrives (via the /resolve endpoint, called by the
 * account's own system) or the bounded window elapses -- in which case
 * it claims the row atomically (claimRowOnce on resolved_at, the same
 * primitive control-engine's own idempotency/execution claims already
 * use) and applies the configured fallback. The atomic claim means a
 * /resolve call arriving in the exact same instant as the timeout can
 * never race this into a double-resolution -- whichever side wins the
 * claim decides the outcome, the other reads back the final state.
 */
export async function notifyAndAwaitCallback(
  admin: SupabaseClient,
  approvalId: string,
  config: CallbackConfig,
  payload: Record<string, unknown>,
): Promise<CallbackOutcome> {
  await notifyCallback(config.url, config.secret, { approval_id: approvalId, ...payload });

  const deadline = Date.now() + config.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const { data } = await admin.from("pending_approvals").select("status").eq("id", approvalId).maybeSingle();
    const disposition = classifyPendingApprovalStatus((data as { status?: string } | null)?.status);
    if (disposition !== "pending") return { resolution: disposition, usedFallback: false };
  }

  const won = await claimRowOnce(admin, "pending_approvals", approvalId, "resolved_at");
  if (!won) {
    // A /resolve call won the race in the last instant -- use its answer.
    const { data } = await admin.from("pending_approvals").select("status").eq("id", approvalId).maybeSingle();
    const disposition = classifyPendingApprovalStatus((data as { status?: string } | null)?.status);
    return { resolution: disposition === "pending" ? "rejected" : disposition, usedFallback: false };
  }

  const resolution = config.fallback === "auto_allow" ? "approved" : "rejected";
  try {
    await admin.from("pending_approvals").update({
      status: resolution === "approved" ? "auto_approved" : "auto_rejected",
      comment: `Resolved automatically to ${resolution}: no answer arrived from the configured callback URL within ${config.timeoutSeconds}s, falling back to this key's configured callback_fallback — no human reviewed this.`,
    }).eq("id", approvalId);
  } catch { /* the claim above already won -- outcome stands even if this decoration write fails */ }
  return { resolution, usedFallback: true };
}
