// "Real precedent memory" plan, item 3: pure classification -- given
// what similar past decisions for this api key actually verdicted, should
// an about-to-auto-APPROVE resolution be pulled back to reject?
//
// Deliberately one-directional: precedent only ever pushes TOWARD
// caution, never away from it. A policy that already resolved to "deny"
// is already the safe choice and is never second-guessed by precedent --
// same "never a blind allow" posture the auto_narrow re-check (a prior
// round) already established for a different mechanism.

export type PrecedentAdvice =
  | { available: false }
  | { available: true; sampleSize: number; nonAllowShare: number; overrideToReject: boolean; contradictory: boolean };

// Needs a real sample before saying anything -- one or two similar past
// cases must never flip an automatic approval on their own.
export const MIN_PRECEDENT_SAMPLE = 3;
// A clear majority of similar past cases weren't clean allows -- not a
// bare 51%, which could just be noise in a small sample.
export const NON_ALLOW_SHARE_OVERRIDE_THRESHOLD = 0.6;
// "Real precedent memory" plan, item 8: a genuine mixed bag -- neither
// side a clear majority -- is a materially different, riskier situation
// than "every similar case went the same way," and must never be
// silently averaged away into "not quite enough to override." Anything
// from here up to NON_ALLOW_SHARE_OVERRIDE_THRESHOLD itself (which
// already overrides on its own) counts as contradictory.
export const CONTRADICTORY_LOWER_BOUND = 0.4;

/**
 * Pure -- `nonAllowFlags` is one boolean per similar past decision:
 * true when that decision's own verdict was anything other than a clean
 * "ALLOW" (a block, an escalation, a modification -- classified by the
 * caller via the same isNonAllowDecision already proven in
 * control-api-abuse.ts, not a second parallel classifier).
 */
export function evaluatePrecedentForAutoApprove(nonAllowFlags: boolean[]): PrecedentAdvice {
  if (nonAllowFlags.length < MIN_PRECEDENT_SAMPLE) return { available: false };
  const nonAllowCount = nonAllowFlags.filter(Boolean).length;
  const nonAllowShare = Math.round((nonAllowCount / nonAllowFlags.length) * 100) / 100;
  const overrideToReject = nonAllowShare >= NON_ALLOW_SHARE_OVERRIDE_THRESHOLD;
  return {
    available: true,
    sampleSize: nonAllowFlags.length,
    nonAllowShare,
    overrideToReject,
    // Never both at once -- a share that already clears the override
    // threshold is a clear majority, not a contradiction.
    contradictory: !overrideToReject && nonAllowShare >= CONTRADICTORY_LOWER_BOUND,
  };
}

/**
 * Pure -- true when precedent should pull an about-to-auto-approve
 * decision back to reject, for EITHER reason: a clear non-allow
 * majority, or a genuine, no-clear-pattern split (item 8). Both are the
 * same one-directional "extra caution" outcome from a caller's point of
 * view; kept as a single check so nobody wires just overrideToReject and
 * quietly drops the contradictory case.
 */
export function shouldRejectOnPrecedent(advice: PrecedentAdvice): boolean {
  return advice.available && (advice.overrideToReject || advice.contradictory);
}

export function summarizePrecedentOverride(advice: Extract<PrecedentAdvice, { available: true }>): string {
  if (advice.contradictory) {
    return `Resolved automatically to rejected: similar past decisions for this API key were a genuine mixed bag ` +
      `(${Math.round(advice.nonAllowShare * 100)}% non-allow out of ${advice.sampleSize}, no clear pattern either way) — ` +
      `contradictory precedent is its own reason for caution, not just an average that cancels out. No human reviewed this.`;
  }
  return `Resolved automatically to rejected: ${Math.round(advice.nonAllowShare * 100)}% of ${advice.sampleSize} similar ` +
    `past decisions for this API key were NOT clean allows — real precedent overrode what would otherwise have been an ` +
    `automatic approval, no human reviewed this.`;
}

// "Real precedent memory" plan, item 6: a past decision's verdict alone
// ("was it a clean allow?") is only half the story -- what actually
// happened afterwards matters too. A clean ALLOW that measurably went
// badly should count as concerning precedent; a blocked/escalated action
// whose narrower retry measurably went well should not keep counting
// against future similar requests forever.
export type OutcomeDirection = "positive" | "negative" | "neutral" | "unknown";

/**
 * Pure -- refines the plain verdict-based "was this concerning?" flag
 * with a real measured outcome, when one exists. `outcomeDirection` is
 * null when no decision_outcomes row exists yet for that past decision
 * (the common case today -- coverage is sparse) or when its own direction
 * was "neutral"/"unknown" (ran, but no measured business impact yet) --
 * in both of those cases this falls back to the verdict-only signal
 * unchanged, exactly item 3's original behavior. Only a real "negative"
 * or "positive" measurement can move the flag away from the verdict.
 */
export function classifyPrecedentOutcome(wasNonAllowVerdict: boolean, outcomeDirection: OutcomeDirection | null): boolean {
  if (outcomeDirection === "negative") return true;
  if (outcomeDirection === "positive") return false;
  return wasNonAllowVerdict;
}
