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

/** Pure -- collapses case/whitespace so trivial formatting differences on either side of the comparison never matter. */
function normalize(text: string): string {
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

export const RULE_MATCH_TYPES = ["exact_phrase", "contains_phrase"] as const;

/** Pure -- a valid match_type, or the default when omitted entirely (never for an explicitly-sent invalid value -- that's a caller error). */
export function isValidMatchType(matchType: unknown): matchType is ResponseRule["match_type"] {
  return (RULE_MATCH_TYPES as readonly unknown[]).includes(matchType);
}
