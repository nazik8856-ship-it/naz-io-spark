// Real tests for behavioral-baseline anomaly detection — the pure functions
// that decide whether a run's activity is abnormal for THIS agent, a
// distinct risk class from the circuit breaker (which only reacts to
// failures, not abnormal-but-successful volume).
// Run with: deno test supabase/functions/_shared/anomaly-detector_test.ts
import { buildBaseline, detectAnomaly, type ActionEvent } from "./anomaly-detector.ts";

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

// A day is provided as "YYYY-MM-DD"; events for that day get a fixed time.
const ev = (day: string, actionType: string): ActionEvent => ({ created_at: `${day}T12:00:00.000Z`, action_type: actionType });

// 14 distinct days, 2 send_email/day = 28 total → avg 2/day.
const fourteenDaysOfSteadyEmail: ActionEvent[] = Array.from({ length: 14 }, (_, i) => {
  const day = `2026-08-${String(i + 1).padStart(2, "0")}`;
  return [ev(day, "send_email"), ev(day, "send_email")];
}).flat();

// ---- buildBaseline ----------------------------------------------------------

Deno.test("buildBaseline: computes the correct daily average over the full window, not just days with data", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14);
  assertEquals(b.dailyAvgByType.send_email, 2);
  assertEquals(b.daysObserved, 14);
  assert(b.knownActionTypes.has("send_email"));
});

Deno.test("buildBaseline: sparse activity (data on only a few of the 14 days) still averages over the full window", () => {
  const events = [ev("2026-08-01", "slack_post_message"), ev("2026-08-02", "slack_post_message")];
  const b = buildBaseline(events, 14);
  // 2 occurrences / 14-day window, not / 2 days-with-data.
  assertEquals(b.dailyAvgByType.slack_post_message, 2 / 14);
  assertEquals(b.daysObserved, 2);
});

Deno.test("buildBaseline: tracks multiple action types independently", () => {
  const events = [ev("2026-08-01", "send_email"), ev("2026-08-01", "slack_post_message"), ev("2026-08-02", "send_email")];
  const b = buildBaseline(events, 14);
  assertEquals(b.knownActionTypes.has("send_email"), true);
  assertEquals(b.knownActionTypes.has("slack_post_message"), true);
  assertFalse(b.knownActionTypes.has("shopify_create_draft_order"));
});

Deno.test("buildBaseline: no events at all is a valid empty baseline, not a crash", () => {
  const b = buildBaseline([], 14);
  assertEquals(b.daysObserved, 0);
  assertEquals(b.knownActionTypes.size, 0);
});

// ---- detectAnomaly: insufficient history --------------------------------

Deno.test("detectAnomaly: a brand-new agent with <3 days of history is never flagged, even for a brand-new action type", () => {
  const b = buildBaseline([ev("2026-08-01", "send_email")], 14);
  const r = detectAnomaly(b, "shopify_create_draft_order", 50);
  assertFalse(r.anomalous, "insufficient baseline data must skip the check entirely, not force-approve everything");
});

// ---- detectAnomaly: never-used-before action type ------------------------

Deno.test("detectAnomaly: an action_type never seen in the baseline window is flagged regardless of volume", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // 14 days of send_email only
  const r = detectAnomaly(b, "shopify_create_draft_order", 1);
  assert(r.anomalous);
  if (r.anomalous) assertEquals(r.kind, "new_action_type");
});

Deno.test("detectAnomaly: a known action_type at normal volume is NOT flagged", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day
  const r = detectAnomaly(b, "send_email", 2);
  assertFalse(r.anomalous);
});

// ---- detectAnomaly: volume spike ------------------------------------------

Deno.test("detectAnomaly: 5x+ the daily average on a known action_type is flagged", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day → threshold 10
  const r = detectAnomaly(b, "send_email", 12);
  assert(r.anomalous);
  if (r.anomalous) assertEquals(r.kind, "volume_spike");
});

Deno.test("detectAnomaly: just under 5x the daily average is NOT flagged", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day → threshold 10
  const r = detectAnomaly(b, "send_email", 9);
  assertFalse(r.anomalous);
});

Deno.test("detectAnomaly: exactly at the multiplier threshold counts as anomalous (>=, not >)", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day → threshold exactly 10
  const r = detectAnomaly(b, "send_email", 10);
  assert(r.anomalous);
});

Deno.test("detectAnomaly: a near-zero baseline average does not make ordinary single-digit usage anomalous (absolute floor)", () => {
  // 1 occurrence across the whole 14-day window → avg ~0.07/day. Without an
  // absolute floor, 5x that average is ~0.36, so even a single occurrence
  // today would trip the multiplier check — a real false-positive risk for
  // any agent that uses a capability rarely but legitimately.
  const b = buildBaseline([ev("2026-08-01", "shopify_update_product")], 14);
  const r = detectAnomaly(b, "shopify_update_product", 1, { minDaysObserved: 1 });
  assertFalse(r.anomalous, "one occurrence of a rare-but-known action must not itself be a spike");
});

Deno.test("detectAnomaly: the absolute floor still catches a real spike on a low-baseline action_type", () => {
  const b = buildBaseline([ev("2026-08-01", "shopify_update_product")], 14);
  const r = detectAnomaly(b, "shopify_update_product", 6, { minDaysObserved: 1, minAbsoluteCount: 3 });
  assert(r.anomalous, "6 occurrences in a day for something used once in 14 days is a real spike");
});

Deno.test("detectAnomaly: custom multiplier and absolute-count options are honored", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day
  const strict = detectAnomaly(b, "send_email", 5, { volumeMultiplier: 2 }); // threshold 4
  assert(strict.anomalous);
  const loose = detectAnomaly(b, "send_email", 5, { volumeMultiplier: 10 }); // threshold 20
  assertFalse(loose.anomalous);
});

// ---- org strictness dial scales sensitivity --------------------------------

Deno.test("detectAnomaly: the org strictness dial changes the default thresholds", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day
  // Balanced default: threshold 5x2=10. 6 is below that.
  assertFalse(detectAnomaly(b, "send_email", 6, {}, "balanced").anomalous);
  // Strict: multiplier 3x2=6. 6 meets that threshold.
  assert(detectAnomaly(b, "send_email", 6, {}, "strict").anomalous);
  // Loose: multiplier 8x2=16. 6 is nowhere close.
  assertFalse(detectAnomaly(b, "send_email", 6, {}, "loose").anomalous);
});

Deno.test("detectAnomaly: strict mode needs less history before it starts judging", () => {
  // Only 2 distinct days of history — balanced/loose require >=3/>=5 days and skip.
  const b = buildBaseline([ev("2026-08-01", "send_email"), ev("2026-08-02", "send_email")], 14);
  assertFalse(detectAnomaly(b, "shopify_create_draft_order", 1, {}, "balanced").anomalous);
  assertFalse(detectAnomaly(b, "shopify_create_draft_order", 1, {}, "loose").anomalous);
  // Strict only needs 2 days observed, which this baseline has.
  assert(detectAnomaly(b, "shopify_create_draft_order", 1, {}, "strict").anomalous);
});

Deno.test("detectAnomaly: an explicit opts field still overrides the strictness preset", () => {
  const b = buildBaseline(fourteenDaysOfSteadyEmail, 14); // avg 2/day
  // Strict preset multiplier is 3 (threshold 6), but an explicit override to 20 must win.
  const r = detectAnomaly(b, "send_email", 10, { volumeMultiplier: 20 }, "strict");
  assertFalse(r.anomalous, "explicit opts must override the strictness preset, not the other way around");
});
