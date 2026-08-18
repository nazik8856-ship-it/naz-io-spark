// Idempotency-key support for control-engine's real-execution step —
// the same atomic-claim shape that fixed the approval-execute double-run
// bug (pending_approvals.executed_at), generalized for any caller that
// sends an idempotency_key. Scoped narrowly to the one place a retry can
// cause a real side effect twice (the provider write), not the whole
// request/response — re-running the (side-effect-free) model judgement on
// a retry is wasted cost, not a safety issue.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ClaimResult =
  | { status: "claimed" }
  | { status: "replay"; response: unknown }
  | { status: "in_progress" };

/**
 * Atomically claims (userId, key) for a fresh attempt, or reports what to
 * do instead: replay a cached response from a completed prior attempt, or
 * tell the caller another attempt with this key is still in flight (or
 * failed without cleaning up — same signal either way: don't run it again
 * right now). Never throws — a claim failure here should be treated as
 * "in_progress" (fail toward NOT re-running a real action), not silently
 * skipped.
 */
export async function claimIdempotencyKey(
  admin: SupabaseClient,
  userId: string,
  key: string,
): Promise<ClaimResult> {
  try {
    const { data: inserted } = await admin
      .from("idempotency_keys")
      .insert({ user_id: userId, idempotency_key: key })
      .select("id")
      .maybeSingle();
    if (inserted) return { status: "claimed" };
  } catch { /* fall through to check what's already there */ }

  try {
    const { data: existing } = await admin
      .from("idempotency_keys")
      .select("response")
      .eq("user_id", userId)
      .eq("idempotency_key", key)
      .maybeSingle();
    const response = (existing as { response?: unknown } | null)?.response;
    if (response !== null && response !== undefined) return { status: "replay", response };
  } catch { /* fall through */ }

  return { status: "in_progress" };
}

/** Fills in the response for a claimed key, so future retries replay it. Never throws. */
export async function saveIdempotencyResponse(
  admin: SupabaseClient,
  userId: string,
  key: string,
  response: unknown,
): Promise<void> {
  try {
    await admin
      .from("idempotency_keys")
      .update({ response: response as Record<string, unknown> })
      .eq("user_id", userId)
      .eq("idempotency_key", key);
  } catch { /* best effort */ }
}

/** Releases a claim after a genuinely failed attempt, so a real retry can try again. Never throws. */
export async function releaseIdempotencyKey(
  admin: SupabaseClient,
  userId: string,
  key: string,
): Promise<void> {
  try {
    await admin
      .from("idempotency_keys")
      .delete()
      .eq("user_id", userId)
      .eq("idempotency_key", key)
      .is("response", null); // never delete a row already holding a successful reply
  } catch { /* best effort */ }
}
