// Pure escalation-timer logic — a pending approval untouched for too long
// fires a stronger alert instead of silently sitting in the queue forever.
// The threshold scales with risk_tier, the same way the confidence bar and
// anomaly sensitivity already do elsewhere (decision-scoring.ts,
// anomaly-detector.ts) — a high-risk action waiting on a human deserves a
// faster nudge than a low-risk one.

export const ESCALATION_HOURS: Record<"low" | "medium" | "high", number> = {
  high: 4,
  medium: 12,
  low: 24,
};

const normalizeTier = (riskTier: string): "low" | "medium" | "high" =>
  riskTier === "high" ? "high" : riskTier === "low" ? "low" : "medium";

export const hoursSince = (isoDate: string, now: Date = new Date()): number =>
  (now.getTime() - new Date(isoDate).getTime()) / (1000 * 60 * 60);

export type PendingApprovalLike = {
  created_at: string;
  risk_tier: string;
  status: string;
  escalated_at: string | null;
};

/** Pure — is this pending approval overdue for an escalation nudge right now? */
export function isOverdueForEscalation(row: PendingApprovalLike, now: Date = new Date()): boolean {
  if (row.status !== "pending") return false;
  if (row.escalated_at) return false; // only ever escalate once
  const threshold = ESCALATION_HOURS[normalizeTier(row.risk_tier)];
  return hoursSince(row.created_at, now) >= threshold;
}
