// "Knowledge & autonomy" plan, item 15: one clear "next best policy
// change" recommendation for an api key -- combining last round's
// automation-readiness (what's actually blocking more automation) with a
// real, historically-sized answer to "what would a specific change have
// done": lowering this key's confidence threshold for one specific
// action_type, sized against its own real recent escalations and their
// real measured outcomes. Never applies anything itself -- purely
// advisory; a human still confirms any resulting change through the
// existing POST /api-keys/:id/action-policies endpoint (item 9).
//
// Deliberately narrower than "any possible policy change": a threshold
// lowering is the one recommendation this system can size honestly from
// data it already has (escalated decisions' own confidence_score plus
// decision_outcomes) without inventing a new simulation engine, the same
// reuse-only posture previewProposedHardRules already established for
// hard-rule changes.

/** Reuses last round's own bad-outcome vocabulary (policy-downgrade.ts), but a MUCH stricter bar than that one's 40% "pull back" trigger -- recommending MORE autonomy needs to be held to a far higher standard than merely detecting trouble that already happened. */
export const RECOMMENDATION_MAX_BAD_OUTCOME_RATE = 0.15;
/** Below this many escalations with a measured outcome, there simply isn't enough real evidence to size a recommendation either way. */
export const MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION = 5;

export type EscalatedDecisionOutcome = {
  confidenceScore: number;
  /** null = outcome not yet measured for this decision -- never counted toward the bad-outcome rate either way. */
  badOutcome: boolean | null;
};

export type ThresholdRecommendation = {
  candidateThreshold: number;
  wouldAutoResolveCount: number;
  measuredCount: number;
  badOutcomeCount: number;
  /** null only when measuredCount is 0, which recommendThresholdForActionType never actually returns (it requires measuredCount >= MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION > 0) -- kept nullable for callers building their own candidates directly. */
  badOutcomeRatePct: number | null;
};

/**
 * Pure -- walks this action_type's own escalated decisions from highest
 * confidence down, greedily including one more at a time, and keeps the
 * LOWEST threshold whose cumulative real bad-outcome rate (among the
 * ones with a measured outcome so far) still clears the bar. Stops
 * growing the candidate set the moment a lower threshold would cross the
 * bar -- a real "walk out until it's no longer safe" search, not an
 * average over everything at once, so one bad early result can't be
 * diluted by a large volume of never-measured decisions.
 */
export function recommendThresholdForActionType(
  escalated: EscalatedDecisionOutcome[],
  minMeasuredSample: number = MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION,
  maxBadOutcomeRate: number = RECOMMENDATION_MAX_BAD_OUTCOME_RATE,
): ThresholdRecommendation | null {
  if (!escalated.length) return null;
  const sorted = [...escalated].sort((a, b) => b.confidenceScore - a.confidenceScore);

  let measuredCount = 0;
  let badOutcomeCount = 0;
  let best: ThresholdRecommendation | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    if (d.badOutcome != null) {
      measuredCount++;
      if (d.badOutcome) badOutcomeCount++;
    }
    if (measuredCount < minMeasuredSample) continue;
    const rate = badOutcomeCount / measuredCount;
    if (rate > maxBadOutcomeRate) break;
    best = {
      candidateThreshold: d.confidenceScore,
      wouldAutoResolveCount: i + 1,
      measuredCount,
      badOutcomeCount,
      badOutcomeRatePct: Math.round(rate * 1000) / 10,
    };
  }
  return best;
}

export type ActionTypeEscalations = { actionType: string; escalations: EscalatedDecisionOutcome[] };

export type PolicyRecommendation =
  | { kind: "not_ready"; reason: string }
  | { kind: "no_escalations"; reason: string }
  | { kind: "no_safe_recommendation"; reason: string }
  | {
    kind: "lower_confidence_threshold";
    actionType: string;
    currentBlanketThreshold: number;
    totalEscalations: number;
    recommendation: ThresholdRecommendation;
    message: string;
  };

/**
 * Pure -- the one composed recommendation. `isReady`/`topBlockerDetail`
 * come from evaluateAutomationReadiness's own report (automation-
 * readiness.ts) -- a key that isn't ready for more automation gets no
 * threshold-widening recommendation at all, no matter how good any one
 * action_type's own numbers look, the same "never toward more autonomy
 * while something is actively wrong" posture the rest of this system
 * already has.
 */
export function buildPolicyRecommendation(
  isReady: boolean,
  topBlockerDetail: string | null,
  currentBlanketThreshold: number,
  totalEscalations: number,
  perActionType: ActionTypeEscalations[],
): PolicyRecommendation {
  if (!isReady) {
    return {
      kind: "not_ready",
      reason: topBlockerDetail ?? "This key isn't ready for a more automated policy yet -- resolve its automation-readiness blockers first.",
    };
  }
  if (!perActionType.length) {
    return { kind: "no_escalations", reason: "No recent escalations to size a recommendation from -- nothing to recommend changing right now." };
  }

  let best: { actionType: string; rec: ThresholdRecommendation } | null = null;
  for (const { actionType, escalations } of perActionType) {
    const rec = recommendThresholdForActionType(escalations);
    if (rec && (!best || rec.wouldAutoResolveCount > best.rec.wouldAutoResolveCount)) {
      best = { actionType, rec };
    }
  }
  if (!best) {
    return {
      kind: "no_safe_recommendation",
      reason: `No action type had at least ${MIN_MEASURED_SAMPLE_FOR_RECOMMENDATION} measured escalations with a real bad-outcome rate at or below ${Math.round(RECOMMENDATION_MAX_BAD_OUTCOME_RATE * 100)}% -- not enough evidence to safely recommend a lower confidence threshold right now.`,
    };
  }

  const sharePct = totalEscalations > 0 ? Math.round((best.rec.wouldAutoResolveCount / totalEscalations) * 1000) / 10 : null;
  const message =
    `Lowering the confidence threshold for "${best.actionType}" to ${best.rec.candidateThreshold}% would have auto-resolved ` +
    `${best.rec.wouldAutoResolveCount} more of your recent escalations` +
    (sharePct != null ? ` (${sharePct}% of all ${totalEscalations} recent escalations)` : "") +
    `, with an estimated ${best.rec.badOutcomeRatePct}% real bad-outcome rate among the ${best.rec.measuredCount} of those with a measured outcome.`;

  return {
    kind: "lower_confidence_threshold",
    actionType: best.actionType,
    currentBlanketThreshold,
    totalEscalations,
    recommendation: best.rec,
    message,
  };
}
