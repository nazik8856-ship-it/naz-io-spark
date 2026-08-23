// Real tests for fetchWithRetry's transient-failure retry/backoff logic.
// Uses a tiny fake fetch (opts.fetchImpl) instead of the real network, and
// a 1ms baseDelayMs so the tests run instantly.
//
// Run with: deno test --allow-none supabase/functions/_shared/fetch-retry_test.ts
import { fetchWithRetry } from "./fetch-retry.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function fakeResponse(status: number): Response {
  return new Response(JSON.stringify({ status }), { status });
}

Deno.test("fetchWithRetry: a successful first attempt returns immediately, no retry", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return fakeResponse(200); }) as typeof fetch;
  const res = await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(calls, 1);
});

Deno.test("fetchWithRetry: a permanent 4xx rejection is returned immediately, never retried", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return fakeResponse(404); }) as typeof fetch;
  const res = await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1 });
  assertEquals(res.status, 404);
  assertEquals(calls, 1, "a real 4xx rejection must never be retried");
});

Deno.test("fetchWithRetry: a 429 is retried and succeeds on the next attempt", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return calls === 1 ? fakeResponse(429) : fakeResponse(200);
  }) as typeof fetch;
  const res = await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(calls, 2);
});

Deno.test("fetchWithRetry: a 503 is retried, same as a 429", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return calls < 3 ? fakeResponse(503) : fakeResponse(200);
  }) as typeof fetch;
  const res = await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1, attempts: 3 });
  assertEquals(res.status, 200);
  assertEquals(calls, 3);
});

Deno.test("fetchWithRetry: exhausting all attempts on a persistent 500 returns the last (failed) response, not an error", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return fakeResponse(500); }) as typeof fetch;
  const res = await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1, attempts: 3 });
  assertEquals(res.status, 500);
  assertEquals(calls, 3, "expected exactly `attempts` calls, no more, no fewer");
});

Deno.test("fetchWithRetry: a thrown network error is retried", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) throw new Error("network reset");
    return fakeResponse(200);
  }) as typeof fetch;
  const res = await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1 });
  assertEquals(res.status, 200);
  assertEquals(calls, 2);
});

Deno.test("fetchWithRetry: a network error on every attempt rethrows after exhausting retries", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; throw new Error("network reset"); }) as typeof fetch;
  let threw = false;
  try {
    await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1, attempts: 3 });
  } catch {
    threw = true;
  }
  assert(threw, "expected fetchWithRetry to rethrow once retries are exhausted");
  assertEquals(calls, 3);
});

Deno.test("fetchWithRetry: attempts defaults to 3 when not specified", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return fakeResponse(500); }) as typeof fetch;
  await fetchWithRetry("https://example.com", {}, { fetchImpl, baseDelayMs: 1 });
  assertEquals(calls, 3);
});
