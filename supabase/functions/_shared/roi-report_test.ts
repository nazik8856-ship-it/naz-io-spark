// Real tests for the backend ROI aggregation mirror used by the monthly
// report email.
//
// Run with: deno test --allow-none supabase/functions/_shared/roi-report_test.ts
import {
  classifyDecisionOutcome, summarizeDecisionsForRoi, costPerAutonomousDecision,
  weekBucketKey, buildRoiTrend, estimateManualReviewHoursSaved, ASSUMED_MINUTES_PER_MANUAL_REVIEW,
  type DecisionForRoiTrend,
} from "./roi-report.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("classifyDecisionOutcome: classifies each known verb prefix", () => {
  assertEquals(classifyDecisionOutcome("BLOCK a (X)"), "block");
  assertEquals(classifyDecisionOutcome("MODIFY a (X)"), "modify");
  assertEquals(classifyDecisionOutcome("ALLOW a (X)"), "allow");
  assertEquals(classifyDecisionOutcome("DEFERRED a (X)"), "deferred");
  assertEquals(classifyDecisionOutcome("APPROVAL_REQUIRED a (X)"), "approval_required");
});

Deno.test("classifyDecisionOutcome: unrecognized verbs (kill-switch trips, undo records) are 'other'", () => {
  assertEquals(classifyDecisionOutcome("KILL_SWITCH_ON (daily AI spend cap)"), "other");
});

Deno.test("summarizeDecisionsForRoi: counts blocked/modified/allowed and autonomous vs needs-human", () => {
  const counts = summarizeDecisionsForRoi([
    { decision: "BLOCK a (X)", escalated: false },
    { decision: "MODIFY a (X)", escalated: false },
    { decision: "ALLOW a (X)", escalated: false },
    { decision: "APPROVAL_REQUIRED a (X)", escalated: true },
  ]);
  assertEquals(counts, { total: 4, blocked: 1, modified: 1, allowed: 1, needsHuman: 1, autonomous: 3 });
});

Deno.test("summarizeDecisionsForRoi: no decisions is a well-formed zeroed summary", () => {
  assertEquals(summarizeDecisionsForRoi([]), { total: 0, blocked: 0, modified: 0, allowed: 0, needsHuman: 0, autonomous: 0 });
});

Deno.test("costPerAutonomousDecision: divides total spend by autonomous count", () => {
  assertEquals(costPerAutonomousDecision(10, 100), 0.1);
});

Deno.test("costPerAutonomousDecision: null when there were no autonomous decisions", () => {
  assertEquals(costPerAutonomousDecision(10, 0), null);
});

// ---- "policy autonomy" item 14: weekly trend + hours-saved estimate ----

Deno.test("weekBucketKey: every day in the same real week maps to the same Monday key", () => {
  // 2026-08-24 is a Monday.
  assertEquals(weekBucketKey("2026-08-24T00:00:00Z"), "2026-08-24");
  assertEquals(weekBucketKey("2026-08-26T15:30:00Z"), "2026-08-24");
  assertEquals(weekBucketKey("2026-08-30T23:59:59Z"), "2026-08-24"); // Sunday, same week
});

Deno.test("weekBucketKey: the following Monday starts a new bucket", () => {
  assertEquals(weekBucketKey("2026-08-31T00:00:00Z"), "2026-08-31");
});

const trendDecision = (over: Partial<DecisionForRoiTrend> = {}): DecisionForRoiTrend => ({
  decision: "ALLOW a (X)",
  escalated: false,
  createdAt: "2026-08-24T00:00:00Z",
  ...over,
});

Deno.test("buildRoiTrend: buckets decisions into their own real week, in chronological order", () => {
  const trend = buildRoiTrend([
    trendDecision({ createdAt: "2026-08-31T00:00:00Z" }),
    trendDecision({ createdAt: "2026-08-24T00:00:00Z" }),
  ], new Map());
  assertEquals(trend.map((p) => p.weekStart), ["2026-08-24", "2026-08-31"]);
});

Deno.test("buildRoiTrend: each week gets its own real outcome counts and spend", () => {
  const trend = buildRoiTrend([
    trendDecision({ decision: "BLOCK a (X)", createdAt: "2026-08-24T00:00:00Z" }),
    trendDecision({ decision: "ALLOW a (X)", createdAt: "2026-08-24T02:00:00Z" }),
  ], new Map([["2026-08-24", 5]]));
  assertEquals(trend.length, 1);
  assertEquals(trend[0].counts, { total: 2, blocked: 1, modified: 0, allowed: 1, needsHuman: 0, autonomous: 2 });
  assertEquals(trend[0].spendUsd, 5);
  assertEquals(trend[0].costPerDecision, 2.5);
});

Deno.test("buildRoiTrend: a week with decisions but no matching spend entry reads as $0, not missing", () => {
  const trend = buildRoiTrend([trendDecision()], new Map());
  assertEquals(trend[0].spendUsd, 0);
});

Deno.test("buildRoiTrend: no decisions at all is an empty trend, never throws", () => {
  assertEquals(buildRoiTrend([], new Map()), []);
});

Deno.test("estimateManualReviewHoursSaved: scales with the assumed minutes-per-review constant", () => {
  const hours = estimateManualReviewHoursSaved(20);
  assertEquals(hours, Math.round(((20 * ASSUMED_MINUTES_PER_MANUAL_REVIEW) / 60) * 10) / 10);
});

Deno.test("estimateManualReviewHoursSaved: zero autonomous decisions is zero hours, not a crash", () => {
  assertEquals(estimateManualReviewHoursSaved(0), 0);
});
