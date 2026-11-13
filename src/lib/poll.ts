// Outer Control screens that follow a running Task (docs/outer-control-polling.md). Pure, so the schedule is tested alone.

export const POLL_FAST_MS = 3_000;   // something is running: it visibly moves
export const POLL_SLOW_MS = 15_000;  // only waiting for a person: nothing moves by itself
export const POLL_MAX_MS = 60_000;   // never slower than this after failures

/** How long to wait before the next refresh. Each failure in a row doubles the wait, up to a minute; a success starts over. */
export function pollDelay(fast: boolean, failures: number): number {
  const base = fast ? POLL_FAST_MS : POLL_SLOW_MS;
  const n = Number.isFinite(failures) ? Math.min(Math.max(0, Math.trunc(failures)), 6) : 6; // an unknown count is treated as many
  return Math.min(POLL_MAX_MS, base * 2 ** n);
}
