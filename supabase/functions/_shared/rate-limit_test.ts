// Real tests for the rate-limit window bucketing + atomic-check wrapper.
//
// Run with: deno test --allow-none supabase/functions/_shared/rate-limit_test.ts
import { computeWindowStart, checkRateLimit } from "./rate-limit.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("computeWindowStart: floors to the start of a 60s window", () => {
  const t = new Date("2026-08-19T12:00:37.500Z");
  assertEquals(computeWindowStart(t, 60), "2026-08-19T12:00:00.000Z");
});

Deno.test("computeWindowStart: two timestamps in the same window produce the same bucket", () => {
  const a = new Date("2026-08-19T12:00:01.000Z");
  const b = new Date("2026-08-19T12:00:59.000Z");
  assertEquals(computeWindowStart(a, 60), computeWindowStart(b, 60));
});

Deno.test("computeWindowStart: crossing a window boundary produces a different bucket", () => {
  const a = new Date("2026-08-19T12:00:59.000Z");
  const b = new Date("2026-08-19T12:01:00.000Z");
  assert(computeWindowStart(a, 60) !== computeWindowStart(b, 60));
});

Deno.test("computeWindowStart: works for non-60s windows too", () => {
  const t = new Date("2026-08-19T12:00:37.000Z");
  assertEquals(computeWindowStart(t, 30), "2026-08-19T12:00:30.000Z");
});

type Row = { data?: unknown; error?: unknown };
function fakeClient(rpcResult: Row) {
  return {
    rpc(_name: string, _args: unknown) { return Promise.resolve(rpcResult); },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("checkRateLimit: under the limit is allowed", async () => {
  const client = fakeClient({ data: 5, error: null });
  const result = await checkRateLimit(client, "user-1", "control-engine", 10, 60);
  assertEquals(result, { allowed: true, count: 5, limit: 10 });
});

Deno.test("checkRateLimit: exactly at the limit is still allowed", async () => {
  const client = fakeClient({ data: 10, error: null });
  const result = await checkRateLimit(client, "user-1", "control-engine", 10, 60);
  assertEquals(result.allowed, true);
});

Deno.test("checkRateLimit: over the limit is blocked", async () => {
  const client = fakeClient({ data: 11, error: null });
  const result = await checkRateLimit(client, "user-1", "control-engine", 10, 60);
  assertEquals(result, { allowed: false, count: 11, limit: 10 });
});

Deno.test("checkRateLimit: fails OPEN (allowed) when the RPC itself errors", async () => {
  const client = fakeClient({ data: null, error: { message: "db down" } });
  const result = await checkRateLimit(client, "user-1", "control-engine", 10, 60);
  assertEquals(result.allowed, true);
});

Deno.test("checkRateLimit: fails OPEN (allowed) if the RPC call throws", async () => {
  const client = { rpc() { throw new Error("network error"); } };
  // deno-lint-ignore no-explicit-any
  const result = await checkRateLimit(client as any, "user-1", "control-engine", 10, 60);
  assertEquals(result.allowed, true);
});
