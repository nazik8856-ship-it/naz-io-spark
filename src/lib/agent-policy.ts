// Effective-policy-per-agent view + bulk rule cloning (Wave 5, session 1
// leftovers, closed out 2026-08-21). Mirrors
// supabase/functions/_shared/rule-matching.ts's selectRulesForAgent --
// duplicated here rather than imported since that file lives outside the
// Vite frontend's root (same reasoning as coverage-gaps.ts).

export type AgentScopedLike = { agent_id?: string | null };

/**
 * Rules visible for a given agent: that agent's own rules plus every
 * account-wide (agent_id null) rule, agent-specific ones ordered first.
 */
export function selectRulesForAgent<T extends AgentScopedLike>(rules: T[], agentId: string | null | undefined): T[] {
  const visible = rules.filter((r) => r.agent_id == null || r.agent_id === agentId);
  const agentScoped = visible.filter((r) => r.agent_id != null);
  const accountWide = visible.filter((r) => r.agent_id == null);
  return [...agentScoped, ...accountWide];
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
