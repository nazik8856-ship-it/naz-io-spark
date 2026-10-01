// Pure helpers for the Control System dashboard (blueprint task #63): date
// bucketing for the stat-card sparklines. Kept separate from the
// data-fetching hook so the arithmetic is directly testable, same pattern
// as control-health.ts.

/** Pure — the last `n` UTC calendar day strings (YYYY-MM-DD), oldest first. */
export function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Pure — counts of `rows` per day in `days`, days with no rows reading 0. */
export function bucketCountByDay<T>(rows: T[], dateOf: (row: T) => string, days: string[]): number[] {
  const counts = new Map(days.map((d) => [d, 0]));
  for (const row of rows) {
    const day = dateOf(row).slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return days.map((d) => counts.get(d) ?? 0);
}

/** Pure — per-day autonomous (non-escalated) percentage, null for days with no decisions (sparkline renders those as a gap, not a false 0%). */
export function bucketEfficiencyByDay<T>(
  rows: T[],
  dateOf: (row: T) => string,
  escalatedOf: (row: T) => boolean,
  days: string[],
): (number | null)[] {
  const totals = new Map(days.map((d) => [d, 0]));
  const escalated = new Map(days.map((d) => [d, 0]));
  for (const row of rows) {
    const day = dateOf(row).slice(0, 10);
    if (!totals.has(day)) continue;
    totals.set(day, (totals.get(day) ?? 0) + 1);
    if (escalatedOf(row)) escalated.set(day, (escalated.get(day) ?? 0) + 1);
  }
  return days.map((d) => {
    const total = totals.get(d) ?? 0;
    if (total === 0) return null;
    return Math.round((1 - (escalated.get(d) ?? 0) / total) * 1000) / 10;
  });
}
