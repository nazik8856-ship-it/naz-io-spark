// Pure classification for the weekly audit-integrity sweep — extracted out
// of the edge function's DB-coupled orchestration so it's directly unit
// testable, same reasoning as self-audit-diff.ts for control-self-audit.
import { CONTRADICTORY_LOWER_BOUND, NON_ALLOW_SHARE_OVERRIDE_THRESHOLD, MIN_PRECEDENT_SAMPLE } from "./precedent-advice.ts";
import { matchesActionTypePattern } from "./action-type-policy.ts";

export type SignatureVerifyResult = {
  checked: number;
  verified: number;
  unsigned: number;
  mismatched_count: number;
};

// "Zero human review" plan, item 15: extends this same sweep to ALSO
// re-evaluate every auto-approved decision in range against the
// account's CURRENT policy snapshot (reusing policy-replay.ts's own
// evaluateAction, the same deterministic hard-rule + safety-scanner
// re-check control-engine's auto_narrow flow and policy-watch.ts already
// use elsewhere) -- catching a bug in the automation itself (something
// auto-approved that a live policy would now block or require approval
// for), not just a tampered record after the fact. Optional fields, not
// a required part of SignatureVerifyResult itself, so every existing
// caller/test that only ever dealt with signatures keeps working
// unchanged; they default to 0 (nothing checked, nothing mismatched)
// wherever omitted.
export type AutoResolutionAuditFields = {
  auto_resolutions_checked?: number;
  auto_resolutions_mismatched?: number;
};

// "Real precedent memory" plan, item 15: extends this same sweep to ALSO
// re-check every real precedent citation (item 9's own
// agent_decisions.precedent_citations) recorded in range -- did that
// precedent genuinely exist, and did it genuinely support the verdict it's
// attached to? Same optional-fields-on-the-same-result-type technique as
// AutoResolutionAuditFields above, so every existing caller/test keeps
// working unchanged.
export type PrecedentCitationAuditFields = {
  precedent_citations_checked?: number;
  precedent_citations_mismatched?: number;
};

// "Policy autonomy" plan, item 15: extends this same sweep to ALSO check
// decision consistency -- does the same kind of request (found via the
// existing precedent/embedding infrastructure, precedent-search.ts's
// findPrecedent) get a consistent verdict over time, or is there real,
// unexplained flip-flopping. Same optional-fields technique as the two
// AuditFields types above, so every existing caller/test keeps working
// unchanged.
export type DecisionConsistencyAuditFields = {
  decision_consistency_checked?: number;
  decision_consistency_mismatched?: number;
};

// "Knowledge & autonomy" plan, item 4: extends this same sweep to ALSO
// check knowledge-base (item 1) health -- an entry that's gone stale
// (no matching real decision in a long time) or unreachable (an
// always_block hard rule already shadows its exact scope). Same
// optional-fields technique as every other dimension above.
export type KnowledgeBaseHealthAuditFields = {
  knowledge_base_checked?: number;
  knowledge_base_mismatched?: number;
};

export type AuditIntegrityResult = SignatureVerifyResult & AutoResolutionAuditFields & PrecedentCitationAuditFields & DecisionConsistencyAuditFields & KnowledgeBaseHealthAuditFields;

export type StoredPrecedentCitation = {
  reason: string;
  sampleSize: number;
  nonAllowShare: number;
  citedDecisions: { decisionId: string }[];
};

/**
 * Pure -- a citation record is a genuine integrity concern when: its own
 * claimed sample size doesn't match how many decisions it actually lists,
 * any decision it cites no longer exists, its own stats don't clear
 * EITHER override threshold at all (a citation should only ever exist
 * when one did), or its stated reason doesn't match which threshold its
 * own stats actually clear. Any of these means either the record was
 * tampered with after the fact, or there's a real bug in how the
 * precedent-memory system built it in the first place.
 */
