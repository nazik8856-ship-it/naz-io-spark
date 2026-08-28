// Real tests for the public Control API's auth-resolution step, extracted
// so this project's plan item asking to "explicitly test (not just trust
// the design) that a revoked key stops authenticating on its very next
// call, with no cache or stale-row path letting it through" is something a
// real test actually exercises.
//
// Run with: deno test --allow-none supabase/functions/_shared/control-api-auth_test.ts
import { resolveApiKeyAuth } from "./control-api-auth.ts";
import { generateRawKey } from "./api-key-auth.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// A fake admin client whose resolve_api_key RPC replays a scripted queue of
// results, one per call -- lets a test simulate "the key was active, then
// got revoked between two requests" without a live database.
function fakeAdminWithRpcQueue(results: { data: unknown; error: unknown }[]) {
  const calls: { rpcName: string; args: unknown }[] = [];
  let i = 0;
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    rpc(rpcName: string, args: unknown): any {
      calls.push({ rpcName, args });
      const result = results[Math.min(i, results.length - 1)];
      i++;
      return Promise.resolve(result);
    },
  };
}

const activeRow = { data: [{ user_id: "user-1", key_id: "key-1", scopes: ["control:verdict"] }], error: null };
// This is exactly what resolve_api_key's UPDATE ... RETURNING produces once
// revoked_at is no longer null -- the WHERE clause excludes the row, so the
// RETURNING set is empty, same shape as "never existed" from the caller's
// point of view.
const revokedRow = { data: [], error: null };

Deno.test("resolveApiKeyAuth: an active key resolves to its owning user", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([activeRow]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.userId, "user-1");
    assertEquals(result.keyId, "key-1");
  }
});

Deno.test("resolveApiKeyAuth: calls resolve_api_key with the key's hash, never the raw secret", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([activeRow]);
  await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assertEquals(admin.calls.length, 1);
  assertEquals(admin.calls[0].rpcName, "resolve_api_key");
  const hash = (admin.calls[0].args as { _key_hash: string })._key_hash;
  assert(hash !== raw, "the raw key must never be sent to the RPC directly");
  assert(/^[0-9a-f]{64}$/.test(hash), `expected a sha256 hex digest, got: ${hash}`);
});

Deno.test("resolveApiKeyAuth: a revoked key (empty RETURNING set) is unauthorized", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([revokedRow]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(!result.ok);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test(
  "resolveApiKeyAuth: the SAME key authenticates on call 1 and is rejected on call 2 once revoked -- no cache carries the earlier success forward",
  async () => {
    const raw = generateRawKey();
    // One admin instance, reused across both calls -- if resolveApiKeyAuth
    // (or anything it calls) memoized a prior "ok" result per key, this
    // test would see call 2 wrongly succeed even though the fake RPC's
    // second scripted response is the revoked/empty one.
    const admin = fakeAdminWithRpcQueue([activeRow, revokedRow]);

    const first = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
    assert(first.ok, "expected the key to authenticate while still active");

    const second = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
    assert(!second.ok, "expected the SAME key to be rejected on its very next call once revoked");
    if (!second.ok) assertEquals(second.status, 401);

    // Both calls independently hit the RPC -- proves there's no short-circuit
    // path (e.g. returning early on a previously-seen hash) skipping it.
    assertEquals(admin.calls.length, 2);
  },
);

Deno.test("resolveApiKeyAuth: a missing Authorization header is rejected without ever calling the RPC", async () => {
  const admin = fakeAdminWithRpcQueue([activeRow]);
  const result = await resolveApiKeyAuth(admin, null);
  assert(!result.ok);
  if (!result.ok) assertEquals(result.status, 401);
  assertEquals(admin.calls.length, 0, "a malformed/missing key must fail fast, not touch the database");
});

Deno.test("resolveApiKeyAuth: a malformed bearer token is rejected without ever calling the RPC", async () => {
  const admin = fakeAdminWithRpcQueue([activeRow]);
  const result = await resolveApiKeyAuth(admin, "Bearer not-a-real-key");
  assert(!result.ok);
  assertEquals(admin.calls.length, 0);
});

// ---- item 7: an auto-paused key gets a specific, actionable rejection ----

Deno.test("resolveApiKeyAuth: a paused key (paused_until in the future) is rejected with a specific, non-generic message", async () => {
  const raw = generateRawKey();
  const pausedUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  const admin = fakeAdminWithRpcQueue([{
    data: [{ user_id: "user-1", key_id: "key-1", scopes: [], paused_until: pausedUntil }],
    error: null,
  }]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(!result.ok);
  if (!result.ok) {
    assertEquals(result.status, 429);
    assertEquals(result.body.error, "key_paused");
    assertEquals(result.body.paused_until, pausedUntil);
    assert(result.body.message !== "Invalid, expired, or revoked API key.", "must not read like a plain revoked/invalid key");
  }
});

Deno.test("resolveApiKeyAuth: a key whose pause has already elapsed authenticates normally", async () => {
  const raw = generateRawKey();
  const pausedUntil = new Date(Date.now() - 60_000).toISOString(); // in the past
  const admin = fakeAdminWithRpcQueue([{
    data: [{ user_id: "user-1", key_id: "key-1", scopes: [], paused_until: pausedUntil }],
    error: null,
  }]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(result.ok, "an elapsed pause must not keep blocking the key -- it recovers on its own");
});

Deno.test("resolveApiKeyAuth: a key with no paused_until at all authenticates normally", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([{ data: [{ user_id: "user-1", key_id: "key-1", scopes: [], paused_until: null }], error: null }]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(result.ok);
});

// ---- "knowledge & autonomy" item 7: sandbox/test-mode keys ----

Deno.test("resolveApiKeyAuth: a real key resolves with isTest false", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([activeRow]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(result.ok);
  if (result.ok) assertEquals(result.isTest, false);
});

Deno.test("resolveApiKeyAuth: a sandbox key resolves with isTest true", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([{
    data: [{ user_id: "user-1", key_id: "key-1", scopes: [], is_test: true }],
    error: null,
  }]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(result.ok);
  if (result.ok) assertEquals(result.isTest, true);
});

Deno.test("resolveApiKeyAuth: the RPC erroring out is treated as unauthorized, not a crash or a pass-through", async () => {
  const raw = generateRawKey();
  const admin = fakeAdminWithRpcQueue([{ data: null, error: { message: "db unavailable" } }]);
  const result = await resolveApiKeyAuth(admin, `Bearer ${raw}`);
  assert(!result.ok);
  if (!result.ok) assertEquals(result.status, 401);
});
