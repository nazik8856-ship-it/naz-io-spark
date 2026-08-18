// Pure, testable scoring for the per-agent health/risk badge. Turns raw
// counts (already queried from agent_decisions / pending_approvals) into a
// 0-100 health score and a risk label. No DB access here — the component
// queries the counts and calls this.

export type AgentHealthInput = {
  /** Anomaly-detector holds tied to this agent (source='anomaly_detector'), in the window. */
  anomalyHits: number;
  /** Circuit-breaker trips tied to this agent (source='circuit_breaker_trip'), in the window. */
  breakerTrips: number;
  /** Resolved (approved or rejected) pending_approvals for this agent, in the window. */
  totalApprovals: number;
  /** Of those, how many were rejected. */
  rejectedApprovals: number;
};

export type RiskLabel = "low" | "medium" | "high" | "insufficient_data";

export type AgentHealth = {
  score: number;
  risk: RiskLabel;
};

const ANOMALY_PENALTY = 8;
const BREAKER_PENALTY = 12;
const REJECTION_WEIGHT = 40;

/** Pure — no DB, no side effects. */
export function computeAgentHealth(input: AgentHealthInput): AgentHealth {
  const { anomalyHits, breakerTrips, totalApprovals, rejectedApprovals } = input;

  // No signal at all yet — a brand-new agent isn't "risky", it's unmeasured.
  if (anomalyHits === 0 && breakerTrips === 0 && totalApprovals === 0) {
    return { score: 100, risk: "insufficient_data" };
  }

  const rejectionRate = totalApprovals > 0 ? rejectedApprovals / totalApprovals : 0;
  const raw = 100
    - anomalyHits * ANOMALY_PENALTY
    - breakerTrips * BREAKER_PENALTY
    - rejectionRate * REJECTION_WEIGHT;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const risk: RiskLabel = score >= 80 ? "low" : score >= 50 ? "medium" : "high";
  return { score, risk };
}
