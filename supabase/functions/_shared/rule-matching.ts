// Pure hard-rule matching — extracted from control-gate.ts so the exact
// same logic that enforces rules in production can also power a rule
// simulator (paste a hypothetical action, see what a draft rule would do)
// without risking the simulator silently drifting from what actually
// enforces.

export type HardRuleLike = {
  action_type_pattern: string;
  provider?: string | null;
};

/** Turns a simple glob ("*" = any run of characters) into an anchored, case-insensitive RegExp. */
export function globToRe(pattern: string): RegExp {
  return new RegExp(
    "^" + pattern.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
}

/** Does this rule apply to an action of this type, from this provider? */
export function ruleMatchesAction(rule: HardRuleLike, actionType: string, provider: string): boolean {
  if (rule.provider && rule.provider.toLowerCase() !== provider.toLowerCase()) return false;
  try {
    return globToRe(rule.action_type_pattern || "*").test(actionType);
  } catch {
    return false;
  }
}

// Per-agent policy scoping (Wave 5, session 1): a rule with agent_id set
// applies only to that one agent; agent_id null is the account-wide
// default. Both kinds of rule can exist for the same account at once, so
// this decides (a) which rules are even in play for a given agent's
// decision, and (b) precedence when more than one rule matches the same
// action -- agent-specific always wins over the account-wide default,
// never merged or averaged.

export type AgentScopedLike = { agent_id?: string | null };

/**
 * Rules visible for a given agent: that agent's own rules plus every
 * account-wide (agent_id null) rule, with agent-specific rules ordered
 * first. Callers that pick "the first matching rule" (as the gate already
 * does) get agent-specific precedence for free just by iterating this
 * output in order -- no separate precedence step needed.
 *
 * `agentId` of null/undefined means "evaluating with no specific agent in
 * context" (e.g. the chat-driven Control System, not an autonomous agent
 * run) -- only account-wide rules apply in that case, since there's no
 * agent to match an agent-scoped rule against.
 */
export function selectRulesForAgent<T extends AgentScopedLike>(rules: T[], agentId: string | null | undefined): T[] {
  const visible = rules.filter((r) => r.agent_id == null || r.agent_id === agentId);
  const agentScoped = visible.filter((r) => r.agent_id != null);
  const accountWide = visible.filter((r) => r.agent_id == null);
  return [...agentScoped, ...accountWide];
}
