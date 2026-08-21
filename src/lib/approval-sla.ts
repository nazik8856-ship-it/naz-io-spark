// Approval SLA analytics (Wave 5, session 3) — median/p90 time-to-
// resolution by risk tier and by approver, so a growing team can see
// whether approvals are being handled fast enough, not just that they
// eventually get handled. Pure statistics over already-resolved approvals
// — no enforcement or scheduling logic lives here.

export type ResolvedApprovalForSla = {
  risk_tier: string;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string;
};

export type SlaStats = { count: number; medianHours: number; p90Hours: number };

function percentile(sortedHours: number[], p: number): number {
  if (!sortedHours.length) return 0;
  const idx = Math.min(sortedHours.length - 1, Math.ceil((p / 100) * sortedHours.length) - 1);
  return sortedHours[Math.max(0, idx)];
}

function statsFor(hours: number[]): SlaStats {
  const sorted = hours.slice().sort((a, b) => a - b);
  return { count: sorted.length, medianHours: percentile(sorted, 50), p90Hours: percentile(sorted, 90) };
}

const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);

/**
 * Pure — resolution-time stats grouped by risk tier and, separately, by
 * approver (resolved_by). An approval with no resolved_by (e.g. resolved
 * by an automated path) is counted in the risk-tier breakdown but not the
 * per-approver one.
 */
export function computeSlaStats(rows: ResolvedApprovalForSla[]): {
  byRiskTier: Record<string, SlaStats>;
  byApprover: Record<string, SlaStats>;
} {
  const hoursByTier: Record<string, number[]> = {};
  const hoursByApprover: Record<string, number[]> = {};

  for (const r of rows) {
    const h = hoursBetween(r.created_at, r.resolved_at);
    (hoursByTier[r.risk_tier] ??= []).push(h);
    if (r.resolved_by) (hoursByApprover[r.resolved_by] ??= []).push(h);
  }

  const byRiskTier: Record<string, SlaStats> = {};
  for (const [tier, hours] of Object.entries(hoursByTier)) byRiskTier[tier] = statsFor(hours);

  const byApprover: Record<string, SlaStats> = {};
  for (const [approver, hours] of Object.entries(hoursByApprover)) byApprover[approver] = statsFor(hours);

  return { byRiskTier, byApprover };
}
