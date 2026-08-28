// "Policy autonomy" plan, item 4: a key that gets paused for abuse
// quietly regains full trust in 30 minutes, every single time -- and a
// broken callback URL just silently falls back forever with no
// consequence. If a key needs its safety net more than once in a short
// window, or its callback keeps failing, its own on_uncertain policy
// should automatically pull back toward more caution until a human
// clears it -- a genuine, explicit exception to "only a human changes
// on_uncertain," always tagged unmistakably as system-initiated.

// A pause from a year ago and one from yesterday are not the same
// signal -- pause_count itself is a lifetime total that never resets,
// so it can't tell "paused twice, a year apart" (not a real pattern)
// from "paused twice this week" (real repeated trouble). This window is
// what actually distinguishes them.
export const REPEATED_PAUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// How many callback answers in a row have to be "nothing arrived, fell
// back" before that's treated as the callback itself being broken,
// rather than one unlucky timeout.
export const CALLBACK_FAILURE_STREAK_THRESHOLD = 3;

/** Pure -- does a NEW pause, compared against this key's previous pause, count as "repeated trouble" rather than an isolated, long-past incident? */
export function isRepeatedPauseTrouble(previousPauseAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!previousPauseAt) return false;
  return now.getTime() - new Date(previousPauseAt).getTime() <= REPEATED_PAUSE_WINDOW_MS;
}

/** Pure -- has a callback failure streak crossed the threshold worth downgrading over? */
export function isCallbackFailureTrouble(failureStreak: number): boolean {
  return failureStreak >= CALLBACK_FAILURE_STREAK_THRESHOLD;
}

// "Knowledge & autonomy" plan, item 5: today a key only gets pulled back
// toward caution for BEHAVING badly (abuse volume, callback failures) --
// never for its auto-resolved decisions actually GOING badly in the real
// world. decision_outcomes.direction is real, already-measured data no
// pause/downgrade mechanism reads. Deliberately requires a real sample
// (measured-outcome coverage is sparse in practice, same caveat
// precedent-search.ts's own loadOutcomeDirections already documents) --
// one or two unlucky negative outcomes must never trip this on their own.
export const BAD_OUTCOME_MIN_SAMPLE = 5;
export const BAD_OUTCOME_NEGATIVE_RATE_THRESHOLD = 0.4;

/** Pure -- is this key's own auto-resolved (never-escalated) decision history measurably going badly in the real world, with enough sample to trust the signal? */
export function isBadOutcomeTrouble(
  negativeCount: number,
  totalMeasured: number,
  minSample: number = BAD_OUTCOME_MIN_SAMPLE,
  threshold: number = BAD_OUTCOME_NEGATIVE_RATE_THRESHOLD,
): boolean {
  return totalMeasured >= minSample && negativeCount / totalMeasured >= threshold;
}

export type DowngradeReason = "repeated_pause" | "callback_failures" | "bad_outcomes";

export function summarizePolicyDowngrade(reason: DowngradeReason, detail: string): string {
  const why = reason === "repeated_pause"
    ? "this key has been automatically paused for unusual activity more than once within a short window"
    : reason === "callback_failures"
      ? `this key's configured callback URL has failed to answer in time ${detail} times in a row`
      : `this key's own auto-resolved decisions have measured, real-world negative outcomes ${detail} of the time recently -- ` +
        `more often than automation this account never reviews should`;
  return (
    `This API key's on_uncertain policy has been automatically set to "human_review" because ${why} -- ` +
    `automation for uncertain cases is paused until a human reviews and resets the policy. This is a system-initiated ` +
    `safety change, not something anyone on your team set.`
  );
}
