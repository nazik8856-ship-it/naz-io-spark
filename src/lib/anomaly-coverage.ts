// Anomaly-detector coverage (2026-08-23) — the per-agent behavioral-
// baseline anomaly detector deliberately skips any action with no agentId
// ("no history to baseline against for a one-off action" — see
// control-gate.ts's layer 6 comment). That skip is a documented design
// choice, not an oversight, but there was zero instrumentation to say
// whether it's actually a sized problem. Rather than a one-off query run
// once, this is a live panel: always shows the current answer, so the
// "is this a real gap" question never goes stale.

export type CoverageSeverity = "none" | "low" | "moderate" | "high";

/** Pure — what fraction of decisions in range have no agent tied to them. */
export function classifyAnomalyCoverage(total: number, agentless: number): { pct: number; severity: CoverageSeverity } {
  if (total <= 0) return { pct: 0, severity: "none" };
  const pct = Math.round((agentless / total) * 1000) / 10; // one decimal place
  const severity: CoverageSeverity = pct < 5 ? "none" : pct < 20 ? "low" : pct < 50 ? "moderate" : "high";
  return { pct, severity };
}

export type AgentlessActionType = { action_type: string; provider: string | null; count: number };

/**
 * Pure — groups agentless decisions by (action_type, provider) and returns
 * the top N by volume, so a real gap comes with "where" attached instead
 * of just a percentage.
 */
export function topAgentlessActionTypes(
  rows: { action_type: string | null; provider: string | null }[],
  n = 10,
): AgentlessActionType[] {
  const counts = new Map<string, AgentlessActionType>();
  for (const r of rows) {
    const actionType = r.action_type ?? "(unknown)";
    const provider = r.provider ?? null;
    const key = `${actionType}::${provider ?? ""}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { action_type: actionType, provider, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, n);
}
