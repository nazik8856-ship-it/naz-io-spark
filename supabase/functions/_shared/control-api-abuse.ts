// Pure classification for control-api-abuse-sweep: given recent
// agent_decisions rows attributed to a control-api key, decide which keys
// look like abuse -- a leaked key being probed with garbage, or a
// misbehaving external integration retrying the same bad action --
// without any DB/HTTP dependency, so this is fully unit testable. The
// actual DB query and grouping-by-key happens in the edge function.

export type DecisionRow = { api_key_id: string; user_id: string; decision: string };
export type KeyActivity = { apiKeyId: string; userId: string; total: number; nonAllow: number };

/** Pure -- this codebase's own decision strings all start with the verb ("ALLOW ...", "BLOCK ...", "MODIFY ...", "CIRCUIT_BREAKER_TRIPPED ..."). Anything not starting with ALLOW is a non-allow outcome. */
export function isNonAllowDecision(decisionText: string): boolean {
  return !decisionText.trim().toUpperCase().startsWith("ALLOW");
}

/** Pure -- groups raw decision rows into per-key activity totals. */
export function summarizeKeyActivity(rows: DecisionRow[]): KeyActivity[] {
  const byKey = new Map<string, KeyActivity>();
  for (const r of rows) {
    const existing = byKey.get(r.api_key_id) ?? { apiKeyId: r.api_key_id, userId: r.user_id, total: 0, nonAllow: 0 };
    existing.total += 1;
    if (isNonAllowDecision(r.decision)) existing.nonAllow += 1;
    byKey.set(r.api_key_id, existing);
  }
  return [...byKey.values()];
}

/** A high raw call volume in one sweep window, regardless of outcome -- catches a runaway loop or an unexpectedly large integration burst. */
export function isVolumeAbuse(total: number, volumeThreshold: number): boolean {
  return total >= volumeThreshold;
}

/** A meaningfully-sized sample where most calls are non-allow -- catches a key being probed with garbage, or an integration stuck retrying a rejected action. Requires a minimum sample so a brand-new key's first few blocked calls don't immediately alert. */
export function isBlockRateAbuse(total: number, nonAllow: number, minSample: number, rateThreshold: number): boolean {
  if (total < minSample) return false;
  return nonAllow / total >= rateThreshold;
}

export function summarizeAbuseReason(activity: KeyActivity, volumeThreshold: number, minSample: number, rateThreshold: number): string {
  const volume = isVolumeAbuse(activity.total, volumeThreshold);
  const blockRate = isBlockRateAbuse(activity.total, activity.nonAllow, minSample, rateThreshold);
  if (volume && blockRate) {
    return `${activity.total} requests in the last sweep window, ${activity.nonAllow} of them non-allow (${Math.round((activity.nonAllow / activity.total) * 100)}%) -- both an unusually high volume and an unusually high non-allow rate.`;
  }
  if (volume) {
    return `${activity.total} requests in the last sweep window -- an unusually high volume for one key.`;
  }
  return `${activity.nonAllow} of ${activity.total} requests (${Math.round((activity.nonAllow / activity.total) * 100)}%) were non-allow in the last sweep window -- an unusually high rate for a healthy integration.`;
}
