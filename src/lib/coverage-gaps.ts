// Pure "coverage gaps" finder — which real, connectable action kinds
// currently have ZERO live hard rule matching them at all. A blind-spot
// signal: if something goes wrong with one of these, only the safety
// scanner + anomaly detector + model judgement stand between it and
// running, no explicit rule governs it. Mirrors ruleMatchesAction from
// supabase/functions/_shared/rule-matching.ts — duplicated here rather
// than imported since that file lives outside the Vite frontend's root
// and has no runtime dependency worth a cross-runtime import path for.

// AUDIT 1 (Shared Criteria Library, 2026-10-06): exported, not just module-
// private, so a cross-file parity test (src/test/criteria-library-parity.
// test.ts) can call this exact copy against the canonical one in
// supabase/functions/_shared/rule-matching.ts and fail CI the moment either
// one drifts -- this file's own header comment already documents that drift
// risk; this makes it a caught regression instead of a silent one.
export function globToRe(pattern: string): RegExp {
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

export function ruleCovers(rule: HardRuleForCoverage, kind: string, provider: string): boolean {
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

export type CoverageCellStatus = "covered" | "shadow" | "gap";

/**
 * Pure — the same coverage question as findCoverageGaps, but per-capability
 * and three-valued instead of a single blind-spot list: "covered" (a live,
 * enabled, non-shadow rule matches), "shadow" (a rule matches but it's
 * disabled or in shadow mode -- it's drafted, not actually enforcing yet),
 * or "gap" (nothing matches at all, same as findCoverageGaps). Built for the
 * Control System dashboard's hex-grid visualization (blueprint task #63
 * follow-up) -- one cell per real capability, colored by this status.
 */
export function classifyCoverage(
  capabilities: CapabilityForCoverage[],
  hardRules: HardRuleForCoverage[],
  agentId?: string | null,
): (CapabilityForCoverage & { status: CoverageCellStatus })[] {
  const scopedRules = agentId === undefined
    ? hardRules
    : hardRules.filter((r) => r.agent_id == null || r.agent_id === agentId);
  const liveRules = scopedRules.filter((r) => r.enabled !== false && !r.shadow_mode);
  return capabilities.map((cap) => {
    if (liveRules.some((r) => ruleCovers(r, cap.kind, cap.provider))) return { ...cap, status: "covered" as const };
    if (scopedRules.some((r) => ruleCovers(r, cap.kind, cap.provider))) return { ...cap, status: "shadow" as const };
    return { ...cap, status: "gap" as const };
  });
}
