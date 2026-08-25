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

export type ApiKeyAuthResult =
  | { ok: true; userId: string; keyId: string | null }
  | { ok: false; status: number; body: { error: string; message: string } };

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
  const row = (Array.isArray(resolved) ? resolved[0] : resolved) as { user_id?: string; key_id?: string } | null;
  if (error || !row?.user_id) {
    return { ok: false, status: 401, body: { error: "unauthorized", message: "Invalid, expired, or revoked API key." } };
  }
  return { ok: true, userId: row.user_id, keyId: row.key_id ?? null };
}
