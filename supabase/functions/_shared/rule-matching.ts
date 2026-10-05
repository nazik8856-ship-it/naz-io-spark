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

// GAP 1 (Shared Criteria Library): a rule can now ALSO be scoped to one
// connected external AI (api_key_id) instead of one generated agent
// (agent_id) -- the same "this entity's own rules + every account-wide
// rule, entity-specific first" shape, just generalized to either kind of
// governed entity so Inner Control (agents) and Outer Control (api keys)
// read from one shared selection function instead of two copies that could
// drift. selectRulesForAgent below is now a thin, behavior-preserving
// wrapper over this for every one of its existing callers.
export type EntityScopedLike = { agent_id?: string | null; api_key_id?: string | null };
export type EntityKind = "agent" | "api_key";

/**
 * Rules visible for a given entity (an agent OR an api key): that entity's
 * own rules plus every account-wide rule (both agent_id and api_key_id
 * null), with entity-specific rules ordered first. A rule scoped to the
 * OTHER entity kind is never visible here, even when its own scoping
 * column happens to be null for this entity's column -- e.g. an
 * api_key-scoped rule never shows up when resolving for an agent.
 *
 * `entityKind`/`entityId` of null means "evaluating with no specific agent
 * or api key in context" (e.g. the chat-driven Control System) -- only
 * account-wide rules apply.
 */
export function selectRulesForEntity<T extends EntityScopedLike>(
  rules: T[],
  entityKind: EntityKind | null | undefined,
  entityId: string | null | undefined,
): T[] {
  const scopeKey: "agent_id" | "api_key_id" = entityKind === "api_key" ? "api_key_id" : "agent_id";
  const otherKey: "agent_id" | "api_key_id" = entityKind === "api_key" ? "agent_id" : "api_key_id";
  const visible = rules.filter((r) => {
    if (r[otherKey] != null) return false;
    return r[scopeKey] == null || r[scopeKey] === entityId;
  });
  const entityScoped = visible.filter((r) => r[scopeKey] != null);
  const accountWide = visible.filter((r) => r[scopeKey] == null);
  return [...entityScoped, ...accountWide];
}

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
  return selectRulesForEntity(rules as (T & EntityScopedLike)[], agentId ? "agent" : null, agentId ?? null);
}