export function isPrecedentCitationMismatch(record: StoredPrecedentCitation, existingDecisionIds: Set<string>): boolean {
  if (record.citedDecisions.length !== record.sampleSize) return true;
  if (record.citedDecisions.some((c) => !existingDecisionIds.has(c.decisionId))) return true;
  const overrideToReject = record.nonAllowShare >= NON_ALLOW_SHARE_OVERRIDE_THRESHOLD;
  const contradictory = !overrideToReject && record.nonAllowShare >= CONTRADICTORY_LOWER_BOUND;
  if (!overrideToReject && !contradictory) return true;
  const expectedReason = contradictory ? "contradictory" : "non_allow_majority";
  return record.reason !== expectedReason;
}

/** Pure -- an auto-approved action that would NOT cleanly pass ("pass_through") the account's current policy is a real integrity concern, whichever gate layer would now stop it. */
export function isAutoResolutionMismatch(gateOutcome: "block" | "require_approval" | "pass_through"): boolean {
  return gateOutcome !== "pass_through";
}

/**
 * Pure -- is this decision "unexplained flip-flopping" against its own
 * precedent cohort (found via the existing precedent/embedding search,
 * precedent-search.ts's findPrecedent)?
 *
 * An escalated decision or a human_override is NEVER flagged: a real
 * human looking at it and deciding differently is a legitimate,
 * explainable reason for a different outcome, not an inconsistency bug
 * -- exactly the same "a human's own judgment is never second-guessed"
 * posture this codebase already applies elsewhere (precedent-advice.ts's
 * own one-directional design).
 *
 * A precedent cohort that's itself a genuine mixed bag (no clear
 * majority either way, the exact same CONTRADICTORY_LOWER_BOUND /
 * NON_ALLOW_SHARE_OVERRIDE_THRESHOLD split evaluatePrecedentForAutoApprove
 * already uses) has no single "consistent" answer to have flip-flopped
 * away from -- correctly never flagged either. Only a decision that
 * disagrees with a CLEAR precedent majority, with no human involved to
 * explain the difference, counts as a real consistency concern.
 */
export function isDecisionConsistencyMismatch(
  ownNonAllow: boolean,
  escalated: boolean,
  source: string,
  similarNonAllowFlags: boolean[],
): boolean {
  if (escalated || source === "human_override") return false;
  if (similarNonAllowFlags.length < MIN_PRECEDENT_SAMPLE) return false;

  const nonAllowShare = similarNonAllowFlags.filter(Boolean).length / similarNonAllowFlags.length;
  const clearNonAllowMajority = nonAllowShare >= NON_ALLOW_SHARE_OVERRIDE_THRESHOLD;
  const clearAllowMajority = nonAllowShare < CONTRADICTORY_LOWER_BOUND;
  if (!clearNonAllowMajority && !clearAllowMajority) return false;

  const agreesWithMajority = (clearNonAllowMajority && ownNonAllow) || (clearAllowMajority && !ownNonAllow);
  return !agreesWithMajority;
}

// "Knowledge & autonomy" plan, item 4: a knowledge base (item 1) that
// just grows forever gets stale and can start contradicting the rest of
// the account's own policy. Two real, deterministic checks --
// deliberately NOT a semantic "does this contradict that" judgment
// (which would need an LLM call, breaking this file's existing all-
// pure, no-AI-call discipline across every other dimension):
export type KnowledgeBaseHealthEntry = { id: string; action_type_pattern: string | null; provider: string | null };
export type RecentActionShape = { action_type: string; provider: string | null };
export type HardRuleBlockShape = { action_type_pattern: string; provider: string | null; effect: string };

const normalizePattern = (p: string | null): string => p ?? "*";
const normalizeProvider = (p: string | null): string | null => p ? p.toLowerCase() : null;

/**
 * Pure -- STALE: an unscoped entry (applies to everything) is never
 * stale by this measure, since it matches every real decision by
 * definition. A scoped entry is stale when NONE of the given recent
 * real decision shapes match it -- its guidance hasn't been relevant to
 * anything NazAI has actually judged in a long time.
 */
export function isStaleKnowledgeBaseEntry(entry: KnowledgeBaseHealthEntry, recentShapes: RecentActionShape[]): boolean {
  if (!entry.action_type_pattern) return false;
  return !recentShapes.some((s) =>
    matchesActionTypePattern(entry.action_type_pattern!, s.action_type) &&
    (!entry.provider || normalizeProvider(entry.provider) === normalizeProvider(s.provider)),
  );
}

