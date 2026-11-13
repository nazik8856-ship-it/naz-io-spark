import { eraseAccount } from "./account-erasure.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

const U = "00000000-0000-0000-0000-0000000000a1";

function fakeAdmin(opts: { integrations?: { provider: string; agent_id: string | null }[]; rpcError?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    from: (_t: string) => ({ select: () => ({ eq: async () => ({ data: opts.integrations ?? [], error: null }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}:${args._user_id}`);
      return opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: { projects: 2, websites: 1 }, error: null };
    },
  };
}

Deno.test("each connected service is cancelled once, then the account is erased", async () => {
  const admin = fakeAdmin({ integrations: [{ provider: "Gmail", agent_id: null }, { provider: "Gmail", agent_id: null }, { provider: "Notion", agent_id: "a1" }] });
  const seen: string[] = [];
  const r = await eraseAccount(admin, U, { disconnect: async (_a, t) => { seen.push(`${t.provider}/${t.agentId}`); admin.calls.push("disconnect"); return { ok: true, revocations: [] }; } });
  assert(r.ok);
  assertEquals(seen, ["Gmail/null", "Notion/a1"]);
  assertEquals(admin.calls, ["disconnect", "disconnect", `rpc:erase_account:${U}`]); // revocation first, the erasure last
  assertEquals(r.ok && r.counts.projects, 2);
});

Deno.test("a provider that fails does not stop the erasure", async () => {
  const admin = fakeAdmin({ integrations: [{ provider: "Gmail", agent_id: null }] });
  const r = await eraseAccount(admin, U, { disconnect: async () => ({ ok: false, error: "provider down" }) });
  assert(r.ok);
  assertEquals(r.ok && r.revoked, 0);
  assert(admin.calls.includes(`rpc:erase_account:${U}`));
});

Deno.test("when the database refuses (rows would be left, or a staff account), the result says so and nothing is claimed", async () => {
  const admin = fakeAdmin({ rpcError: "rows left in projects: 1" });
  const r = await eraseAccount(admin, U, { disconnect: async () => ({ ok: true, revocations: [] }) });
  assert(!r.ok);
  assertEquals(!r.ok && r.error, "rows left in projects: 1");
});

Deno.test("an exception is an error result, never a throw", async () => {
  const admin = { from: () => { throw new Error("boom"); }, rpc: async () => ({ data: null, error: null }) };
  const r = await eraseAccount(admin, U);
  assert(!r.ok);
});
