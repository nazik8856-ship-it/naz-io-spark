import { checkFreeLimit, FREE_LIMITS, freeLimitFromDbError, freeLimitMessage, freeLimitRefusal } from "./free-limits.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

const fakeAdmin = (result: { data?: unknown; error?: { message: string } | null; throws?: boolean }) => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (result.throws) throw new Error("network down");
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };
};

Deno.test("the free limits are 3 Control Tasks and 2 websites a month", () => {
  assertEquals(FREE_LIMITS, { control_task: 3, website: 2 });
});

Deno.test("an account within its allowance may start", async () => {
  const admin = fakeAdmin({ data: { kind: "control_task", limited: true, used: 2, limit: 3, allowed: true } });
  assertEquals(await checkFreeLimit(admin, "u1", "control_task"), { ok: true });
  assertEquals(admin.calls, [{ name: "free_limit_status", args: { _user_id: "u1", _kind: "control_task" } }]);
});

Deno.test("an account past its allowance is refused with the details the limit window shows", async () => {
  const admin = fakeAdmin({ data: { kind: "website", limited: true, used: 2, limit: 2, allowed: false, resets_at: "2026-12-01T00:00:00+00:00" } });
  const r = await checkFreeLimit(admin, "u1", "website");
  assert(!r.ok);
  assertEquals(r.refusal.error, "free_limit");
  assertEquals(r.refusal.kind, "website");
  assertEquals([r.refusal.used, r.refusal.limit], [2, 2]);
  assertEquals(r.refusal.resets_at, "2026-12-01T00:00:00+00:00");
  assertEquals(r.refusal.message, freeLimitMessage("website", 2));
});

Deno.test("an unlimited account (paid tier or exempt email) is never refused", async () => {
  assertEquals(await checkFreeLimit(fakeAdmin({ data: { kind: "control_task", limited: false, limit: 3 } }), "u1", "control_task"), { ok: true });
});

Deno.test("a failed lookup does not block anyone (the insert trigger is the backstop)", async () => {
  assertEquals(await checkFreeLimit(fakeAdmin({ error: { message: "boom" } }), "u1", "control_task"), { ok: true });
  assertEquals(await checkFreeLimit(fakeAdmin({ throws: true }), "u1", "website"), { ok: true });
});

Deno.test("the message is calm: it says what stays available and never talks about locks", () => {
  for (const kind of ["control_task", "website"] as const) {
    const m = freeLimitMessage(kind);
    assert(/stay available/.test(m), m);
    assert(!/lock|blocked|denied|punish|!/i.test(m), m);
  }
});

Deno.test("the insert trigger's refusal is recognised", () => {
  assertEquals(freeLimitFromDbError({ message: "free_limit:control_task" }), "control_task");
  assertEquals(freeLimitFromDbError({ message: "free_limit:website" }), "website");
  assertEquals(freeLimitFromDbError({ message: "duplicate key value" }), null);
  assertEquals(freeLimitFromDbError(null), null);
  assertEquals(freeLimitRefusal("control_task").limit, 3);
});
