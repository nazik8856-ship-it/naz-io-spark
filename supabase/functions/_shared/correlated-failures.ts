// Pure classification for cron-correlated-failures: given recent circuit
// breaker trips (already per-agent since 2026-08-22), decide which ones
// look like a FLEET-WIDE, systemic problem rather than one misbehaving
// agent. No DB dependency so this is fully unit testable -- the actual
// cross-account join (incidents <-> agent_decisions, only exposed via the
// get_recent_breaker_trips SECURITY DEFINER RPC since every other gate/
// breaker query is deliberately siloed per account/agent) happens in the
// edge function, which maps rows into this shape first.
//
// A single agent tripping its own breaker repeatedly is already covered by
// the per-agent circuit breaker itself -- that's not this signal. This is:
// TWO OR MORE DIFFERENT agents (or, per the Inner/Outer Control sync fix
// below, API keys) on the same account independently tripping a breaker
// for the same (action_type, provider) within the lookback window, which
// looks a lot more like "Gmail is down" than "one agent has a bad prompt."
//
// Inner/Outer Control sync fix: this previously only ever counted distinct
// agentId values, so Outer Control's own breaker trips (agent_id always
// null, api_key_id set instead, since control-api's mode="full" forward
// never ties an action to an internal agent) never contributed any
// distinct-source evidence at all -- multiple DIFFERENT API keys
// independently tripping a breaker on the same provider could never
// trigger this incident, only multi-AGENT correlation was detected. A
// trip's "source" is now agentId if set, else apiKeyId if set (the two are
// mutually exclusive in real traffic, same as ai_spend_caps' own
// agent_id/api_key_id split) -- distinctAgentIds/distinctApiKeyIds are
// still reported separately for the alert text, but the threshold check
// itself counts the UNION of both, so one agent plus one key tripping the
// same shape independently is just as real a signal as two agents.

export type BreakerTripRow = {
  userId: string;
  actionType: string;
  provider: string | null;
  agentId: string | null;
  apiKeyId: string | null;
  decisionId: string | null;
  openedAt: string;
};

export type CorrelatedFailureGroup = {
  userId: string;
  actionType: string;
  provider: string | null;
  distinctAgentIds: string[];
  distinctApiKeyIds: string[];
  tripCount: number;
  /** The most recent trip's decision id, for linking the alert. */
  latestDecisionId: string | null;
  latestOpenedAt: string;
};

const groupKey = (r: Pick<BreakerTripRow, "userId" | "actionType" | "provider">): string =>
  `${r.userId}::${r.actionType}::${r.provider ?? ""}`;

/**
 * Groups trips by (userId, actionType, provider) and keeps only the groups
 * where at least `minDistinctSources` DIFFERENT agents and/or API keys
 * tripped independently -- an account-wide trip (both agentId and
 * apiKeyId null) counts toward the group's trip count but never toward
 * the distinct-source count, since it isn't evidence of a second source
 * being affected.
 */
export function findCorrelatedFailures(rows: BreakerTripRow[], minDistinctSources = 2): CorrelatedFailureGroup[] {
  const groups = new Map<string, BreakerTripRow[]>();
  for (const r of rows) {
    const key = groupKey(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const result: CorrelatedFailureGroup[] = [];
  for (const list of groups.values()) {
    const distinctAgentIds = [...new Set(list.map((r) => r.agentId).filter((id): id is string => !!id))];
    const distinctApiKeyIds = [...new Set(list.map((r) => r.apiKeyId).filter((id): id is string => !!id))];
    const distinctSourceCount = distinctAgentIds.length + distinctApiKeyIds.length;
    if (distinctSourceCount < minDistinctSources) continue;
    const sorted = [...list].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const latest = sorted[0];
    result.push({
      userId: latest.userId,
      actionType: latest.actionType,
      provider: latest.provider,
      distinctAgentIds,
      distinctApiKeyIds,
      tripCount: list.length,
      latestDecisionId: latest.decisionId,
      latestOpenedAt: latest.openedAt,
    });
  }
  return result.sort((a, b) => b.latestOpenedAt.localeCompare(a.latestOpenedAt));
}

/**
 * Which correlated-failure groups actually need a NEW alert -- skips any
 * group that already has an unresolved incident for the same
 * (userId, actionType, provider), so a still-ongoing outage doesn't spam a
 * fresh alert on every cron run.
 */
export function groupsNeedingNewAlert(
  groups: CorrelatedFailureGroup[],
  openAlertKeys: readonly { userId: string; actionType: string; provider: string | null }[],
): CorrelatedFailureGroup[] {
  const open = new Set(openAlertKeys.map(groupKey));
  return groups.filter((g) => !open.has(groupKey(g)));
}

export function summarizeCorrelatedFailure(g: CorrelatedFailureGroup): string {
  const providerPart = g.provider ? ` (${g.provider})` : "";
  const hasAgents = g.distinctAgentIds.length > 0;
  const hasKeys = g.distinctApiKeyIds.length > 0;
  const sourcePart =
    hasAgents && hasKeys
      ? `${g.distinctAgentIds.length} different agent(s) and ${g.distinctApiKeyIds.length} different API key(s)`
      : hasKeys
        ? `${g.distinctApiKeyIds.length} different API keys`
        : `${g.distinctAgentIds.length} different agents`;
  return (
    `${sourcePart} independently tripped a circuit breaker for ` +
    `"${g.actionType}"${providerPart} in the last check window (${g.tripCount} trip(s) total). ` +
    `This looks like a systemic problem, not one misbehaving agent.`
  );
}
