// Rule effectiveness for /respond's own response rules -- the mirror of
// rule-effectiveness.ts's findDeadRules, applied to api_key_response_rules
// instead of hard_rules/safety_rules. Item 181 gave these rules
// use_count/last_used_at, but nothing read them for a "never fired" or
// "gone stale" signal until now -- an account owner had to eyeball each
// rule's own usage line one at a time to notice a dead one.
//
// Unlike hard_rules/safety_rules (which have no counter on the rule row
// itself, and derive "hits in the window" from a live COUNT(*) against a
// separate matches table), response rules already carry a lifetime
// use_count and a single last_used_at timestamp directly on the row --
// so there's no windowed "hits in the last 30 days" figure to compute,
// only two derivable signals:
//   - never fired at all (use_count === 0), for a rule old enough that
//     zero hits actually means something, exactly parallel to
//     findDeadRules' own "created before the window" guard; or
//   - fired historically but not within the window (last_used_at is set,
//     but older than windowStart) -- a genuinely different, and arguably
//     more informative, signal than hard_rules/safety_rules can offer,
//     since those never track a last-matched timestamp at all.
export type ResponseRuleForEffectiveness = {
  id: string;
  trigger_phrase: string;
  enabled?: boolean;
  created_at: string;
  use_count: number;
  last_used_at: string | null;
};

export type StaleResponseRuleReason = "never_fired" | "no_recent_matches";

export type StaleResponseRule = ResponseRuleForEffectiveness & { reason: StaleResponseRuleReason };

export const RESPONSE_RULE_STALE_WINDOW_DAYS = 30;

/**
 * Pure -- which enabled response rules, old enough to have had a fair
 * chance, have never fired or haven't fired within the window. A
 * disabled rule is never reported (nothing to evaluate -- it can't be
 * matching anything right now by definition). A rule created more
 * recently than windowStart is excluded, same "hasn't had a fair
 * chance yet" reasoning findDeadRules already applies.
 */
export function findStaleResponseRules(
  rules: ResponseRuleForEffectiveness[],
  windowStart: string,
): StaleResponseRule[] {
  return rules
    .filter((r) => r.enabled !== false)
    .filter((r) => r.created_at <= windowStart)
    .map((r): StaleResponseRule | null => {
      if (r.use_count === 0) return { ...r, reason: "never_fired" };
      if (r.last_used_at && r.last_used_at < windowStart) return { ...r, reason: "no_recent_matches" };
      return null;
    })
    .filter((r): r is StaleResponseRule => r !== null);
}
