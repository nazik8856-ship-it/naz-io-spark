// Real tests for the "next best policy change" recommendation.
//
// Run with: deno test --allow-none supabase/functions/_shared/policy-recommendation_test.ts
import {
  recommendThresholdForActionType,
  buildPolicyRecommendation,
  MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION,
  RECOMMENDATION_MAX_BAD_OUTCOME_RATE,
  type EscalatedDecisionOutcome,
} from "./policy-recommendation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const clean = (score: number): EscalatedDecisionOutcome => ({ confidenceScore: score, badOutcome: false });
const bad = (score: number): EscalatedDecisionOutcome => ({ confidenceScore: score, badOutcome: true });
const unmeasured = (score: number): EscalatedDecisionOutcome => ({ confidenceScore: score, badOutcome: null });

// ---- recommendThresholdForActionType ----

Deno.test("recommendThresholdForActionType: no escalations at all returns null", () => {
  assertEquals(recommendThresholdForActionType([]), null);
});

Deno.test("recommendThresholdForActionType: below the minimum measured sample returns null", () => {
  const escalations = [clean(90), clean(85), clean(80)]; // only 3, below the default min of 5
  assertEquals(recommendThresholdForActionType(escalations), null);
});

Deno.test("recommendThresholdForActionType: all-clean outcomes recommends the lowest confidence among them", () => {
  const escalations = [clean(95), clean(90), clean(85), clean(80), clean(75)];
  const rec = recommendThresholdForActionType(escalations);
  assert(rec !== null);
  assertEquals(rec!.candidateThreshold, 75);
  assertEquals(rec!.wouldAutoResolveCount, 5);
  assertEquals(rec!.measuredCount, 5);
  assertEquals(rec!.badOutcomeCount, 0);
  assertEquals(rec!.badOutcomeRatePct, 0);
});

Deno.test("recommendThresholdForActionType: stops growing the moment the bad-outcome rate would cross the bar", () => {
  // 5 clean at the top, then a run of bad ones -- the recommendation must
  // stop at the clean group, never extend into the bad run.
  const escalations = [clean(95), clean(94), clean(93), clean(92), clean(91), bad(50), bad(49), bad(48), bad(47), bad(46)];
  const rec = recommendThresholdForActionType(escalations);
  assert(rec !== null);
  assertEquals(rec!.candidateThreshold, 91);
  assertEquals(rec!.wouldAutoResolveCount, 5);
  assertEquals(rec!.badOutcomeCount, 0);
});

Deno.test("recommendThresholdForActionType: unmeasured decisions never count toward the bad-outcome rate, but also never advance the measured floor", () => {
  const escalations = [unmeasured(99), unmeasured(98), clean(95), clean(90), clean(85), clean(80), clean(75)];
  const rec = recommendThresholdForActionType(escalations);
  assert(rec !== null);
  // The two unmeasured ones are included in wouldAutoResolveCount (they'd
  // still auto-resolve at this threshold) but don't count toward measuredCount.
  assertEquals(rec!.measuredCount, 5);
  assertEquals(rec!.wouldAutoResolveCount, 7);
});

Deno.test("recommendThresholdForActionType: exactly at the bad-outcome bar is acceptable, just over it is not", () => {
  // 1 bad out of 5 = 20%, over the default 15% bar -- must NOT recommend.
  const overBar = [bad(90), clean(89), clean(88), clean(87), clean(86)];
  assertEquals(recommendThresholdForActionType(overBar), null);
});

Deno.test("recommendThresholdForActionType: input order doesn't matter -- it sorts internally by confidence", () => {
  const a = recommendThresholdForActionType([clean(75), clean(95), clean(85), clean(90), clean(80)]);
  const b = recommendThresholdForActionType([clean(95), clean(90), clean(85), clean(80), clean(75)]);
  assertEquals(a, b);
});

// ---- buildPolicyRecommendation ----

Deno.test("buildPolicyRecommendation: a not-ready key gets no threshold recommendation regardless of its numbers", () => {
  const result = buildPolicyRecommendation(false, "confidence calibration is flagged", 60, 20, [
    { actionType: "send_email", escalations: [clean(95), clean(90), clean(85), clean(80), clean(75)] },
  ]);
  assertEquals(result.kind, "not_ready");
  if (result.kind === "not_ready") assertEquals(result.reason, "confidence calibration is flagged");
});

Deno.test("buildPolicyRecommendation: a ready key with no escalations at all gets a clear 'nothing to recommend' answer", () => {
  const result = buildPolicyRecommendation(true, null, 60, 0, []);
  assertEquals(result.kind, "no_escalations");
});

Deno.test("buildPolicyRecommendation: a ready key whose escalations never clear the safety bar gets no_safe_recommendation, never a guess", () => {
  const result = buildPolicyRecommendation(true, null, 60, 5, [
    { actionType: "delete_record", escalations: [bad(90), clean(89), clean(88), clean(87), clean(86)] },
  ]);
  assertEquals(result.kind, "no_safe_recommendation");
});

Deno.test("buildPolicyRecommendation: a ready key with a real safe candidate recommends it, naming the action_type and real numbers", () => {
  const result = buildPolicyRecommendation(true, null, 60, 10, [
    { actionType: "send_email", escalations: [clean(95), clean(90), clean(85), clean(80), clean(75)] },
  ]);
  assertEquals(result.kind, "lower_confidence_threshold");
  if (result.kind === "lower_confidence_threshold") {
    assertEquals(result.actionType, "send_email");
    assertEquals(result.recommendation.candidateThreshold, 75);
    assert(result.message.includes("send_email"));
    assert(result.message.includes("75%"));
    assert(result.message.includes("50%"), "5 of 10 total escalations should read as 50%");
  }
});

Deno.test("buildPolicyRecommendation: across multiple action types, the one that saves the MOST escalations wins", () => {
  const result = buildPolicyRecommendation(true, null, 60, 20, [
    { actionType: "small_win", escalations: [clean(95), clean(90), clean(85), clean(80), clean(75)] },
    { actionType: "big_win", escalations: [clean(99), clean(98), clean(97), clean(96), clean(95), clean(94), clean(93)] },
  ]);
  assertEquals(result.kind, "lower_confidence_threshold");
  if (result.kind === "lower_confidence_threshold") assertEquals(result.actionType, "big_win");
});

Deno.test("MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION and RECOMMENDATION_MAX_BAD_OUTCOME_RATE are sane, real constants", () => {
  assert(MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION > 0);
  assert(RECOMMENDATION_MAX_BAD_OUTCOME_RATE > 0 && RECOMMENDATION_MAX_BAD_OUTCOME_RATE < 0.4, "must be meaningfully stricter than policy-downgrade.ts's own 40% pull-back bar");
});
