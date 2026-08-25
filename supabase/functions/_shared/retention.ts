// Pure helper for retention-sweep's per-account cutoff calculation.
// Extracted so the "never let a configured retention_days go below the
// 30-day floor" rule has a real test behind it, not just an inline
// Math.max() a future edit could silently drop.
export function retentionCutoffIso(retentionDays: number, now: Date = new Date()): string {
  const effectiveDays = Math.max(30, retentionDays);
  return new Date(now.getTime() - effectiveDays * 24 * 60 * 60 * 1000).toISOString();
}
