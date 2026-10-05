import { describe, it, expect } from "vitest";
import { computeTrustScore } from "@/lib/trust-score";

describe("computeTrustScore", () => {
  it("a clean entity with a healthy sample scores 100", () => {
    const report = computeTrustScore({ avgCalibrationGap: 0, totalDecisions: 50, ruleTriggeredDecisions: 0, repairInterventions: 0 });
    expect(report.score).toBe(100);
    expect(report.components.every((c) => c.status === "ok")).toBe(true);
  });

  it("no measured data at all never penalizes the entity", () => {
    const report = computeTrustScore({ avgCalibrationGap: null, totalDecisions: 0, ruleTriggeredDecisions: 0, repairInterventions: 0 });
    expect(report.score).toBe(100);
    expect(report.components.every((c) => c.status === "no_data")).toBe(true);
  });

  it("a sample below the minimum threshold is never judged on rate", () => {
    const report = computeTrustScore({ avgCalibrationGap: null, totalDecisions: 5, ruleTriggeredDecisions: 5, repairInterventions: 5 });
    expect(report.score).toBe(100);
  });

  it("a high rule-trigger rate deducts points, capped at 40", () => {
    const report = computeTrustScore({ avgCalibrationGap: 0, totalDecisions: 100, ruleTriggeredDecisions: 90, repairInterventions: 0 });
    expect(report.components.find((c) => c.name === "rule_trigger_rate")?.deduction).toBe(40);
    expect(report.score).toBe(60);
  });

  it("deductions from multiple components combine additively", () => {
    const report = computeTrustScore({ avgCalibrationGap: 0.1, totalDecisions: 100, ruleTriggeredDecisions: 10, repairInterventions: 10 });
    expect(report.score).toBe(70);
  });

  it("score is floored at 0", () => {
    const report = computeTrustScore({ avgCalibrationGap: 1, totalDecisions: 100, ruleTriggeredDecisions: 100, repairInterventions: 100 });
    expect(report.score).toBe(0);
  });
});
