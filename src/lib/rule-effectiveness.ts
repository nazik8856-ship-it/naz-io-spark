// Rule effectiveness / dead-rule finder (Wave 5, session 2) — the mirror of
// coverage-gaps.ts (which finds action kinds with NO rule at all). This
// answers "which of my LIVE rules have fired zero times in the last N
// days" — a rule that's never matched anything is either redundant or,
// worse, was meant to catch something and silently isn't working.
//
// Relies on agent_decisions.hard_rule_id (added this session) recording
// which rule actually enforced each hard-rule decision — real linkage,
// not a guess parsed out of free text.

export type HardRuleForEffectiveness = {
  id: string;
  rule_text: string;
  enabled?: boolean;
  shadow_mode?: boolean;
  created_at: string;
};

export type DeadRule = HardRuleForEffectiveness & { hits: number };

/**
 * Pure — which live (enabled, non-shadow) rules have zero recorded hits
 * over the window. `hitCounts` maps rule id -> number of agent_decisions
 * with that hard_rule_id within the window; a rule missing from the map is
 * treated as zero hits. A rule created more recently than the window start
 * is excluded — it hasn't had a fair chance to fire yet, so "zero hits" for
 * it isn't a meaningful signal.
 */
export function findDeadRules(
  rules: HardRuleForEffectiveness[],
  hitCounts: Record<string, number>,
  windowStart: string,
): DeadRule[] {
  return rules
    .filter((r) => r.enabled !== false && !r.shadow_mode)
    .filter((r) => r.created_at <= windowStart)
    .map((r) => ({ ...r, hits: hitCounts[r.id] ?? 0 }))
    .filter((r) => r.hits === 0);
}
