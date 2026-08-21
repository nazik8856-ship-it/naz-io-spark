// Pure week-over-week trend computation. Mirrors
// supabase/functions/_shared/trend.ts — duplicated here rather than
// imported since that file lives outside the Vite frontend's root (same
// reasoning as coverage-gaps.ts duplicating rule-matching.ts's globToRe).

export type TrendDirection = "up" | "down" | "flat";
export type Trend = { current: number; previous: number; changePct: number; direction: TrendDirection };

/** Pure. changePct is 0 when there's no prior baseline and current is also 0. */
export function computeTrend(current: number, previous: number): Trend {
  const direction: TrendDirection = current > previous ? "up" : current < previous ? "down" : "flat";
  const changePct = previous > 0
    ? Math.round(((current - previous) / previous) * 1000) / 10
    : current > 0
      ? 100
      : 0;
  return { current, previous, changePct, direction };
}
