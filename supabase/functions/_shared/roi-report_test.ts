// Real tests for the backend ROI aggregation mirror used by the monthly
// report email.
//
// Run with: deno test --allow-none supabase/functions/_shared/roi-report_test.ts
import { classifyDecisionOutcome, summarizeDecisionsForRoi, costPerAutonomousDecision } from "./roi-report.ts";

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
