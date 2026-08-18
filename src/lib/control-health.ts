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
