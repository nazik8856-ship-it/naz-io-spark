// Real tests for the webhook delivery retry/backoff logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/webhook-retry_test.ts
import { isRetryEligible, computeBackoffSeconds, computeNextRetryAt, MAX_ATTEMPTS } from "./webhook-retry.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("isRetryEligible: a successful delivery is never retried", () => {
  assertEquals(isRetryEligible(1, true), false);
});

Deno.test("isRetryEligible: a failed delivery under the max attempt count is retried", () => {
  assertEquals(isRetryEligible(1, false), true);
  assertEquals(isRetryEligible(MAX_ATTEMPTS - 1, false), true);
});

Deno.test("isRetryEligible: a failed delivery at or past the max attempt count is not retried", () => {
  assertEquals(isRetryEligible(MAX_ATTEMPTS, false), false);
  assertEquals(isRetryEligible(MAX_ATTEMPTS + 1, false), false);
});

Deno.test("computeBackoffSeconds: doubles each attempt", () => {
  assertEquals(computeBackoffSeconds(1), 30);
  assertEquals(computeBackoffSeconds(2), 60);
  assertEquals(computeBackoffSeconds(3), 120);
  assertEquals(computeBackoffSeconds(4), 240);
});

Deno.test("computeBackoffSeconds: caps at 1 hour instead of growing unbounded", () => {
  assertEquals(computeBackoffSeconds(10), 3600);
  assertEquals(computeBackoffSeconds(20), 3600);
});

Deno.test("computeNextRetryAt: adds the backoff delay to the given time", () => {
  const now = new Date("2026-08-20T00:00:00Z");
  const next = computeNextRetryAt(1, now);
  assertEquals(next.toISOString(), "2026-08-20T00:00:30.000Z");
});

Deno.test("computeNextRetryAt: later attempts produce a further-out time", () => {
  const now = new Date("2026-08-20T00:00:00Z");
  const attempt1 = computeNextRetryAt(1, now).getTime();
  const attempt3 = computeNextRetryAt(3, now).getTime();
  assertEquals(attempt3 > attempt1, true);
});
