// Real tests for the control-api abuse-sweep pure classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/control-api-abuse_test.ts
import { isNonAllowDecision, summarizeKeyActivity, isVolumeAbuse, isBlockRateAbuse, summarizeAbuseReason, isCurrentlyPaused, computePauseUntil, pausedKeyMessage, PAUSE_COOLDOWN_MINUTES } from "./control-api-abuse.ts";

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

Deno.test("isNonAllowDecision: an ALLOW decision is not non-allow", () => {
  assertFalse(isNonAllowDecision("ALLOW send_email (Gmail)"));
});

Deno.test("isNonAllowDecision: BLOCK/MODIFY/CIRCUIT_BREAKER_TRIPPED are all non-allow", () => {
  assert(isNonAllowDecision("BLOCK send_email (Gmail)"));
  assert(isNonAllowDecision("MODIFY send_email (Gmail)"));
  assert(isNonAllowDecision("CIRCUIT_BREAKER_TRIPPED send_email (Gmail)"));
});

Deno.test("isNonAllowDecision: case-insensitive and tolerates surrounding whitespace", () => {
  assertFalse(isNonAllowDecision("  allow something  "));
});

Deno.test("summarizeKeyActivity: groups rows by api_key_id and counts non-allow correctly", () => {
  const rows = [
    { api_key_id: "key-1", user_id: "user-1", decision: "ALLOW a" },
    { api_key_id: "key-1", user_id: "user-1", decision: "BLOCK b" },
    { api_key_id: "key-2", user_id: "user-2", decision: "ALLOW c" },
  ];
  const summary = summarizeKeyActivity(rows);
  const key1 = summary.find((s) => s.apiKeyId === "key-1");
  const key2 = summary.find((s) => s.apiKeyId === "key-2");
  assertEquals(key1, { apiKeyId: "key-1", userId: "user-1", total: 2, nonAllow: 1 });
  assertEquals(key2, { apiKeyId: "key-2", userId: "user-2", total: 1, nonAllow: 0 });
});

Deno.test("summarizeKeyActivity: empty input produces an empty summary", () => {
  assertEquals(summarizeKeyActivity([]), []);
});

Deno.test("isVolumeAbuse: at or above the threshold is abuse", () => {
  assert(isVolumeAbuse(500, 500));
  assert(isVolumeAbuse(600, 500));
});

Deno.test("isVolumeAbuse: below the threshold is not abuse", () => {
  assertFalse(isVolumeAbuse(499, 500));
});

Deno.test("isBlockRateAbuse: a high rate on a meaningful sample is abuse", () => {
  assert(isBlockRateAbuse(20, 15, 20, 0.5));
});

Deno.test("isBlockRateAbuse: a high rate on too small a sample is NOT abuse (avoids alerting on a brand-new key's first few blocks)", () => {
  assertFalse(isBlockRateAbuse(3, 3, 20, 0.5));
});

Deno.test("isBlockRateAbuse: a large sample with a healthy rate is not abuse", () => {
  assertFalse(isBlockRateAbuse(100, 10, 20, 0.5));
});

Deno.test("isBlockRateAbuse: exactly at the rate threshold is abuse", () => {
  assert(isBlockRateAbuse(20, 10, 20, 0.5));
});

Deno.test("summarizeAbuseReason: mentions both signals when both fire", () => {
  const reason = summarizeAbuseReason({ apiKeyId: "k", userId: "u", total: 600, nonAllow: 400 }, 500, 20, 0.5);
  assert(reason.includes("600"));
  assert(reason.includes("both"));
});

Deno.test("summarizeAbuseReason: mentions only volume when just volume fires", () => {
  const reason = summarizeAbuseReason({ apiKeyId: "k", userId: "u", total: 600, nonAllow: 5 }, 500, 20, 0.5);
  assert(reason.includes("600"));
  assertFalse(reason.includes("both"));
});

Deno.test("summarizeAbuseReason: mentions the rate when just the rate fires", () => {
  const reason = summarizeAbuseReason({ apiKeyId: "k", userId: "u", total: 30, nonAllow: 20 }, 500, 20, 0.5);
  assert(reason.includes("20 of 30"));
});

// ---- item 7: auto-pause a runaway key ----

Deno.test("isCurrentlyPaused: null/undefined pausedUntil is never paused", () => {
  assertFalse(isCurrentlyPaused(null));
  assertFalse(isCurrentlyPaused(undefined));
});

Deno.test("isCurrentlyPaused: a future timestamp is currently paused; a past one is not", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  assert(isCurrentlyPaused("2026-08-28T12:30:00Z", now));
  assertFalse(isCurrentlyPaused("2026-08-28T11:30:00Z", now));
});

Deno.test("isCurrentlyPaused: exactly now is no longer paused (the window has to be strictly in the future)", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  assertFalse(isCurrentlyPaused(now.toISOString(), now));
});

Deno.test("computePauseUntil: PAUSE_COOLDOWN_MINUTES from now, exactly", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  const expected = new Date(now.getTime() + PAUSE_COOLDOWN_MINUTES * 60_000).toISOString();
  assertEquals(computePauseUntil(now), expected);
});

Deno.test("pausedKeyMessage: names the resume time and is explicit that no human action is needed", () => {
  const msg = pausedKeyMessage("2026-08-28T12:30:00.000Z");
  assert(msg.includes("2026-08-28T12:30:00.000Z"));
  assert(msg.toLowerCase().includes("automatically") || msg.toLowerCase().includes("on its own"));
});
