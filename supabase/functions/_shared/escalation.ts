// Pure escalation-timer logic — a pending approval untouched for too long
// fires a stronger alert instead of silently sitting in the queue forever.
// The threshold scales with risk_tier, the same way the confidence bar and
// anomaly sensitivity already do elsewhere (decision-scoring.ts,
// anomaly-detector.ts) — a high-risk action waiting on a human deserves a
// faster nudge than a low-risk one.
//
// Pillar 3 top-10 item 3: this used to fire AT MOST ONCE per approval, ever
// -- `escalated_at` was a one-way "has this ever been nudged" flag, so an
// approval that sat ignored for days after its first nudge went completely
// silent. `escalated_at` now means "when was the last nudge sent" instead,
// and the same risk-scaled threshold re-applies from THAT timestamp, giving
// a genuine repeat cadence (e.g. a high-risk approval nudges again every 4h
// it stays unresolved) until it's finally approved/rejected -- the same
// "re-check every sweep run, no done-once gate" shape audit-integrity-
// sweep's own checkStaleIncidents already uses for stale incidents.

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

/**
 * Pure — is this pending approval overdue for an escalation nudge right
 * now? Measures from the last nudge (`escalated_at`) when there's been one,
 * from creation otherwise -- so this is true again every `threshold` hours
 * it remains unresolved, not just once.
 */
export function isOverdueForEscalation(row: PendingApprovalLike, now: Date = new Date()): boolean {
  if (row.status !== "pending") return false;
  const threshold = ESCALATION_HOURS[normalizeTier(row.risk_tier)];
  const since = row.escalated_at ?? row.created_at;
  return hoursSince(since, now) >= threshold;
}
