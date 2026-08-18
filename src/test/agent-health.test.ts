import { describe, it, expect } from "vitest";
import { computeAgentHealth } from "@/lib/agent-health";

describe("computeAgentHealth", () => {
  it("a brand-new agent with zero signal is insufficient_data, not risky", () => {
    const h = computeAgentHealth({ anomalyHits: 0, breakerTrips: 0, totalApprovals: 0, rejectedApprovals: 0 });
    expect(h).toEqual({ score: 100, risk: "insufficient_data" });
  });

  it("clean history (approvals but zero rejections, no anomalies/trips) scores 100, low risk", () => {
    const h = computeAgentHealth({ anomalyHits: 0, breakerTrips: 0, totalApprovals: 10, rejectedApprovals: 0 });
    expect(h).toEqual({ score: 100, risk: "low" });
  });

  it("each anomaly hit costs 8 points", () => {
    const h = computeAgentHealth({ anomalyHits: 2, breakerTrips: 0, totalApprovals: 0, rejectedApprovals: 0 });
    expect(h.score).toBe(84);
    expect(h.risk).toBe("low");
  });

  it("each breaker trip costs 12 points", () => {
    const h = computeAgentHealth({ anomalyHits: 0, breakerTrips: 2, totalApprovals: 0, rejectedApprovals: 0 });
    expect(h.score).toBe(76);
    expect(h.risk).toBe("medium");
  });

  it("a 50% rejection rate over 10 approvals costs 20 points (40 * 0.5)", () => {
    const h = computeAgentHealth({ anomalyHits: 0, breakerTrips: 0, totalApprovals: 10, rejectedApprovals: 5 });
    expect(h.score).toBe(80);
    expect(h.risk).toBe("low");
  });

  it("a 100% rejection rate costs the full 40 points", () => {
    const h = computeAgentHealth({ anomalyHits: 0, breakerTrips: 0, totalApprovals: 4, rejectedApprovals: 4 });
    expect(h.score).toBe(60);
    expect(h.risk).toBe("medium");
  });

  it("score never goes below 0 even with a pile of penalties", () => {
    const h = computeAgentHealth({ anomalyHits: 10, breakerTrips: 10, totalApprovals: 5, rejectedApprovals: 5 });
    expect(h.score).toBe(0);
    expect(h.risk).toBe("high");
  });

  it("risk boundary: score exactly 80 (rejection rate 0.5 on 2 approvals) is low", () => {
    // raw = 100 - 40*(1/2) = 80
    const h = computeAgentHealth({ anomalyHits: 0, breakerTrips: 0, totalApprovals: 2, rejectedApprovals: 1 });
    expect(h.score).toBe(80);
    expect(h.risk).toBe("low");
  });

  it("risk boundary: score exactly 79 (1 anomaly + rejection rate 0.325 on 40 approvals) is medium", () => {
    // raw = 100 - 8 - 40*(13/40) = 100 - 8 - 13 = 79
    const h = computeAgentHealth({ anomalyHits: 1, breakerTrips: 0, totalApprovals: 40, rejectedApprovals: 13 });
    expect(h.score).toBe(79);
    expect(h.risk).toBe("medium");
  });

  it("risk boundary: score exactly 50 (1 breaker trip + 1 anomaly + rejection rate 0.75 on 4 approvals) is medium", () => {
    // raw = 100 - 12 - 8 - 40*(3/4) = 100 - 12 - 8 - 30 = 50
    const h = computeAgentHealth({ anomalyHits: 1, breakerTrips: 1, totalApprovals: 4, rejectedApprovals: 3 });
    expect(h.score).toBe(50);
    expect(h.risk).toBe("medium");
  });

  it("risk boundary: score exactly 49 (1 breaker trip + 1 anomaly + rejection rate 0.775 on 40 approvals) is high", () => {
    // raw = 100 - 12 - 8 - 40*(31/40) = 100 - 12 - 8 - 31 = 49
    const h = computeAgentHealth({ anomalyHits: 1, breakerTrips: 1, totalApprovals: 40, rejectedApprovals: 31 });
    expect(h.score).toBe(49);
    expect(h.risk).toBe("high");
  });

  it("combines all three signal types additively", () => {
    // 100 - 1*8 - 1*12 - (2/4)*40 = 100 - 8 - 12 - 20 = 60
    const h = computeAgentHealth({ anomalyHits: 1, breakerTrips: 1, totalApprovals: 4, rejectedApprovals: 2 });
    expect(h.score).toBe(60);
    expect(h.risk).toBe("medium");
  });
});
