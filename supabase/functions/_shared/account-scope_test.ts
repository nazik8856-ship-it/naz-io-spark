// Real tests for the shared account-scope resolver used by edge functions
// that let a caller act on a team account, not just their own.
//
// Run with: deno test --allow-none supabase/functions/_shared/account-scope_test.ts
import { resolveAccountScope } from "./account-scope.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function fakeMembershipClient(result: { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

Deno.test("resolveAccountScope: no account_id named -> resolves to the caller's own id, no RPC call", async () => {
  const client = fakeMembershipClient({ data: true, error: null });
  const result = await resolveAccountScope(client, "caller-1", undefined);
  assertEquals(result, "caller-1");
  assertEquals(client.calls.length, 0, "acting on your own account shouldn't need a membership check");
});

Deno.test("resolveAccountScope: account_id equal to the caller's own id -> resolves without an RPC call", async () => {
  const client = fakeMembershipClient({ data: true, error: null });
  const result = await resolveAccountScope(client, "caller-1", "caller-1");
  assertEquals(result, "caller-1");
  assertEquals(client.calls.length, 0);
});

Deno.test("resolveAccountScope: a different account_id with real owner membership -> resolves to that account", async () => {
  const client = fakeMembershipClient({ data: true, error: null });
  const result = await resolveAccountScope(client, "caller-1", "owner-account-9");
  assertEquals(result, "owner-account-9");
  assertEquals(client.calls.length, 1);
  assertEquals(client.calls[0].name, "is_account_member");
  assertEquals(client.calls[0].args, { _account_owner_id: "owner-account-9", _min_role: "owner", _permission: null });
});

Deno.test("resolveAccountScope: a different account_id WITHOUT owner membership -> returns null, not a silent fallback", async () => {
  const client = fakeMembershipClient({ data: false, error: null });
  const result = await resolveAccountScope(client, "caller-1", "someone-elses-account");
  assertEquals(result, null, "must never fall back to the caller's own account when authorization is denied");
});

Deno.test("resolveAccountScope: the membership RPC erroring out is treated as unauthorized, not a crash or a pass-through", async () => {
  const client = fakeMembershipClient({ data: null, error: { message: "db unavailable" } });
  const result = await resolveAccountScope(client, "caller-1", "some-account");
  assertEquals(result, null);
});

Deno.test("resolveAccountScope: a non-string account_id (e.g. malformed JSON) is treated as absent, not an authorization bypass attempt", async () => {
  const client = fakeMembershipClient({ data: true, error: null });
  // deno-lint-ignore no-explicit-any
  const result = await resolveAccountScope(client, "caller-1", 12345 as any);
  assertEquals(result, "caller-1");
  assertEquals(client.calls.length, 0);
});

Deno.test("resolveAccountScope: an empty-string account_id is treated as absent", async () => {
  const client = fakeMembershipClient({ data: true, error: null });
  const result = await resolveAccountScope(client, "caller-1", "");
  assertEquals(result, "caller-1");
  assertEquals(client.calls.length, 0);
});

Deno.test("resolveAccountScope: forwards a given permission category to the RPC", async () => {
  const client = fakeMembershipClient({ data: true, error: null });
  const result = await resolveAccountScope(client, "caller-1", "owner-account-9", "integrations");
  assertEquals(result, "owner-account-9");
  assertEquals(client.calls[0].args, { _account_owner_id: "owner-account-9", _min_role: "owner", _permission: "integrations" });
});

Deno.test("resolveAccountScope: a member restricted to a DIFFERENT permission category is denied", async () => {
  // Simulates is_account_member itself returning false because the
  // member's permissions array doesn't include the one asked for -- the
  // fake here just returns the DB's answer directly, same as the real RPC.
  const client = fakeMembershipClient({ data: false, error: null });
  const result = await resolveAccountScope(client, "caller-1", "owner-account-9", "spend");
  assertEquals(result, null);
});
