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
  | { available: true; sampleSize: number; nonAllowShare: number; overrideToReject: boolean };

// Needs a real sample before saying anything -- one or two similar past
// cases must never flip an automatic approval on their own.
export const MIN_PRECEDENT_SAMPLE = 3;
// A clear majority of similar past cases weren't clean allows -- not a
// bare 51%, which could just be noise in a small sample.
export const NON_ALLOW_SHARE_OVERRIDE_THRESHOLD = 0.6;

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
  const nonAllowShare = nonAllowCount / nonAllowFlags.length;
  return {
    available: true,
    sampleSize: nonAllowFlags.length,
    nonAllowShare: Math.round(nonAllowShare * 100) / 100,
    overrideToReject: nonAllowShare >= NON_ALLOW_SHARE_OVERRIDE_THRESHOLD,
  };
}

export function summarizePrecedentOverride(advice: Extract<PrecedentAdvice, { available: true }>): string {
  return `Resolved automatically to rejected: ${Math.round(advice.nonAllowShare * 100)}% of ${advice.sampleSize} similar ` +
    `past decisions for this API key were NOT clean allows — real precedent overrode what would otherwise have been an ` +
    `automatic approval, no human reviewed this.`;
}
