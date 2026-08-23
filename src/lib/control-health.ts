// Pure derived stats for the internal control-plane health view — kept
// separate from the data-fetching page component so the arithmetic
// (percentages, division-by-zero edge cases) is directly testable.

export function pctOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10; // one decimal place
}

export type DeliveredVia = "slack" | "log";

export function alertDeliverySplit(alerts: { delivered_via: DeliveredVia }[]): {
  slack: number;
  log: number;
  total: number;
  slackPct: number;
} {
  const slack = alerts.filter((a) => a.delivered_via === "slack").length;
  const log = alerts.filter((a) => a.delivered_via === "log").length;
  const total = slack + log;
  // No alerts at all is a clean signal (nothing to deliver), not a broken channel.
  return { slack, log, total, slackPct: total > 0 ? pctOf(slack, total) : 100 };
}

export type TestRunTrendPoint = { pass_rate_pct: number; created_at: string };

/** Pure — is the most recent self-audit run's pass rate worse than the one before it? */
export function isTrendingDown(runsNewestFirst: TestRunTrendPoint[]): boolean {
  if (runsNewestFirst.length < 2) return false;
  return runsNewestFirst[0].pass_rate_pct < runsNewestFirst[1].pass_rate_pct;
}

/** Pure — same percentile-by-index approach approval-sla.ts uses for SLA hours. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export type GateLatencyStats = { avgMs: number; p95Ms: number; count: number };

/** Pure — avg/p95 gate_duration_ms over whatever window the caller already fetched. */
export function gateLatencyStats(durationsMs: number[]): GateLatencyStats {
  if (!durationsMs.length) return { avgMs: 0, p95Ms: 0, count: 0 };
  const sorted = durationsMs.slice().sort((a, b) => a - b);
  const avgMs = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  return { avgMs, p95Ms: Math.round(percentile(sorted, 95)), count: sorted.length };
}

export type AuditIntegrityRunSummary = { mismatched_count: number; unsigned: number; created_at: string } | null;

/**
 * Pure — same failure rule _shared/audit-integrity.ts's isAuditIntegrityFailure
 * uses (a mismatch OR an unsigned row in range means something's wrong),
 * duplicated here rather than imported since that module lives under
 * supabase/functions (a Deno edge-function tree, not part of the Vite
 * frontend build). null (no sweep has ever run) is neither pass nor fail —
 * the caller renders that as its own "no data yet" state, not a false "ok".
 */
export function isAuditIntegritySweepFailing(latest: AuditIntegrityRunSummary): boolean {
  if (!latest) return false;
  return latest.mismatched_count > 0 || latest.unsigned > 0;
}
