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

export function isRedactableMatch(m: { severity: SafetySeverity; category: string }): boolean {
  return m.severity === "block" && REDACTABLE_CATEGORIES.has(m.category);
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
 * - Any block-severity match wins over any require_approval match, same
 *   precedence scanWithRules already applies when computing its own
 *   overall severity.
 * - Among block-severity matches: only when EVERY one of them is
 *   redactable does this become "modify" -- a single non-redactable block
 *   match (destructive wording alongside a leaked API key, say) forces a
 *   hard block, since redacting the key alone wouldn't make the rest of
 *   that response safe to act on.
 * - Only require_approval-severity matches remain -> escalate.
 */
export function decideVerdict(matches: { severity: SafetySeverity; category: string }[]): OuterControlVerdict {
  if (!matches.length) return "allow";
  const blockMatches = matches.filter((m) => m.severity === "block");
  if (blockMatches.length) {
    return blockMatches.every(isRedactableMatch) ? "modify" : "block";
  }
  return "escalate";
}

/**
 * Replaces every span matching a redactable rule with a category-labeled
 * placeholder, globally across the content -- unlike scanWithRules' own
 * per-rule "i"-only regex (built once to find the FIRST hit for reporting),
 * this needs its own "gi" regex per rule to remove every occurrence.
 */
export function redactContent(content: string, rules: { pattern: string; category: string }[]): string {
  let result = content;
  for (const rule of rules) {
    if (!REDACTABLE_CATEGORIES.has(rule.category)) continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "gi");
    } catch {
      continue;
    }
    result = result.replace(re, `[REDACTED:${rule.category}]`);
  }
  return result;
}

export type { SafetyMatch };
