// GAP 4 (Trust Score + Provenance + Control Report): real tests for the
// pure per-entity trust-score composition.
//
// Run with: deno test --allow-none supabase/functions/_shared/trust-score_test.ts
import { computeTrustScore, type TrustScoreInput } from "./trust-score.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const CLEAN: TrustScoreInput = { avgCalibrationGap: 0, totalDecisions: 100, ruleTriggeredDecisions: 0, repairInterventions: 0 };

Deno.test("a clean entity (no gap, no triggers, no repairs) scores 100", () => {
  const report = computeTrustScore(CLEAN);
  assert(report.score === 100);
  assert(report.components.every((c) => c.status === "ok"));
});

Deno.test("every component defaults to no_data (never penalized) when there's nothing measured yet", () => {
  const report = computeTrustScore({ avgCalibrationGap: null, totalDecisions: 0, ruleTriggeredDecisions: 0, repairInterventions: 0 });
  assert(report.score === 100);
  assert(report.components.every((c) => c.status === "no_data" && c.deduction === 0));
});

Deno.test("a sample below the minimum threshold still scores 100 on rule-trigger/repair even with a nonzero numerator (not enough decisions to judge a rate)", () => {
  const report = computeTrustScore({ avgCalibrationGap: null, totalDecisions: 3, ruleTriggeredDecisions: 1, repairInterventions: 1 });
  assert(report.score === 100);
});

Deno.test("a high rule-trigger rate deducts points, capped, and is reflected in the score", () => {
  const report = computeTrustScore({ ...CLEAN, ruleTriggeredDecisions: 80 }); // 80% trigger rate
  const ruleComponent = report.components.find((c) => c.name === "rule_trigger_rate")!;
  assert(ruleComponent.status === "elevated");
  assert(ruleComponent.deduction === 40, "deduction must be capped at 40");
  assert(report.score === 60);
});

Deno.test("a large calibration gap deducts points, capped at 30", () => {
  const report = computeTrustScore({ ...CLEAN, avgCalibrationGap: 0.9 });
  const calComponent = report.components.find((c) => c.name === "confidence_calibration")!;
  assert(calComponent.deduction === 30);
  assert(report.score === 70);
});

Deno.test("repair interventions deduct points, capped at 30", () => {
  const report = computeTrustScore({ ...CLEAN, repairInterventions: 90 }); // 90% intervention rate
  const repairComponent = report.components.find((c) => c.name === "repair_interventions")!;
  assert(repairComponent.deduction === 30);
  assert(report.score === 70);
});

Deno.test("score never goes below 0 even when every component is maximally bad", () => {
  const report = computeTrustScore({ avgCalibrationGap: 1, totalDecisions: 100, ruleTriggeredDecisions: 100, repairInterventions: 100 });
  assert(report.score === 0);
});

Deno.test("multiple elevated components combine additively, not just the worst one", () => {
  const report = computeTrustScore({ avgCalibrationGap: 0.1, totalDecisions: 100, ruleTriggeredDecisions: 10, repairInterventions: 10 });
  // calibration: min(30, 10) = 10; rule: min(40, 10) = 10; repair: min(30, 10) = 10 -> 100 - 30 = 70
  assert(report.score === 70);
});
