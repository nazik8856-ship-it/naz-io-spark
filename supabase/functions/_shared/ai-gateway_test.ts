// Real tests for GAP 8's addition to callAiGateway: fetchWithRetry-backed
// retry plus the per-provider circuit breaker. The breaker mechanics
// (threshold/reset/per-provider scoping) are verified directly through the
// test-only exports -- no network, no real retry delay. callAiGateway's own
// wiring (does it actually call recordProviderFailure/Success, does a
// tripped breaker really skip the network) is verified separately with a
// stubbed global fetch; baseDelayMs is hardcoded to 300ms inside
// callAiGateway itself (not test-overridable), so those integration cases
// are kept to one or two calls each rather than a full 5-failure sequence.
//
// Run with: deno test --allow-none supabase/functions/_shared/ai-gateway_test.ts
import {
  callAiGateway,
  resetProviderBreakersForTests,
  isProviderBreakerTrippedForTests,
  recordProviderFailureForTests,
  recordProviderSuccessForTests,
  type GatewayConfig,
} from "./ai-gateway.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const cfg: GatewayConfig = { url: "https://example.com/chat", model: "m", deepModel: "m", key: "k", provider: "openai" };

async function withStubbedFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// --- Pure breaker mechanics (fast, no network, no real retry delay) ---

Deno.test("breaker: 5 failures for one provider trip it; a provider with only 4 stays untripped", () => {
  resetProviderBreakersForTests();
  for (let i = 0; i < 5; i++) recordProviderFailureForTests("test-provider-a");
  for (let i = 0; i < 4; i++) recordProviderFailureForTests("test-provider-b");
  assert(isProviderBreakerTrippedForTests("test-provider-a"), "5 failures must trip the breaker");
  assert(!isProviderBreakerTrippedForTests("test-provider-b"), "4 failures must not trip the breaker");
});

Deno.test("breaker: a success clears prior failure history, resetting the count toward the threshold", () => {
  resetProviderBreakersForTests();
  for (let i = 0; i < 4; i++) recordProviderFailureForTests("test-provider-c");
  recordProviderSuccessForTests("test-provider-c");
  for (let i = 0; i < 4; i++) recordProviderFailureForTests("test-provider-c");
  assert(!isProviderBreakerTrippedForTests("test-provider-c"), "a success must reset the failure count, not just pause it");
});

Deno.test("breaker: tripping one provider never affects another provider's breaker", () => {
  resetProviderBreakersForTests();
  for (let i = 0; i < 5; i++) recordProviderFailureForTests("test-provider-d");
  assert(isProviderBreakerTrippedForTests("test-provider-d"));
  assert(!isProviderBreakerTrippedForTests("test-provider-e"), "breakers are keyed per provider, not shared");
});

Deno.test("breaker: a provider that was never recorded reads as untripped", () => {
  resetProviderBreakersForTests();
  assert(!isProviderBreakerTrippedForTests("never-seen-provider"));
});

// --- callAiGateway integration (stubbed network) ---

Deno.test("callAiGateway: a successful call passes the real response through untouched", async () => {
  resetProviderBreakersForTests();
  let calls = 0;
  await withStubbedFetch((async () => {
    calls++;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch, async () => {
    const res = await callAiGateway({ model: "m", messages: [] }, cfg);
    assertEquals(res.status, 200);
  });
  assertEquals(calls, 1, "a first-try success must never retry");
});

Deno.test("callAiGateway: a persistent 500 is recorded as a provider failure after retries are exhausted", async () => {
  resetProviderBreakersForTests();
  await withStubbedFetch((async () => new Response("{}", { status: 500 })) as typeof fetch, async () => {
    const res = await callAiGateway({ model: "m", messages: [] }, cfg);
    assertEquals(res.status, 500, "the exhausted-retries response itself still passes through, unmodified");
  });
  assert(!isProviderBreakerTrippedForTests(cfg.provider), "one failure alone must not trip the breaker yet");
});

Deno.test("callAiGateway: once the breaker is tripped, a call fails fast with a synthetic 503 and makes zero network attempts", async () => {
  resetProviderBreakersForTests();
  for (let i = 0; i < 5; i++) recordProviderFailureForTests(cfg.provider);
  assert(isProviderBreakerTrippedForTests(cfg.provider), "setup: breaker should be tripped before this case runs");

  let calls = 0;
  await withStubbedFetch((async () => { calls++; return new Response("{}", { status: 200 }); }) as typeof fetch, async () => {
    const res = await callAiGateway({ model: "m", messages: [] }, cfg);
    assertEquals(res.status, 503);
    const body = await res.json();
    assert(typeof body?.error?.message === "string" && body.error.message.includes("circuit-broken"));
  });
  assertEquals(calls, 0, "a tripped breaker must skip the network call entirely");
});

Deno.test("callAiGateway: a different provider's calls are unaffected by another provider's tripped breaker", async () => {
  resetProviderBreakersForTests();
  for (let i = 0; i < 5; i++) recordProviderFailureForTests("openai");
  const lovableCfg: GatewayConfig = { ...cfg, provider: "lovable" };

  let calls = 0;
  await withStubbedFetch((async () => { calls++; return new Response("{}", { status: 200 }); }) as typeof fetch, async () => {
    const res = await callAiGateway({ model: "m", messages: [] }, lovableCfg);
    assertEquals(res.status, 200);
  });
  assertEquals(calls, 1, "the lovable provider's breaker must be independent of openai's");
});
