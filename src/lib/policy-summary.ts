// Plain-English policy summary (Wave 5, session 2) — once a customer has
// accumulated several hard rules, a generated readable summary is far more
// useful to a non-technical stakeholder than a raw list of rule_text rows.
// Pure text generation only — no enforcement logic lives here, so it can
// never drift into being trusted as anything other than a human-readable
// restatement of the real, enforced rules.

export type HardRuleForSummary = {
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider?: string | null;
  enabled?: boolean;
  shadow_mode?: boolean;
  agent_id?: string | null;
};

function scopeLabel(pattern: string, provider?: string | null): string {
  const action = pattern === "*" ? "any action" : `actions matching "${pattern}"`;
  return provider ? `${action} on ${provider}` : action;
}

// hard_rules is per-agent-scoped (control-gate.ts) -- a rule with agent_id
// set only ever applies to that one agent, never every agent on the
// account. Restating it as a blanket "This AI cannot..." misrepresents an
// agent-specific rule as account-wide. `agentName` is optional so this
// still works where a name lookup isn't available; falling back to the
// raw id keeps the sentence at least scope-honest rather than silently
// dropping the distinction.
function subject(agentId: string | null | undefined, agentName?: (id: string) => string): string {
  if (!agentId) return "This AI";
  return `This AI, when acting as ${agentName ? agentName(agentId) : agentId}`;
}

/**
 * Pure — one plain-English sentence per LIVE (enabled, non-shadow) hard
 * rule, split into what's always blocked vs. what always needs approval.
 * Shadow and disabled rules are excluded — they aren't actually enforced,
 * so describing them as "this AI cannot..." would be misleading.
 */
export function summarizeHardRules(
  rules: HardRuleForSummary[],
  agentName?: (id: string) => string,
): { blocked: string[]; needsApproval: string[] } {
  const live = rules.filter((r) => r.enabled !== false && !r.shadow_mode);
  const blocked = live
    .filter((r) => r.effect === "always_block")
    .map((r) => `${subject(r.agent_id, agentName)} cannot ${scopeLabel(r.action_type_pattern, r.provider)} — "${r.rule_text}".`);
  const needsApproval = live
    .filter((r) => r.effect === "always_require_approval")
    .map((r) => `${subject(r.agent_id, agentName)} needs your approval before it can ${scopeLabel(r.action_type_pattern, r.provider)} — "${r.rule_text}".`);
  return { blocked, needsApproval };
}
