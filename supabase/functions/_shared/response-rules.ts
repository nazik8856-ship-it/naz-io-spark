// "Own decision-making machine" plan, item 177 (Phase 2): the rule tier
// of /respond's two-tier pipeline -- checked BEFORE embedding retrieval
// (response-context.ts/response-synthesis.ts), for the questions an
// account owner wants answered with a guaranteed, verbatim,
// non-negotiable answer rather than whatever a similarity search
// happens to surface. Pure, synchronous, and free -- no embedding call
// needed to check a rule, so a matched rule short-circuits the entire
// retrieval path (see control-api/index.ts's own call site).
export type ResponseRule = {
  id: string;
  trigger_phrase: string;
  match_type: "exact_phrase" | "contains_phrase";
  answer_text: string;
};

/** Pure -- collapses case/whitespace so trivial formatting differences on either side of the comparison never matter. Exported for rule-context-overlap.ts's own use -- same normalization, not a second copy of it. */
export function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Pure -- the FIRST rule (in the order given, expected oldest-first --
 * see the caller's own ORDER BY) whose trigger matches this message.
 * 'exact_phrase' requires the entire normalized message to equal the
 * trigger; 'contains_phrase' only requires the trigger to appear
 * anywhere in it. Returns null when nothing matches, exactly like
 * findRelevantContext's own "no match is a normal outcome" contract --
 * the caller falls through to retrieval, never treats this as an error.
 */
export function findMatchingRule(rules: ResponseRule[], message: string): ResponseRule | null {
  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return null;
  for (const rule of rules) {
    const trigger = normalize(rule.trigger_phrase);
    if (!trigger) continue;
    const isMatch = rule.match_type === "exact_phrase" ? normalizedMessage === trigger : normalizedMessage.includes(trigger);
    if (isMatch) return rule;
  }
  return null;
}

/** Pure -- a valid trigger_phrase: non-empty, within the column's own CHECK-constraint length. */
export function isValidTriggerPhrase(phrase: unknown): phrase is string {
  return typeof phrase === "string" && phrase.trim().length > 0 && phrase.length <= 500;
}

/** Pure -- a valid answer_text: non-empty, within the column's own CHECK-constraint length. */
export function isValidRuleAnswer(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0 && text.length <= 2000;
}

// control-api/index.ts's /respond handler fetches EVERY enabled rule for
// a key on every single call (there's no ranking to cut off early the
// way findRelevantContext's similarity floor lets it stop at the top
// few matches -- any rule could be the one that matches, so all of them
// must be checked). A cap on the read side would silently stop checking
// rule #201+ with no error, which is worse than an unbounded read; this
// caps rule CREATION instead, so every rule an account owner actually
// configured is always guaranteed to be checked. Generous for a curated
// set of guaranteed-answer triggers -- an account that genuinely needs
// more than this almost certainly wants context entries (similarity-
// ranked, no per-message scan) for most of them instead.
export const MAX_RESPONSE_RULES_PER_KEY = 200;

export const RULE_MATCH_TYPES = ["exact_phrase", "contains_phrase"] as const;

/** Pure -- a valid match_type, or the default when omitted entirely (never for an explicitly-sent invalid value -- that's a caller error). */
export function isValidMatchType(matchType: unknown): matchType is ResponseRule["match_type"] {
  return (RULE_MATCH_TYPES as readonly unknown[]).includes(matchType);
}
