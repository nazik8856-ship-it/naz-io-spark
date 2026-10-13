// Pure decision for a piece of external-AI text, after kill switches and hard
// rules (those need the database and live in outer-control-text-review.ts).
// Given the rules that apply and the text, returns the verdict, the text the
// caller may use, exactly what was changed, and what to do next -- no I/O, so
// every branch is unit-tested.
//
// Differences from the previous inline logic in outer-control-text-review.ts:
//  - shadow-mode rules are observed, never enforced (the action path already
//    worked this way; the text path used to enforce them);
//  - a Modify is only returned after the redacted text has been RE-SCANNED
//    clean -- if a rule's pattern could not be applied (unsafe/empty pattern)
//    or the redaction left something behind, the verdict is Block, never an
//    unredacted text labelled "modified";
//  - a secret/PII match together with an approval-level match is Escalate,
//    not Modify (see decideVerdict).
import { scanWithRules, type SafetyMatch, type SafetyRule } from "./safety-scanner.ts";
import {
  computeTrustScore,
  decideVerdict,
  redactWithChanges,
  type OuterControlVerdict,
  type RedactionChange,
} from "./outer-control-scoring.ts";

export type NextStep = "use_output" | "await_approval" | "discard";

export type TextDecision = {
  verdict: OuterControlVerdict;
  /** The text the caller may use: the original (allow), the cleaned text (modify), or null. */
  output: string | null;
  trustScore: number;
  matches: SafetyMatch[];
  /** Shadow-mode rules that matched. Informational only. */
  shadowMatches: SafetyMatch[];
  /** What Modify removed, per rule. Empty for every other verdict. */
  changes: RedactionChange[];
  summary: string;
  nextStep: NextStep;
  /** True when a Modify was attempted but could not be completed safely, so it became a Block. */
  redactionFailed: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeChanges(changes: RedactionChange[]): string {
  return changes.map((c) => `${plural(c.count, "span", "spans")} matching "${c.name}"`).join(", ");
}

export function decideExternalText(rules: SafetyRule[], content: string): TextDecision {
  const live = rules.filter((r) => !r.shadow_mode);
  const shadow = rules.filter((r) => r.shadow_mode);
  const scan = scanWithRules(live, content, "");
  const shadowMatches = shadow.length ? scanWithRules(shadow, content, "").matches : [];
  const trustScore = computeTrustScore(scan.matches);
  const base = { trustScore, matches: scan.matches, shadowMatches };

  const initial = decideVerdict(scan.matches);

  if (initial === "allow") {
    return {
      ...base, verdict: "allow", output: content, changes: [], nextStep: "use_output", redactionFailed: false,
      summary: "No safety-criteria issues found in this external output.",
    };
  }

  if (initial === "block") {
    return {
      ...base, verdict: "block", output: null, changes: [], nextStep: "discard", redactionFailed: false,
      summary: scan.summary ?? "Blocked by the safety scanner.",
    };
  }

  if (initial === "escalate") {
    return {
      ...base, verdict: "escalate", output: null, changes: [], nextStep: "await_approval", redactionFailed: false,
      summary: scan.summary ?? "Needs your approval.",
    };
  }

  // initial === "modify": only ever returned once the cleaned text is verified.
  const { text, changes } = redactWithChanges(content, scan.matches);
  const recheck = scanWithRules(live, text, "");
  if (recheck.matched || changes.length === 0) {
    const names = [...new Set(scan.matches.map((m) => m.name))].join("; ");
    return {
      ...base, verdict: "block", output: null, changes: [], nextStep: "discard", redactionFailed: true,
      summary:
        `Blocked: this response matched ${names} and the matching text could not be removed safely, ` +
        `so nothing was returned. This is a pattern check, not a model judgement.`,
    };
  }
  return {
    ...base, verdict: "modify", output: text, changes, nextStep: "use_output", redactionFailed: false,
    summary:
      `Modified: removed ${describeChanges(changes)}. Everything else is unchanged. ` +
      `The cleaned text was re-checked against the same rules and is clean.`,
  };
}
