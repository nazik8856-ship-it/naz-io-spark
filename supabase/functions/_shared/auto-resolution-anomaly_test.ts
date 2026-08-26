// Real tests for item 14's auto-resolution-share anomaly detection.
//
// Run with: deno test --allow-none supabase/functions/_shared/auto-resolution-anomaly_test.ts
import {
  isAutoResolvedStatus, summarizeResolutionActivity, detectAutoResolutionShareSpike,
  summarizeAutoResolutionSpike, MIN_RECENT_SAMPLE, MIN_ABSOLUTE_SHARE_PCT, MIN_INCREASE_PCT_POINTS,
} from "./auto-resolution-anomaly.ts";

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

Deno.test("isAutoResolvedStatus: auto_approved and auto_rejected are auto-resolved; a human decision is not", () => {
  assert(isAutoResolvedStatus("auto_approved"));
  assert(isAutoResolvedStatus("auto_rejected"));
  assertFalse(isAutoResolvedStatus("approved"));
  assertFalse(isAutoResolvedStatus("rejected"));
  assertFalse(isAutoResolvedStatus("pending"));
});

Deno.test("summarizeResolutionActivity: groups rows by user_id and counts auto-resolved correctly", () => {
  const rows = [
    { user_id: "u1", status: "auto_approved" },
    { user_id: "u1", status: "approved" },
    { user_id: "u1", status: "auto_rejected" },
    { user_id: "u2", status: "rejected" },
  ];
  const summary = summarizeResolutionActivity(rows);
  const u1 = summary.find((s) => s.userId === "u1");
  const u2 = summary.find((s) => s.userId === "u2");
  assertEquals(u1, { userId: "u1", total: 3, auto: 2 });
  assertEquals(u2, { userId: "u2", total: 1, auto: 0 });
});

Deno.test("summarizeResolutionActivity: empty input produces an empty summary", () => {
  assertEquals(summarizeResolutionActivity([]), []);
});

Deno.test("detectAutoResolutionShareSpike: too small a recent sample never alerts, however high the share", () => {
  assertEquals(detectAutoResolutionShareSpike(MIN_RECENT_SAMPLE - 1, MIN_RECENT_SAMPLE - 1, 100, 0), { anomalous: false });
});

Deno.test("detectAutoResolutionShareSpike: a recent share below the absolute floor never alerts, even with zero baseline history", () => {
  const recentTotal = MIN_RECENT_SAMPLE;
  const recentAuto = Math.floor(recentTotal * (MIN_ABSOLUTE_SHARE_PCT / 100)) - 1;
  assertEquals(detectAutoResolutionShareSpike(recentTotal, recentAuto, 0, 0), { anomalous: false });
});

Deno.test("detectAutoResolutionShareSpike: a high recent share that matches an already-high baseline never alerts -- this is the account's normal", () => {
  const check = detectAutoResolutionShareSpike(100, 90, 100, 90);
  assertEquals(check, { anomalous: false });
});

Deno.test("detectAutoResolutionShareSpike: a sharp jump over baseline, on a real sample, alerts with rounded percentages", () => {
  const check = detectAutoResolutionShareSpike(100, 90, 100, 10);
  assert(check.anomalous);
  if (check.anomalous) {
    assertEquals(check.recentSharePct, 90);
    assertEquals(check.baselineSharePct, 10);
  }
});

Deno.test("detectAutoResolutionShareSpike: a jump that's real but under the minimum point increase never alerts", () => {
  const recentTotal = 100;
  const recentAuto = MIN_ABSOLUTE_SHARE_PCT; // exactly at the floor, 50%
  const baselineAuto = recentAuto - (MIN_INCREASE_PCT_POINTS - 1); // less than the required jump
  const check = detectAutoResolutionShareSpike(recentTotal, recentAuto, 100, baselineAuto);
  assertEquals(check, { anomalous: false });
});

Deno.test("detectAutoResolutionShareSpike: zero baseline history (a brand-new policy) still compares against a 0% baseline", () => {
  const check = detectAutoResolutionShareSpike(100, 80, 0, 0);
  assert(check.anomalous);
  if (check.anomalous) assertEquals(check.baselineSharePct, 0);
});

Deno.test("summarizeAutoResolutionSpike: mentions both percentages and the sample size", () => {
  const msg = summarizeAutoResolutionSpike(90, 10, 100);
  assert(msg.includes("90%"));
  assert(msg.includes("10%"));
  assert(msg.includes("100"));
});
