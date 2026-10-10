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

// GAP 5 (Action Execution Feedback Loop, 2026-10-10): a SEPARATE, shorter
// clock than the one above -- an approved-but-unexecuted row has already
// cleared the human-judgment step; all that's left is someone noticing the
// "Run it" button. That's an operational gap, not an unreviewed decision,
// so it deserves a faster nudge than ESCALATION_HOURS' "nobody has looked
// at this yet" cadence.
export const EXECUTION_REMINDER_HOURS: Record<"low" | "medium" | "high", number> = {
  high: 1,
  medium: 2,
  low: 4,
};

export type ApprovedUnexecutedLike = {
  status: string;
  risk_tier: string;
  resolved_at: string | null;
  executed_at: string | null;
  escalated_at: string | null;
};

/**
 * Pure — is this APPROVED row overdue for an execution-reminder nudge right
 * now? Anchored on resolved_at (when quorum was met), not created_at (when
 * it was first requested) -- the clock for "this needs running" starts at
 * approval, not at the original request. Same repeat-every-threshold shape
 * as isOverdueForEscalation, reusing escalated_at as the "last nudge"
 * marker -- safe to share the column since a row is never both "pending"
 * and "approved" at once, so the two sweeps' usage of it never overlaps.
 */
export function isOverdueForExecution(row: ApprovedUnexecutedLike, now: Date = new Date()): boolean {
  if (row.status !== "approved" || row.executed_at) return false;
  if (!row.resolved_at) return false;
  const threshold = EXECUTION_REMINDER_HOURS[normalizeTier(row.risk_tier)];
  const since = row.escalated_at ?? row.resolved_at;
  return hoursSince(since, now) >= threshold;
}
