// Pure week-over-week trend computation — shared by the weekly trend
// email for decision volume, escalation rate, and spend, so all three use
// identical up/down/flat + percent-change logic.

export type TrendDirection = "up" | "down" | "flat";
export type Trend = { current: number; previous: number; changePct: number; direction: TrendDirection };

/** Pure. changePct is null when there's no prior baseline to compare against (previous === 0 and current === 0). */
export function computeTrend(current: number, previous: number): Trend {
  const direction: TrendDirection = current > previous ? "up" : current < previous ? "down" : "flat";
  const changePct = previous > 0
    ? Math.round(((current - previous) / previous) * 1000) / 10
    : current > 0
      ? 100
      : 0;
  return { current, previous, changePct, direction };
}
