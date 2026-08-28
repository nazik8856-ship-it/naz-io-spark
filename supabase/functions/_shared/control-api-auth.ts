// "Outer NazAI" plan, item 15: extracted out of control-api/index.ts so the
// property the plan asks to explicitly verify -- "a revoked key stops
// authenticating on its very next call, with no cache or stale-row path
// letting it through" -- is something a real test can exercise, not just
// something re-read and trusted.
//
// Holds no state of its own between calls (no module-level cache, no
// memoized map keyed by hash) -- every invocation calls resolve_api_key
// fresh, so a key revoked between two calls fails on the second one.
import { sha256Hex, isValidRawKeyFormat } from "./api-key-auth.ts";
import { isCurrentlyPaused, pausedKeyMessage } from "./control-api-abuse.ts";

export type ApiKeyAuthResult =
  | { ok: true; userId: string; keyId: string | null; isTest: boolean }
  | { ok: false; status: number; body: { error: string; message: string; paused_until?: string } };

// deno-lint-ignore no-explicit-any
export async function resolveApiKeyAuth(admin: any, authHeader: string | null): Promise<ApiKeyAuthResult> {
  const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!presented || !isValidRawKeyFormat(presented)) {
    return {
      ok: false,
      status: 401,
      body: { error: "unauthorized", message: "Missing or malformed API key. Send Authorization: Bearer nazai_sk_<key>." },
    };
  }
  const keyHash = await sha256Hex(presented);
  const { data: resolved, error } = await admin.rpc("resolve_api_key", { _key_hash: keyHash });
  const row = (Array.isArray(resolved) ? resolved[0] : resolved) as
    | { user_id?: string; key_id?: string; paused_until?: string | null; is_test?: boolean }
    | null;
  if (error || !row?.user_id) {
    return { ok: false, status: 401, body: { error: "unauthorized", message: "Invalid, expired, or revoked API key." } };
  }
  // "Zero human review" plan, item 7: a key auto-paused after looking like
  // abuse (control-api-abuse-sweep) is deliberately rejected HERE, not by
  // resolve_api_key's own WHERE clause -- unlike revoked_at/expires_at
  // (which make a row disappear from the RETURNING set entirely, so the
  // caller can't tell revoked from never-existed), a paused key still
  // resolves so this can return a specific, actionable message instead of
  // a generic "unauthorized" -- exactly the "never invisible" principle
  // item 1 established for every other automatic outcome in this round.
  if (row.paused_until && isCurrentlyPaused(row.paused_until)) {
    return {
      ok: false,
      status: 429,
      body: { error: "key_paused", message: pausedKeyMessage(row.paused_until), paused_until: row.paused_until },
    };
  }
  return { ok: true, userId: row.user_id, keyId: row.key_id ?? null, isTest: row.is_test === true };
}
