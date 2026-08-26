// Real tests for the rate-limit window bucketing + atomic-check wrapper.
//
// Run with: deno test --allow-none supabase/functions/_shared/rate-limit_test.ts
import { computeWindowStart, checkRateLimit, checkIpRateLimit, resolveConfiguredRateLimit } from "./rate-limit.ts";

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

// ---- item 11: per-api-key configurable rate limit ----

Deno.test("resolveConfiguredRateLimit: a valid positive configured value wins over the fallback", () => {
  assertEquals(resolveConfiguredRateLimit(500, 30), 500);
  assertEquals(resolveConfiguredRateLimit(1, 30), 1, "even a stricter-than-default configured value must be honored");
});

Deno.test("resolveConfiguredRateLimit: null/undefined fall back to the platform default", () => {
  assertEquals(resolveConfiguredRateLimit(null, 30), 30);
  assertEquals(resolveConfiguredRateLimit(undefined, 30), 30);
});

Deno.test("resolveConfiguredRateLimit: zero, negative, or non-finite values are never treated as 'no limit' -- fall back instead", () => {
  assertEquals(resolveConfiguredRateLimit(0, 30), 30);
  assertEquals(resolveConfiguredRateLimit(-5, 30), 30);
  assertEquals(resolveConfiguredRateLimit(NaN, 30), 30);
  assertEquals(resolveConfiguredRateLimit(Infinity, 30), 30);
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

// ---- checkIpRateLimit (pre-auth, IP-keyed -- control-api) ------------------

Deno.test("checkIpRateLimit: under the limit is allowed", async () => {
  const client = fakeClient({ data: 5, error: null });
  const result = await checkIpRateLimit(client, "1.2.3.4", "control-api-preauth", 10, 60);
  assertEquals(result, { allowed: true, count: 5, limit: 10 });
});

Deno.test("checkIpRateLimit: over the limit is blocked", async () => {
  const client = fakeClient({ data: 11, error: null });
  const result = await checkIpRateLimit(client, "1.2.3.4", "control-api-preauth", 10, 60);
  assertEquals(result, { allowed: false, count: 11, limit: 10 });
});

Deno.test("checkIpRateLimit: fails OPEN (allowed) when the RPC itself errors", async () => {
  const client = fakeClient({ data: null, error: { message: "db down" } });
  const result = await checkIpRateLimit(client, "1.2.3.4", "control-api-preauth", 10, 60);
  assertEquals(result.allowed, true);
});

Deno.test("checkIpRateLimit: fails OPEN (allowed) if the RPC call throws", async () => {
  const client = { rpc() { throw new Error("network error"); } };
  // deno-lint-ignore no-explicit-any
  const result = await checkIpRateLimit(client as any, "1.2.3.4", "control-api-preauth", 10, 60);
  assertEquals(result.allowed, true);
});
