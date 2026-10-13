// Pure verdict/trust-score/redaction logic for the Outer Control System --
// the layer that governs a RESPONSE FROM AN EXTERNAL AI (ChatGPT, Claude,
// a connected CRM bot, etc.), as opposed to control-gate.ts/safety-scanner.ts
// which govern NazAI's OWN generated agents. Both layers share the same
// safety_rules/hard_rules criteria and the same SafetyMatch shape --
// deliberately reusing scanWithRules rather than a parallel scanner, since
// a plain string input already flattens to a single "value" field there.
//
// What's genuinely new here, not present anywhere in Inner Control: a
// block-severity match can be REDACTED rather than only ever hard-blocked.
// Inner Control's own "modify" verdict only ever narrows a structured
// params object (see decision-scoring.ts) -- it has no notion of rewriting
// free text, because NazAI's own agents don't emit free text that needs
// redacting, they emit structured actions. An external AI's raw response
// does, so Outer Control can turn a flawed answer into a still-useful one
// instead of a dead end, per the outer-control spec's "when possible,
// return a cleaned, criteria-aligned version" requirement.
import type { SafetyMatch, SafetySeverity } from "./safety-scanner.ts";

export type OuterControlVerdict = "allow" | "modify" | "block" | "escalate";

// Only a secret/PII match can be cut out of the surrounding text and still
// leave something coherent and useful behind. Destructive wording or a
// disposable-recipient match describes the INTENT of the whole response,
// not one excisable span -- redacting the trigger phrase doesn't make the
// rest of the response safe to act on, so those stay a hard block.
const REDACTABLE_CATEGORIES = new Set(["secrets", "pii"]);

export function isRedactableMatch(m: { severity: SafetySeverity; category: string; redact?: boolean }): boolean {
  // `redact` is a custom rule's own explicit "remove the matched text instead
  // of blocking the whole response" choice; without it only the built-in
  // secrets/pii categories can be cut out.
  return m.severity === "block" && (m.redact === true || REDACTABLE_CATEGORIES.has(m.category));
}

/**
 * Pure -- 100 minus a fixed cost per match, floored at 0. A block-severity
 * match costs more than a require_approval one, same relative weighting
 * as the two verdicts already imply for Inner Control.
 */
export function computeTrustScore(matches: { severity: SafetySeverity }[]): number {
  const score = matches.reduce((s, m) => s - (m.severity === "block" ? 40 : 20), 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Pure -- the outer-control verdict for a set of matches.
 * - No matches -> allow.
 * - Any non-redactable block-severity match -> block (redacting a leaked key
 *   alone wouldn't make a response that also contains destructive wording
 *   safe to act on).
 * - Only redactable block-severity matches -> modify, UNLESS a
 *   require_approval-severity match is also present: that part can't be cut
 *   out, so the whole response needs a human -> escalate. (Before this, the
 *   approval-level match was silently dropped and the response went out as
 *   "modify".)
 * - Only require_approval-severity matches -> escalate.
 */
export function decideVerdict(
  matches: { severity: SafetySeverity; category: string; redact?: boolean }[],
): OuterControlVerdict {
  if (!matches.length) return "allow";
  const blockMatches = matches.filter((m) => m.severity === "block");
  const needsApproval = matches.some((m) => m.severity === "require_approval");
  if (blockMatches.length) {
    if (!blockMatches.every(isRedactableMatch)) return "block";
    return needsApproval ? "escalate" : "modify";
  }
  return "escalate";
}

// AUDIT 3 (Output Modification & Repair Engine, 2026-10-07): a custom
// safety rule's `pattern` is end-user-authored regex (ControlSafetyRules.tsx
// only checks it PARSES -- `new RegExp(pattern)` -- never that it's safe to
// actually run), and it reaches here completely untrusted. Two concrete,
// demonstrated failure modes, both found by actually running adversarial
// patterns through this function, not by inspection:
//
//   1. A pattern that matches the EMPTY string (".*", "\\d*", "a*", or a
//      literal "" -- an easy, non-malicious typo, not just an attack) turns
//      "gi" + .replace into a zero-width match at every single character
//      boundary. A 33-character clean string came back as 645 characters
//      of "[REDACTED:...]" splice between every letter -- not a redaction,
//      a complete corruption of content that had nothing wrong with it.
//   2. A classically catastrophic-backtracking shape ("(a+)+$" and its
//      relatives) hung this function for 15+ seconds on a 35-character
//      input in direct testing -- a trivial, textbook ReDoS payload that
//      `new RegExp(pattern)` happily accepts since it's syntactically
//      valid. Reachable by any account owner through the real custom-
//      safety-rule form, intentionally or by accident.
//
// Both are rejected BEFORE the pattern is ever used for a real replace --
// same "skip this one rule, keep processing the rest" posture the existing
// syntax-error catch below already takes, not a new failure path.
const DANGEROUS_NESTED_QUANTIFIER = /\((?:[^()]*[+*][^()]*)\)[+*]/;

/**
 * True for a pattern this function must never actually run against real
 * content. Builds its OWN throwaway (non-"gi") regex instance for the
 * zero-width check -- deliberately never reuses the caller's stateful
 * global regex, so this check can never leave `lastIndex` in a surprising
 * place for the `.replace()` call that follows.
 */
function isUnsafeRedactionPattern(pattern: string): boolean {
  if (DANGEROUS_NESTED_QUANTIFIER.test(pattern)) return true;
  try {
    if (new RegExp(pattern).test("")) return true; // zero-width match -- would splice into every character boundary
  } catch {
    return true;
  }
  return false;
}

export type RedactionRule = { rule_id?: string; name?: string; pattern: string; category: string; redact?: boolean };
export type RedactionChange = { rule_id: string | null; name: string; category: string; action: "redacted"; count: number };

/**
 * Replaces every span matching a redactable rule with a category-labeled
 * placeholder, globally across the content -- unlike scanWithRules' own
 * per-rule "i"-only regex (built once to find the FIRST hit for reporting),
 * this needs its own "gi" regex per rule to remove every occurrence. Also
 * reports what it actually did (per rule: how many spans), so the caller can
 * tell the user exactly what changed instead of leaving them to diff texts.
 */
export function redactWithChanges(content: string, rules: RedactionRule[]): { text: string; changes: RedactionChange[] } {
  let result = content;
  const changes: RedactionChange[] = [];
  for (const rule of rules) {
    if (!(rule.redact === true || REDACTABLE_CATEGORIES.has(rule.category))) continue;
    if (isUnsafeRedactionPattern(rule.pattern)) continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "gi");
    } catch {
      continue;
    }
    let count = 0;
    result = result.replace(re, () => {
      count++;
      return `[REDACTED:${rule.category}]`;
    });
    if (count > 0) changes.push({ rule_id: rule.rule_id ?? null, name: rule.name ?? rule.category, category: rule.category, action: "redacted", count });
  }
  return { text: result, changes };
}

export function redactContent(content: string, rules: RedactionRule[]): string {
  return redactWithChanges(content, rules).text;
}

export type { SafetyMatch };
