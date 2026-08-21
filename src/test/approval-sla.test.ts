import { describe, it, expect } from "vitest";
import { computeSlaStats } from "@/lib/approval-sla";

const row = (hoursToResolve: number, riskTier: string, resolvedBy: string | null) => ({
  risk_tier: riskTier,
  resolved_by: resolvedBy,
  created_at: "2026-08-01T00:00:00Z",
  resolved_at: new Date(new Date("2026-08-01T00:00:00Z").getTime() + hoursToResolve * 60 * 60 * 1000).toISOString(),
});

describe("computeSlaStats", () => {
  it("a single resolved approval: median and p90 both equal its own resolution time", () => {
    const { byRiskTier } = computeSlaStats([row(4, "high", "a")]);
    expect(byRiskTier.high.count).toBe(1);
    expect(byRiskTier.high.medianHours).toBe(4);
    expect(byRiskTier.high.p90Hours).toBe(4);
  });

  it("groups by risk tier separately", () => {
    const { byRiskTier } = computeSlaStats([row(2, "high", "a"), row(20, "low", "a")]);
    expect(byRiskTier.high.medianHours).toBe(2);
    expect(byRiskTier.low.medianHours).toBe(20);
  });

  it("groups by approver separately", () => {
    const { byApprover } = computeSlaStats([row(2, "high", "alice"), row(10, "high", "bob")]);
    expect(byApprover.alice.medianHours).toBe(2);
    expect(byApprover.bob.medianHours).toBe(10);
  });

  it("an approval with no resolved_by is counted in risk-tier stats but not per-approver stats", () => {
    const { byRiskTier, byApprover } = computeSlaStats([row(5, "medium", null)]);
    expect(byRiskTier.medium.count).toBe(1);
    expect(Object.keys(byApprover)).toEqual([]);
  });

  it("p90 is at or above the median, and reflects the tail of a skewed distribution", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((h) => row(h, "high", "a"));
    const { byRiskTier } = computeSlaStats(rows);
    expect(byRiskTier.high.medianHours).toBe(5);
    expect(byRiskTier.high.p90Hours).toBeGreaterThanOrEqual(byRiskTier.high.medianHours);
    expect(byRiskTier.high.p90Hours).toBe(9);
  });

  it("no rows at all returns empty breakdowns, not a crash", () => {
    expect(computeSlaStats([])).toEqual({ byRiskTier: {}, byApprover: {} });
  });
});
