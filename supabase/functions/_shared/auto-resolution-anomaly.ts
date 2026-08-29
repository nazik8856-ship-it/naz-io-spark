// "Zero human review" plan, item 14: once items 1/2/4 exist, an account
// could set a policy that's quietly too permissive and never find out,
// because by definition nobody's watching each individual decision
// anymore. Warn when a sharply higher-than-normal share of an account's
// resolved decisions are suddenly being resolved automatically instead
// of the (already low) rate that used to reach a human.
//
// Same baseline-comparison IDEA as the per-agent anomaly detector
// (_shared/anomaly-detector.ts) -- a recent window compared against a
// longer trailing history -- but that detector compares raw COUNTS
// against a daily average for one action_type; this compares a RATIO
// (share of decisions auto-resolved) for a whole account, a different
// enough shape of problem that it gets its own small, pure module rather
// than being forced through detectAnomaly's own signature.

export type ResolvedApprovalRow = { user_id: string; status: string };
export type AccountResolutionActivity = { userId: string; total: number; auto: number };

/** Pure -- is this pending_approvals.status a genuinely automatic resolution? */
export function isAutoResolvedStatus(status: string): boolean {
  return status === "auto_approved" || status === "auto_rejected";
}

/** Pure -- groups raw resolved-approval rows into per-account totals. */
export function summarizeResolutionActivity(rows: ResolvedApprovalRow[]): AccountResolutionActivity[] {
  const byUser = new Map<string, AccountResolutionActivity>();
  for (const r of rows) {
    const existing = byUser.get(r.user_id) ?? { userId: r.user_id, total: 0, auto: 0 };
    existing.total += 1;
    if (isAutoResolvedStatus(r.status)) existing.auto += 1;
    byUser.set(r.user_id, existing);
  }
  return [...byUser.values()];
}

// Requires a real sample in the recent window before saying anything --
// one or two auto-resolved decisions out of a handful must never alert.
export const MIN_RECENT_SAMPLE = 10;
// The recent share itself must be substantial -- a jump from 2% to 8%
// baseline isn't the "quietly too permissive" scenario this exists for,
// even though it's technically a big relative jump.
export const MIN_ABSOLUTE_SHARE_PCT = 50;
// AND it must be a real jump over this account's own history, in
// percentage POINTS (not relative %) -- an account that's always run at
// 60% auto-resolved (a deliberate, known choice) shouldn't re-alert every
// sweep just for staying at 60%.
export const MIN_INCREASE_PCT_POINTS = 25;

export type AutoResolutionShareCheck =
  | { anomalous: false }
  | { anomalous: true; recentSharePct: number; baselineSharePct: number };

/**
 * Pure -- compares a recent window's auto-resolution share against a
 * longer trailing baseline for the SAME account. `baselineTotal`/
 * `baselineAuto` should exclude the recent window itself (a preceding
 * period), so a fresh spike doesn't get diluted into -- or inflate --
 * its own baseline.
 */
export function detectAutoResolutionShareSpike(
  recentTotal: number,
  recentAuto: number,
  baselineTotal: number,
  baselineAuto: number,
): AutoResolutionShareCheck {
  if (recentTotal < MIN_RECENT_SAMPLE) return { anomalous: false };
  const recentSharePct = (recentAuto / recentTotal) * 100;
  if (recentSharePct < MIN_ABSOLUTE_SHARE_PCT) return { anomalous: false };
  const baselineSharePct = baselineTotal > 0 ? (baselineAuto / baselineTotal) * 100 : 0;
  if (recentSharePct - baselineSharePct < MIN_INCREASE_PCT_POINTS) return { anomalous: false };
  return {
    anomalous: true,
    recentSharePct: Math.round(recentSharePct * 10) / 10,
    baselineSharePct: Math.round(baselineSharePct * 10) / 10,
  };
}

export function summarizeAutoResolutionSpike(recentSharePct: number, baselineSharePct: number, recentTotal: number): string {
  return `${recentSharePct}% of this account's ${recentTotal} resolved decisions in the last 24 hours were resolved ` +
    `automatically — no human reviewed them — compared to a ${baselineSharePct}% baseline over the prior 2 weeks. ` +
    `Worth checking whether the current auto-resolve policy is more permissive than intended.`;
}
