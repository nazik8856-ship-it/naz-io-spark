// Real tests for the platform-wide status classification (item 9).
//
// Run with: deno test --allow-none supabase/functions/_shared/platform-status_test.ts
import { classifyPlatformStatus, platformStatusMessage, DEGRADED_MIN_SAMPLE, DEGRADED_ERROR_RATE_THRESHOLD } from "./platform-status.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("classifyPlatformStatus: the kill switch always means paused, regardless of error rate", () => {
  assertEquals(classifyPlatformStatus(true, 0, 0), "paused");
  assertEquals(classifyPlatformStatus(true, 1000, 999), "paused", "even a terrible error rate is still reported as 'paused', not 'degraded', once the kill switch is on");
});

Deno.test("classifyPlatformStatus: no traffic at all is operating normally, never degraded", () => {
  assertEquals(classifyPlatformStatus(false, 0, 0), "operating_normally");
});

Deno.test("classifyPlatformStatus: a couple of errors on a tiny sample is not degraded -- avoids a false alarm on quiet traffic", () => {
  assertEquals(classifyPlatformStatus(false, 3, 2), "operating_normally");
});

Deno.test("classifyPlatformStatus: a high error rate on a real sample is degraded", () => {
  const total = DEGRADED_MIN_SAMPLE;
  const errors = Math.ceil(total * DEGRADED_ERROR_RATE_THRESHOLD);
  assertEquals(classifyPlatformStatus(false, total, errors), "degraded");
});

Deno.test("classifyPlatformStatus: a healthy rate on a large sample is operating normally", () => {
  assertEquals(classifyPlatformStatus(false, 1000, 5), "operating_normally");
});

Deno.test("classifyPlatformStatus: exactly at the minimum sample and exactly at the threshold is degraded", () => {
  assertEquals(classifyPlatformStatus(false, DEGRADED_MIN_SAMPLE, DEGRADED_MIN_SAMPLE * DEGRADED_ERROR_RATE_THRESHOLD), "degraded");
});

Deno.test("platformStatusMessage: every status has a real, non-empty, distinct message", () => {
  const messages = new Set<string>();
  for (const status of ["operating_normally", "paused", "degraded"] as const) {
    const msg = platformStatusMessage(status);
    assert(typeof msg === "string" && msg.length > 0, `missing message for ${status}`);
    messages.add(msg);
  }
  assertEquals(messages.size, 3, "every status must have a distinct message");
});
