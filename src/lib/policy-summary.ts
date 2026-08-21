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
};

function scopeLabel(pattern: string, provider?: string | null): string {
  const action = pattern === "*" ? "any action" : `actions matching "${pattern}"`;
  return provider ? `${action} on ${provider}` : action;
}

/**
 * Pure — one plain-English sentence per LIVE (enabled, non-shadow) hard
 * rule, split into what's always blocked vs. what always needs approval.
 * Shadow and disabled rules are excluded — they aren't actually enforced,
 * so describing them as "this AI cannot..." would be misleading.
 */
export function summarizeHardRules(rules: HardRuleForSummary[]): { blocked: string[]; needsApproval: string[] } {
  const live = rules.filter((r) => r.enabled !== false && !r.shadow_mode);
  const blocked = live
    .filter((r) => r.effect === "always_block")
    .map((r) => `This AI cannot ${scopeLabel(r.action_type_pattern, r.provider)} — "${r.rule_text}".`);
  const needsApproval = live
    .filter((r) => r.effect === "always_require_approval")
    .map((r) => `This AI needs your approval before it can ${scopeLabel(r.action_type_pattern, r.provider)} — "${r.rule_text}".`);
  return { blocked, needsApproval };
}
