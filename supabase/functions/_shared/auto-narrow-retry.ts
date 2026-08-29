// "Policy autonomy" plan, item 8: a smarter second try for the
// "auto_narrow" on_uncertain policy.
//
// Today (control-engine's own auto_narrow block, "zero human review" plan
// item 3) a key on this policy gets exactly one shot: the model's own
// suggested narrower version is re-checked against the deterministic gate
// (hard rules + safety scanner) and, since real precedent memory landed,
// against precedent too. Any failure there falls straight through to the
// existing single-shot fallback (auto-reject, or human_review under a
// different on_uncertain policy) with no attempt to actually use the
// specific reason it failed.
//
// This gives exactly ONE additional, mechanical, deterministic try before
// that same fallback -- never a second model call, never an open-ended
// retry loop. It only has something useful to act on when the FIRST
// attempt's failure was a safety-scanner match on a real, top-level params
// field: the scanner already tells us exactly which field
// (SafetyMatch.matched_on) tripped which pattern, so removing that field
// and re-running the exact same re-check is a real, justified second
// attempt, not a guess.
//
// A hard-rule failure has nothing analogous to remove -- a hard rule
// matches the action's action_type/provider shape itself, not a specific
// params field, so no mechanical edit to params can ever change that
// outcome. A precedent-based rejection is judged on the ACTION's own
// history, not a scanner match on a field, so there's nothing here to act
// on either. Both correctly produce no second attempt, falling straight to
// today's existing fallback -- exactly as honest as saying "there's
// nothing smarter to try here."
import type { SafetyMatch } from "./safety-scanner.ts";
import type { GateOutcome } from "./policy-replay.ts";

export type NarrowingFailureReason =
  | { kind: "hard_rule" }
  | { kind: "precedent" }
  | { kind: "safety_scanner"; matches: SafetyMatch[] };

/**
 * Pure -- builds a stricter second candidate by removing exactly the
 * top-level params field(s) the safety scanner flagged on the first
 * narrowed attempt. Returns null (no second attempt possible) whenever
 * there's nothing concrete to remove: a non-safety-scanner failure, every
 * flagged field being the free-text description rather than a real params
 * field, a flagged field that's nested (dotted path) rather than
 * top-level (removing a nested field correctly needs real path-walking
 * this deliberately small feature doesn't take on), or a flagged field
 * that isn't actually present on this exact params object.
 */
export function buildSecondNarrowingAttempt(
  narrowedParams: Record<string, unknown>,
  reason: NarrowingFailureReason,
): Record<string, unknown> | null {
  if (reason.kind !== "safety_scanner") return null;

  const removableFields = [...new Set(
    reason.matches
      .map((m) => m.matched_on)
      .filter((field) => field !== "description" && !field.includes(".") && Object.prototype.hasOwnProperty.call(narrowedParams, field)),
  )];
  if (!removableFields.length) return null;

  const stricter = { ...narrowedParams };
  for (const field of removableFields) delete stricter[field];
  return stricter;
}

export type SecondAttemptResolution = {
  resolution: "approved" | "rejected";
  note: string;
  removed_fields: string[];
};

/**
 * Pure -- classifies the outcome of re-running the SECOND, stricter
 * candidate through the same deterministic re-check the first attempt
 * used. Mirrors narrowedActionResolution's (api-key-policy.ts) one-
 * directional posture -- a clean pass approves, anything else denies,
 * never a blind allow -- with wording that names this as the second
 * attempt specifically, for an honest audit trail.
 */
export function secondNarrowingResolution(
  gateOutcome: GateOutcome,
  removedFields: string[],
): SecondAttemptResolution {
  const fieldList = removedFields.join(", ");
  if (gateOutcome === "pass_through") {
    return {
      resolution: "approved",
      removed_fields: removedFields,
      note:
        `Resolved automatically to approved: the first narrowed suggestion failed the safety scanner, so a second, stricter attempt removed ${fieldList} ` +
        `and passed the same deterministic checks cleanly — no human reviewed this.`,
    };
  }
  return {
    resolution: "rejected",
    removed_fields: removedFields,
    note:
      `Resolved automatically to rejected: a second, stricter narrowing attempt (after removing ${fieldList}) still failed the deterministic checks ` +
      `(hard rules or safety scanner) — no human reviewed this.`,
  };
}
