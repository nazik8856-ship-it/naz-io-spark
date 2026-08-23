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

// ---------------------------------------------------------------------------
// Row-level atomic claim (2026-08-24) — the SAME "atomic UPDATE ... WHERE
// col IS NULL" shape control-engine's /approvals/:id/execute (executed_at)
// and /decisions/:id/override (overridden_at) each independently hand-roll,
// generalized here so a third/fourth call site doesn't reimplement it again.
// Deliberately NOT retrofitted onto those two existing routes -- they have
// no test coverage today and are working correctly; this is for NEW call
// sites only (agent-runtime's tool execution, agent-approval's approve path).
// ---------------------------------------------------------------------------

/**
 * Atomically claims a single row for a fresh attempt by stamping `column`
 * (a nullable timestamptz) with the current time, but only if it's still
 * NULL. Returns whether THIS call won the claim -- a second concurrent (or
 * retried) call for the same row/column sees it already stamped and gets
 * `claimed: false`, so the caller knows not to repeat a real side effect.
 * Never throws -- an infrastructure error here fails toward NOT re-running
 * a real action, same posture as `claimIdempotencyKey`'s "in_progress" case.
 */
export async function claimRowOnce(
  admin: SupabaseClient,
  table: string,
  id: string,
  column: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from(table)
      .update({ [column]: new Date().toISOString() })
      .eq("id", id)
      .is(column, null)
      .select("id")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** Releases a row claim after a genuinely failed attempt, so a real retry isn't permanently blocked. Never throws. */
export async function releaseRowClaim(
  admin: SupabaseClient,
  table: string,
  id: string,
  column: string,
): Promise<void> {
  try {
    await admin.from(table).update({ [column]: null }).eq("id", id);
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Content-hashed real-action key (2026-08-24) — for a caller that has no
// pre-existing row to claim (agent-runtime's tool-execution loop synthesizes
// each step on the fly, nothing to UPDATE), pairs with claimIdempotencyKey
// above instead of claimRowOnce. Protects against the SAME logical caller
// (e.g. one agent run) emitting the IDENTICAL real-world action twice --
// e.g. losing track of having already sent a message and sending it again a
// few steps later. Keyed on (scope, kind, normalized input) rather than a
// step counter, since a repeat can surface at ANY later step, not
// necessarily the same one.
//
// Deliberately NOT a defense against two SEPARATE callers/invocations for
// the same trigger (e.g. a webhook redelivered after the first run already
// fully completed) -- that is a distinct, larger problem (trigger-level
// dedup), out of scope here.
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Pure (modulo the digest call) -- builds a stable idempotency key from a
 * scope (e.g. a run id), an action kind, and its input. Note: relies on
 * `input` being constructed the same way every time a given call site
 * builds it (JSON.stringify is not object-key-order-independent) -- true
 * for every current call site, which always passes a literal object with
 * the same field order.
 */
export async function buildRealActionKey(scope: string, kind: string, input: unknown): Promise<string> {
  return `real-action:${scope}:${kind}:${await sha256Hex(JSON.stringify(input))}`;
}
