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

// ---- "Zero human review" plan, item 7: auto-pause a runaway key ----
//
// Alerting alone (above) only ever reaches a human -- exactly the wrong
// answer for a fully-automated integration where nobody may be watching
// alerts at all. Mirrors the circuit breaker's own proven pause-then-
// recover shape (control-gate.ts's BREAKER_COOLDOWN_MS / half-open
// trial), applied to a whole key instead of one action type: once
// paused, resolve_api_key itself rejects every call for this key until
// paused_until elapses, at which point calls succeed again automatically
// -- no separate "recovery" job needed, the pause is self-expiring by
// construction. The rolling-window abuse check this file's own
// isVolumeAbuse/isBlockRateAbuse already do is a natural stand-in for
// the breaker's discrete "half-open trial": while paused, a rejected
// call never reaches agent_decisions at all, so the very next sweep
// pass sees a quiet window for this key and does not re-pause unless
// traffic resumes looking abusive again.

/** How long a single auto-pause lasts once triggered. */
export const PAUSE_COOLDOWN_MINUTES = 30;

/** Pure -- is this key inside an active pause window right now? */
export function isCurrentlyPaused(pausedUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!pausedUntil) return false;
  return new Date(pausedUntil).getTime() > now.getTime();
}

/** Pure -- the paused_until timestamp a fresh auto-pause should be set to. */
export function computePauseUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + PAUSE_COOLDOWN_MINUTES * 60_000).toISOString();
}

/** Pure -- the message a paused key's caller sees at auth time, distinct from a plain "unauthorized" so this is never mistaken for a revoked/expired key. */
export function pausedKeyMessage(pausedUntil: string): string {
  return `This API key was automatically paused after unusual activity was detected. It will resume accepting requests on its own at ${pausedUntil} — no action is needed to un-pause it.`;
}

// ---- "Policy autonomy" plan, item 2: coordinated abuse across an
// account's multiple API keys ----
//
// Everything above watches exactly one key at a time. A company running
// several keys could spread suspicious traffic across them to stay
// under each individual key's own threshold while the account as a
// whole looks clearly abnormal. This adds a second, account-level check
// alongside the existing per-key one -- reusing the exact same
// isVolumeAbuse/isBlockRateAbuse thresholds, just summed across an
// account's keys instead of read off one key alone.

export type AccountActivity = { userId: string; total: number; nonAllow: number; keyCount: number };

/** Pure -- groups the SAME raw decision rows summarizeKeyActivity reads, by account instead of by key, tracking how many distinct keys contributed. */
export function summarizeAccountActivity(rows: DecisionRow[]): AccountActivity[] {
  const byUser = new Map<string, AccountActivity & { keys: Set<string> }>();
  for (const r of rows) {
    const existing = byUser.get(r.user_id) ?? { userId: r.user_id, total: 0, nonAllow: 0, keyCount: 0, keys: new Set<string>() };
    existing.total += 1;
    if (isNonAllowDecision(r.decision)) existing.nonAllow += 1;
    existing.keys.add(r.api_key_id);
    existing.keyCount = existing.keys.size;
    byUser.set(r.user_id, existing);
  }
  return [...byUser.values()].map(({ keys: _keys, ...rest }) => rest);
}

/**
 * Pure -- true when an account's traffic, summed across its keys, looks
 * abusive by the same thresholds a single key would trip. Requires at
 * least 2 keys: a one-key account tripping this is already exactly what
 * the existing per-key check (isVolumeAbuse/isBlockRateAbuse on that one
 * key) already catches -- this check exists specifically for the
 * spread-across-keys case a per-key view can't see.
 */
export function isCoordinatedAccountAbuse(
  account: AccountActivity,
  volumeThreshold: number,
  minSample: number,
  rateThreshold: number,
): boolean {
  if (account.keyCount < 2) return false;
  return isVolumeAbuse(account.total, volumeThreshold) || isBlockRateAbuse(account.total, account.nonAllow, minSample, rateThreshold);
}

export function summarizeCoordinatedAbuse(account: AccountActivity, volumeThreshold: number, minSample: number, rateThreshold: number): string {
  const volume = isVolumeAbuse(account.total, volumeThreshold);
  const blockRate = isBlockRateAbuse(account.total, account.nonAllow, minSample, rateThreshold);
  const pct = account.total > 0 ? Math.round((account.nonAllow / account.total) * 100) : 0;
  const signal = volume && blockRate
    ? `${account.total} requests (${pct}% non-allow) -- both an unusually high volume and non-allow rate`
    : volume
      ? `${account.total} requests -- an unusually high volume`
      : `${account.nonAllow} of ${account.total} requests (${pct}%) non-allow -- an unusually high rate`;
  return (
    `Across ${account.keyCount} of your Control API keys, ${signal} in the last sweep window. Each individual key ` +
    `looks fine on its own -- this is only visible when your account's traffic is looked at as a whole. Worth a look.`
  );
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