/**
 * Pure -- UNREACHABLE: an always_block hard rule already declares the
 * EXACT same scope (same pattern, same provider) as this entry. Hard
 * rules short-circuit control-gate.ts's judgment prompt before it's
 * ever built (a match means "model_judged: false"), so the model can
 * never actually see this entry's guidance for anything matching it.
 * Exact-scope match only, not glob subsumption -- a narrower, always-
 * correct check beats a broader one that might guess wrong.
 */
export function isUnreachableKnowledgeBaseEntry(entry: KnowledgeBaseHealthEntry, hardRules: HardRuleBlockShape[]): boolean {
  return hardRules.some((r) =>
    r.effect === "always_block" &&
    normalizePattern(r.action_type_pattern) === normalizePattern(entry.action_type_pattern) &&
    normalizeProvider(r.provider) === normalizeProvider(entry.provider),
  );
}

/** Pure -- a real knowledge-base health concern for either reason above. */
export function isKnowledgeBaseHealthMismatch(
  entry: KnowledgeBaseHealthEntry,
  recentShapes: RecentActionShape[],
  hardRules: HardRuleBlockShape[],
): boolean {
  return isStaleKnowledgeBaseEntry(entry, recentShapes) || isUnreachableKnowledgeBaseEntry(entry, hardRules);
}

/**
 * A sweep is a failure worth alerting on if ANY signature didn't match
 * what was actually signed at creation (the audit trail may have been
 * altered), any decision in range has no signature at all (the signing
 * trigger should fire on every insert -- an unsigned row in a recent
 * window means it silently didn't), OR any auto-resolved decision no
 * longer cleanly passes the account's current policy.
 */
export function isAuditIntegrityFailure(r: AuditIntegrityResult): boolean {
  return r.mismatched_count > 0 || r.unsigned > 0 || (r.auto_resolutions_mismatched ?? 0) > 0 ||
    (r.precedent_citations_mismatched ?? 0) > 0 || (r.decision_consistency_mismatched ?? 0) > 0 ||
    (r.knowledge_base_mismatched ?? 0) > 0;
}

export function summarizeAuditIntegrityFailure(r: AuditIntegrityResult): string {
  const parts = [`Audit integrity sweep: checked ${r.checked} decision(s), ${r.verified} verified.`];
  if (r.mismatched_count > 0) {
    parts.push(`${r.mismatched_count} signature mismatch(es) -- the audit trail may have been altered.`);
  }
  if (r.unsigned > 0) {
    parts.push(`${r.unsigned} decision(s) in range have no signature at all.`);
  }
  if ((r.auto_resolutions_mismatched ?? 0) > 0) {
    parts.push(
      `${r.auto_resolutions_mismatched} of ${r.auto_resolutions_checked ?? 0} auto-resolved decision(s) would NOT cleanly ` +
      `pass this account's current policy -- either the record was altered, or the automation itself let something ` +
      `through it shouldn't have.`,
    );
  }
  if ((r.precedent_citations_mismatched ?? 0) > 0) {
    parts.push(
      `${r.precedent_citations_mismatched} of ${r.precedent_citations_checked ?? 0} real-precedent citation(s) don't genuinely ` +
      `support the verdict they're attached to -- either the record was altered, or there's a bug in the real-precedent ` +
      `memory system itself.`,
    );
  }
  if ((r.decision_consistency_mismatched ?? 0) > 0) {
    parts.push(
      `${r.decision_consistency_mismatched} of ${r.decision_consistency_checked ?? 0} decision(s) disagreed with a clear ` +
      `precedent majority for the same kind of request, with no human review to explain the difference -- real, ` +
      `unexplained flip-flopping that's worth a human's attention.`,
    );
  }
  if ((r.knowledge_base_mismatched ?? 0) > 0) {
    parts.push(
      `${r.knowledge_base_mismatched} of ${r.knowledge_base_checked ?? 0} knowledge-base entr(y/ies) are stale (no matching ` +
      `real decision in a long time) or unreachable (an always_block hard rule already shadows their exact scope) -- worth ` +
      `reviewing and cleaning up.`,
    );
  }
  return parts.join(" ");
}
