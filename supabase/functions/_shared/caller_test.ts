import { assertOwned, notFoundResponse, requireCaller, resolveCallerAccount, resolveCallerReadAccount, type CallerClient } from "./caller.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000b2";

/** A client whose token belongs to `uid` (or to nobody), and whose team table says who is a member of whom. */
function client(uid: string | null, memberOf: string[] = [], calls: Record<string, unknown>[] = []): CallerClient {
  return {
    auth: { getUser: async () => (uid ? { data: { user: { id: uid } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }) },
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, ...args }); return { data: memberOf.includes(String(args._account_owner_id)), error: null }; },
  };
}
const req = (auth?: string, body?: unknown) => new Request("https://x.test/f", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body ?? {}) });

Deno.test("requireCaller: the user is the one the token belongs to, never what the body says", async () => {
  const r = await requireCaller(req("Bearer tok-a", { userId: B, user_id: B, account_id: B }), () => client(A));
  assert(r.ok);
  assertEquals(r.caller.userId, A);
});

Deno.test("requireCaller: no header, a malformed one, a bad token and a thrown client are all 401", async () => {
  for (const [name, request, make] of [
    ["no header", req(), () => client(A)],
    ["not a bearer", req("Basic abc"), () => client(A)],
    ["empty bearer", req("Bearer "), () => client(A)],
    ["bad token", req("Bearer nope"), () => client(null)],
    ["client throws", req("Bearer tok"), () => { throw new Error("boom"); }],
  ] as const) {
    const r = await requireCaller(request, make as () => CallerClient);
    assert(!r.ok, name);
    assertEquals(r.status, 401, name);
  }
});

Deno.test("resolveCallerAccount: own account by default; a team account only for a member; otherwise null (never the caller's own)", async () => {
  const calls: Record<string, unknown>[] = [];
  const r = await requireCaller(req("Bearer t"), () => client(A, [B], calls));
  assert(r.ok);
  assertEquals(await resolveCallerAccount(r.caller, undefined), A);
  assertEquals(await resolveCallerAccount(r.caller, A), A);
  assertEquals(calls.length, 0, "no team lookup for the caller's own account");
  assertEquals(await resolveCallerAccount(r.caller, B, "policy"), B);
  assertEquals(calls[0]._permission, "policy");
  assertEquals(calls[0]._min_role, "owner");
  const stranger = await requireCaller(req("Bearer t"), () => client(A, []));
  assert(stranger.ok);
  assertEquals(await resolveCallerAccount(stranger.caller, B), null);
});

// A tiny in-memory table that applies the filters it is given, so the test shows what the query itself returns.
function table(rows: Record<string, unknown>[]) {
  return {
    from: (_t: string) => {
      const f: [string, unknown][] = [];
      const q = {
        select: (_c: string) => q,
        eq: (c: string, v: unknown) => { f.push([c, v]); return q; },
        maybeSingle: async () => ({ data: rows.find((r) => f.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      };
      return q;
    },
  };
}

Deno.test("assertOwned: the row for its owner; a foreign id and a missing id both come back empty", async () => {
  const admin = table([{ id: "t1", user_id: A, name: "mine" }, { id: "t2", user_id: B, name: "theirs" }]);
  assertEquals((await assertOwned(admin, "external_tools", "t1", A))?.name, "mine");
  assertEquals(await assertOwned(admin, "external_tools", "t2", A), null, "B's row is not found for A");
  assertEquals(await assertOwned(admin, "external_tools", "nope", A), null, "and a missing one looks the same");
});

Deno.test("assertOwned: a non-string id, an empty id or an empty account is never looked up", async () => {
  let looked = 0;
  const admin = { from: () => { looked++; return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "x" }, error: null }) }) }) }) }; } };
  for (const id of [undefined, null, 5, "", { id: "x" }]) assertEquals(await assertOwned(admin, "t", id, A), null);
  assertEquals(await assertOwned(admin, "t", "x", ""), null);
  assertEquals(looked, 0);
});

Deno.test("assertOwned: another owner column, and a database error, are handled", async () => {
  const admin = table([{ id: "m1", account_owner_id: A }]);
  assert(await assertOwned(admin, "account_members", "m1", A, { ownerColumn: "account_owner_id" }));
  assertEquals(await assertOwned(admin, "account_members", "m1", B, { ownerColumn: "account_owner_id" }), null);
  const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "db down" } }) }) }) }) }) };
  assertEquals(await assertOwned(broken, "t", "x", A), null, "an error is never treated as ownership");
});

Deno.test("notFoundResponse: 404 with the same body whatever the id was", async () => {
  const res = notFoundResponse({ "Access-Control-Allow-Origin": "*" }, "Event not found");
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found", message: "Event not found" });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("resolveCallerReadAccount: any member (viewer or above) may read their team's account; a stranger may not", async () => {
  const calls: Record<string, unknown>[] = [];
  const member = await requireCaller(req("Bearer t"), () => client(A, [B], calls));
  assert(member.ok);
  assertEquals(await resolveCallerReadAccount(member.caller, B), B);
  assertEquals(calls[0]._min_role, "viewer", "viewer is enough to read");
  assertEquals(await resolveCallerReadAccount(member.caller, undefined), A);
  assertEquals(await resolveCallerReadAccount(member.caller, 42), A, "a non-string account is ignored, not trusted");
  const stranger = await requireCaller(req("Bearer t"), () => client(A, []));
  assert(stranger.ok);
  assertEquals(await resolveCallerReadAccount(stranger.caller, B), null);
});
