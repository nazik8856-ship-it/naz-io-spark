// Effective-policy-per-agent view + bulk rule cloning (Wave 5, session 1
// leftovers, closed out 2026-08-21). Mirrors
// supabase/functions/_shared/rule-matching.ts's selectRulesForAgent --
// duplicated here rather than imported since that file lives outside the
// Vite frontend's root (same reasoning as coverage-gaps.ts).

export type AgentScopedLike = { agent_id?: string | null };

// GAP 1 (Shared Criteria Library): mirrors rule-matching.ts's own
// selectRulesForEntity -- a rule can now be scoped to one connected
// external AI (api_key_id) instead of one generated agent (agent_id).
// Kept duplicated here for the same reason the rest of this file is (see
// top-of-file comment): this lives outside the edge-functions root.
export type EntityScopedLike = { agent_id?: string | null; api_key_id?: string | null };
export type EntityKind = "agent" | "api_key";

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
 * account-wide (agent_id null) rule, agent-specific ones ordered first.
 */
export function selectRulesForAgent<T extends AgentScopedLike>(rules: T[], agentId: string | null | undefined): T[] {
  return selectRulesForEntity(rules as (T & EntityScopedLike)[], agentId ? "agent" : null, agentId ?? null);
}

export type CloneableHardRule = {
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider: string | null;
  shadow_mode: boolean;
};

export type CloneableSafetyRule = {
  name: string;
  category: string;
  pattern: string;
  severity: "block" | "require_approval";
  enabled: boolean;
};

/**
 * Pure — turns one agent's own (agent_id-scoped, not account-wide) hard
 * rules into insertable rows for a different target agent. Preserves the
 * source rule's live/shadow state -- a rule that's already vetted enough
 * to be live for the source agent starts live for the clone too, rather
 * than silently downgrading it and losing that signal.
 */
export function cloneHardRulesTo(
  sourceRules: CloneableHardRule[],
  targetUserId: string,
  targetAgentId: string,
): (CloneableHardRule & { user_id: string; agent_id: string })[] {
  return sourceRules.map((r) => ({ ...r, user_id: targetUserId, agent_id: targetAgentId }));
}

/** Pure — same idea as cloneHardRulesTo, for custom safety rules. */
export function cloneSafetyRulesTo(
  sourceRules: CloneableSafetyRule[],
  targetUserId: string,
  targetAgentId: string,
): (CloneableSafetyRule & { user_id: string; agent_id: string })[] {
  return sourceRules.map((r) => ({ ...r, user_id: targetUserId, agent_id: targetAgentId }));
}
