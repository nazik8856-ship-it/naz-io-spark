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

// "15 more items" plan, item 14: uptime/error-rate depends on item 4
// (control-engine's outer catch recording a real gate_error decision on
// any uncaught failure, not just the inner gate-logic catch) -- once that
// landed, the SAME gate_error source count the existing "Gate error rate"
// stat card already computes is now the complete picture of "is the
// engine crashing," as opposed to a decision that's simply blocking on
// purpose (hard_rule/safety_scanner/kill_switch/etc, none of which are
// gate_error). Uptime is that count's complement -- the customer-facing
// framing every status page uses -- not a new signal.
export type EngineUptimeStats = { uptimePct: number | null; errorCount: number; total: number };

/**
 * Pure -- null uptimePct means "no decision volume in this window at all,"
 * which must never render as a false "100% uptime": there's simply nothing
 * to measure yet, distinct from real traffic running clean.
 */
export function engineUptimeStats(errorCount: number, total: number): EngineUptimeStats {
  if (total <= 0) return { uptimePct: null, errorCount, total };
  return { uptimePct: Math.round((1 - errorCount / total) * 1000) / 10, errorCount, total };
}

export type GateErrorEvent = { reasoning: string | null; created_at: string };

/**
 * Pure -- the most recent gate_error decisions, newest first, capped. Gives
 * a customer the WHAT (what actually failed) behind the uptime percentage,
 * not just a number -- a 99.8% 30-day uptime could be one blip 29 days ago
 * or an ongoing problem today, and only the actual recent events tell them
 * which.
 */
export function recentGateErrors<T extends { source: string; reasoning: string | null; created_at: string }>(
  rows: T[],
  limit = 5,
): GateErrorEvent[] {
  return rows
    .filter((r) => r.source === "gate_error")
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit)
    .map((r) => ({ reasoning: r.reasoning, created_at: r.created_at }));
}
