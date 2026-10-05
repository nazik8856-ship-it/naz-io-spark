// GAP 3 (Output Modification & Repair Engine): ONE shared primitive that
// turns "this content/action violated a rule" into "here's a corrected
// version, here's how confident we are it's actually clean, here's
// exactly what changed" -- contract: (content, violatedRule) -> { repaired,
// confidence, diff }. Used identically by:
//   - Outer Control's existing correction-suggestion path
//     (outer-control/index.ts's buildSuggestedCorrection)
//   - Generator's pre-save prose scan (compile-agent-manifest/
//     compile-website-manifest's systemPrompt/decisionPolicy redaction)
//   - agent-runtime's retry-with-repair loop (N self-repair attempts on a
//     blocked tool call before escalating to a human)
//
// Two repair STRATEGIES, chosen by what shape the violation is:
//   - free TEXT with an excisable span (secrets/PII) -> repairContent,
//     wrapping outer-control-scoring.ts's existing redactContent/
//     isRedactableMatch rather than reimplementing span redaction.
//   - a structured action's PARAMS, where nothing short of removing the
//     one flagged top-level field would satisfy the rule -> repairParams,
//     wrapping auto-narrow-retry.ts's existing buildSecondNarrowingAttempt.
// A hard-rule violation has nothing analogous to repair (it matches the
// action's action_type/provider shape itself, not a specific field or
// span) -- both strategies correctly return a null, 0-confidence result
// for anything that isn't a safety-scanner match, same as the two
// primitives they wrap already reasoned before this module existed.
import { redactContent, isRedactableMatch } from "./outer-control-scoring.ts";
import { buildSecondNarrowingAttempt } from "./auto-narrow-retry.ts";
import type { SafetyMatch } from "./safety-scanner.ts";

export type RepairDiffEntry = {
  kind: "redacted_span" | "removed_field";
  detail: string;
};

export type RepairResult<T> = {
  /** null when no mechanical repair was possible -- the caller's existing fallback (reject / escalate / block) applies, unchanged. */
  repaired: T | null;
  /** 0-100. A fresh repair is never claimed as proven clean until verifyRepair confirms it against a real re-scan. */
  confidence: number;
  diff: RepairDiffEntry[];
};

/**
 * Repairs free TEXT flagged by the safety scanner: redacts every
 * excisable (secrets/PII-shaped) match span, leaves everything else in
 * the content untouched. A match set with nothing redactable in it (pure
 * destructive-wording / mass-audience / disposable-recipient matches,
 * which describe the whole response's intent rather than one excisable
 * span) correctly produces no repair at all.
 */
export function repairContent(content: string, violatedRule: SafetyMatch[]): RepairResult<string> {
  const redactable = violatedRule.filter((m) => isRedactableMatch(m));
  if (!redactable.length) return { repaired: null, confidence: 0, diff: [] };
  const repaired = redactContent(content, redactable);
  return {
    repaired,
    // Purely mechanical (pattern-matched span removal, not a model guess)
    // and always produces output clean of exactly what was flagged -- not
    // 100, since this says nothing about whether the surrounding prose
    // still reads sensibly once the span is gone.
    confidence: 90,
    diff: redactable.map((m) => ({ kind: "redacted_span" as const, detail: `${m.name} (${m.category})` })),
  };
}

/**
 * Repairs a structured action's PARAMS by removing exactly the top-level
 * field(s) a safety-scanner match flagged. Thin wrapper over
 * auto-narrow-retry.ts's existing buildSecondNarrowingAttempt -- confidence
 * starts at 50 (a real, justified attempt, not a guess) and is only raised
 * once the caller actually re-runs its own gate/scanner and confirms the
 * repaired params pass (verifyRepair below).
 */
export function repairParams(
  params: Record<string, unknown>,
  violatedRule: SafetyMatch[],
): RepairResult<Record<string, unknown>> {
  const repaired = buildSecondNarrowingAttempt(params, { kind: "safety_scanner", matches: violatedRule });
  if (!repaired) return { repaired: null, confidence: 0, diff: [] };
  const removedFields = Object.keys(params).filter((k) => !(k in repaired));
  return {
    repaired,
    confidence: 50,
    diff: removedFields.map((field) => ({ kind: "removed_field" as const, detail: field })),
  };
}

/**
 * Finalizes a repair's confidence once the caller has actually re-run its
 * own gate/scanner against the repaired output -- never claimed up front.
 * A repair that still trips something comes back as a 0-confidence,
 * effectively-failed result (the caller's existing fallback still
 * applies); one that re-scans clean is raised to a high, verified
 * confidence instead of the strategy's own starting estimate.
 */
export function verifyRepair<T>(result: RepairResult<T>, stillViolates: boolean): RepairResult<T> {
  if (result.repaired === null) return result;
  return { ...result, confidence: stillViolates ? 0 : 95 };
}

/** True once a repair has been both produced and confirmed clean by verifyRepair -- the one check every caller needs before actually using `repaired` instead of its original fallback. */
export function isUsableRepair<T>(result: RepairResult<T>): result is RepairResult<T> & { repaired: T } {
  return result.repaired !== null && result.confidence >= 90;
}
