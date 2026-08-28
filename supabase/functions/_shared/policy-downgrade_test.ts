// Real tests for item 4's auto-downgrade classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/policy-downgrade_test.ts
import {
  isRepeatedPauseTrouble, isCallbackFailureTrouble, isBadOutcomeTrouble, summarizePolicyDowngrade,
  REPEATED_PAUSE_WINDOW_MS, CALLBACK_FAILURE_STREAK_THRESHOLD, BAD_OUTCOME_MIN_SAMPLE, BAD_OUTCOME_NEGATIVE_RATE_THRESHOLD,
} from "./policy-downgrade.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- isRepeatedPauseTrouble ----

Deno.test("isRepeatedPauseTrouble: no previous pause at all is never repeated trouble", () => {
  assertFalse(isRepeatedPauseTrouble(null));
  assertFalse(isRepeatedPauseTrouble(undefined));
});

Deno.test("isRepeatedPauseTrouble: a previous pause within the window is repeated trouble", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const previous = new Date(now.getTime() - REPEATED_PAUSE_WINDOW_MS / 2).toISOString();
  assert(isRepeatedPauseTrouble(previous, now));
});

Deno.test("isRepeatedPauseTrouble: a previous pause well outside the window is NOT repeated trouble -- an isolated old incident", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const longAgo = new Date(now.getTime() - REPEATED_PAUSE_WINDOW_MS * 10).toISOString();
  assertFalse(isRepeatedPauseTrouble(longAgo, now));
});

Deno.test("isRepeatedPauseTrouble: exactly at the window boundary still counts", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const atBoundary = new Date(now.getTime() - REPEATED_PAUSE_WINDOW_MS).toISOString();
  assert(isRepeatedPauseTrouble(atBoundary, now));
});

// ---- isCallbackFailureTrouble ----

Deno.test("isCallbackFailureTrouble: below the threshold is not trouble", () => {
  assertEquals(CALLBACK_FAILURE_STREAK_THRESHOLD, 3);
  assertFalse(isCallbackFailureTrouble(2));
});

Deno.test("isCallbackFailureTrouble: at or above the threshold is trouble", () => {
  assert(isCallbackFailureTrouble(3));
  assert(isCallbackFailureTrouble(5));
});

Deno.test("isCallbackFailureTrouble: zero (a healthy streak) is never trouble", () => {
  assertFalse(isCallbackFailureTrouble(0));
});

// ---- summarizePolicyDowngrade ----

Deno.test("summarizePolicyDowngrade: names repeated pauses as the reason, and that this is system-initiated", () => {
  const msg = summarizePolicyDowngrade("repeated_pause", "");
  assert(msg.includes("human_review"));
  assert(msg.toLowerCase().includes("more than once"));
  assert(msg.toLowerCase().includes("system-initiated"));
});

Deno.test("summarizePolicyDowngrade: names the callback failure streak with its real count", () => {
  const msg = summarizePolicyDowngrade("callback_failures", "3");
  assert(msg.includes("3 times in a row"));
});

// ---- isBadOutcomeTrouble ----

Deno.test("isBadOutcomeTrouble: below the minimum sample is never trouble, even at a 100% negative rate", () => {
  assertEquals(BAD_OUTCOME_MIN_SAMPLE, 5);
  assertFalse(isBadOutcomeTrouble(3, 3));
});

Deno.test("isBadOutcomeTrouble: enough sample but below the negative-rate threshold is not trouble", () => {
  assertEquals(BAD_OUTCOME_NEGATIVE_RATE_THRESHOLD, 0.4);
  assertFalse(isBadOutcomeTrouble(1, 10));
});

Deno.test("isBadOutcomeTrouble: enough sample and at or above the negative-rate threshold IS trouble", () => {
  assert(isBadOutcomeTrouble(4, 10));
  assert(isBadOutcomeTrouble(5, 5));
});

Deno.test("isBadOutcomeTrouble: zero measured outcomes is never trouble, not a division-by-zero crash", () => {
  assertFalse(isBadOutcomeTrouble(0, 0));
});

// ---- summarizePolicyDowngrade: bad_outcomes ----

Deno.test("summarizePolicyDowngrade: names the real negative-outcome rate as the reason", () => {
  const msg = summarizePolicyDowngrade("bad_outcomes", "60%");
  assert(msg.includes("60%"));
  assert(msg.toLowerCase().includes("real-world negative outcomes"));
  assert(msg.includes("human_review"));
});
