// Cron helpers extracted from compile-agent-manifest/index.ts for real test
// coverage. The AI is asked to produce its own `triggers` cron spec
// reflecting the user's literal schedule request (e.g. "every morning" ->
// "0 8 * * *"), separate from the role blueprint's generic default cadence
// (e.g. ops_finance defaults to "0 7 * * *"). deriveCronLabel is used to
// decide whether the AI's own cron is trustworthy enough to prefer over the
// blueprint default: only when it matches one of the shapes nextRunFromCron
// actually understands, so a malformed AI-supplied string can't silently
// produce a mislabeled or unschedulable agent.

export function deriveCronLabel(cron: string): string | null {
  let m = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) return `Every ${m[1]} minutes`;
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) return `Daily at ${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")} UTC`;
  m = cron.match(/^(\d+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) return `Every ${m[2]} hours`;
  return null;
}

export function nextRunFromCron(cron: string, now: Date = new Date()): string {
  const n = new Date(now);
  let m = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) { n.setMinutes(n.getMinutes() + parseInt(m[1], 10)); return n.toISOString(); }
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) {
    const next = new Date(n);
    next.setUTCHours(parseInt(m[2], 10), parseInt(m[1], 10), 0, 0);
    if (next <= n) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }
  m = cron.match(/^(\d+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) { n.setHours(n.getHours() + parseInt(m[2], 10)); return n.toISOString(); }
  n.setHours(n.getHours() + 1);
  return n.toISOString();
}
