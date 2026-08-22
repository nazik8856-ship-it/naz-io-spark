// Pure "coverage gaps" finder — which real, connectable action kinds
// currently have ZERO live hard rule matching them at all. A blind-spot
// signal: if something goes wrong with one of these, only the safety
// scanner + anomaly detector + model judgement stand between it and
// running, no explicit rule governs it. Mirrors ruleMatchesAction from
// supabase/functions/_shared/rule-matching.ts — duplicated here rather
// than imported since that file lives outside the Vite frontend's root
// and has no runtime dependency worth a cross-runtime import path for.

function globToRe(pattern: string): RegExp {
  return new RegExp(
    "^" + pattern.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
}

export type HardRuleForCoverage = {
  action_type_pattern: string;
  provider: string | null;
  enabled?: boolean;
  shadow_mode?: boolean;
  agent_id?: string | null;
};

function ruleCovers(rule: HardRuleForCoverage, kind: string, provider: string): boolean {
  if (rule.provider && rule.provider.toLowerCase() !== provider.toLowerCase()) return false;
  try {
    return globToRe(rule.action_type_pattern || "*").test(kind);
  } catch {
    return false;
  }
}

export type CapabilityForCoverage = { kind: string; provider: string };

/** Pure — capabilities with no live (enabled, non-shadow) hard rule matching them.
 *
 * Account-wide gaps can hide an agent-level gap even when the account-wide
 * view looks fully covered: an account-wide rule counts as coverage
 * everywhere, but a rule scoped to a DIFFERENT agent does not cover THIS
 * agent — the account-wide view (agentId omitted) has always pooled every
 * rule together regardless of scope, unchanged here. Pass `agentId` to get
 * the stricter, agent-accurate view instead: only that agent's own rules
 * plus the account-wide default apply, mirroring selectRulesForAgent in
 * supabase/functions/_shared/rule-matching.ts (duplicated here for the
 * same cross-runtime reason as ruleCovers/globToRe above). Pass `null` for
 * "no specific agent" (the chat-driven Control System) — same meaning
 * selectRulesForAgent gives it.
 */
export function findCoverageGaps(
  capabilities: CapabilityForCoverage[],
  hardRules: HardRuleForCoverage[],
  agentId?: string | null,
): CapabilityForCoverage[] {
  const scopedRules = agentId === undefined
    ? hardRules
    : hardRules.filter((r) => r.agent_id == null || r.agent_id === agentId);
  const liveRules = scopedRules.filter((r) => r.enabled !== false && !r.shadow_mode);
  return capabilities.filter((cap) => !liveRules.some((r) => ruleCovers(r, cap.kind, cap.provider)));
}
