// Pure classification for the weekly audit-integrity sweep — extracted out
// of the edge function's DB-coupled orchestration so it's directly unit
// testable, same reasoning as self-audit-diff.ts for control-self-audit.
import { CONTRADICTORY_LOWER_BOUND, NON_ALLOW_SHARE_OVERRIDE_THRESHOLD } from "./precedent-advice.ts";

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

export type AuditIntegrityResult = SignatureVerifyResult & AutoResolutionAuditFields & PrecedentCitationAuditFields;

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
 * A sweep is a failure worth alerting on if ANY signature didn't match
 * what was actually signed at creation (the audit trail may have been
 * altered), any decision in range has no signature at all (the signing
 * trigger should fire on every insert -- an unsigned row in a recent
 * window means it silently didn't), OR any auto-resolved decision no
 * longer cleanly passes the account's current policy.
 */
export function isAuditIntegrityFailure(r: AuditIntegrityResult): boolean {
  return r.mismatched_count > 0 || r.unsigned > 0 || (r.auto_resolutions_mismatched ?? 0) > 0 ||
    (r.precedent_citations_mismatched ?? 0) > 0;
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
  return parts.join(" ");
}
