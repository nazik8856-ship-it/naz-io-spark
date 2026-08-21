// Starter policy templates (Wave 5, session 2) — a new customer facing an
// empty hard-rules list has to invent every guardrail themselves with no
// guidance. A small static library of starter playbooks fixes that.
//
// Every rule a template creates starts in SHADOW MODE, always — nothing a
// template proposes goes live without the customer reviewing it and
// promoting it themselves, reusing the exact promote flow HardRulesPanel
// already has for manually-authored shadow rules. Templates never touch
// the spend cap or strictness dial directly (those are single account-wide
// settings, not a reviewable list of rows like hard rules) — a template's
// preview mentions a suggested value for those as informational text only.

export type TemplateRuleSpec = {
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider?: string | null;
};

export type PolicyTemplate = {
  id: string;
  name: string;
  description: string;
  suggested_strictness?: "lenient" | "balanced" | "strict";
  suggested_daily_cap_usd?: number;
  rules: TemplateRuleSpec[];
};

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "ecommerce-safe-defaults",
    name: "E-commerce safe defaults",
    description: "Guardrails for a store-facing agent: no unbounded refunds, no bulk price or inventory changes without a human, no mass customer messages.",
    suggested_strictness: "balanced",
    suggested_daily_cap_usd: 10,
    rules: [
      { rule_text: "Refunds or cancellations always require approval", action_type_pattern: "*refund*", effect: "always_require_approval" },
      { rule_text: "Bulk product price changes always require approval", action_type_pattern: "*price*", effect: "always_require_approval" },
      { rule_text: "Inventory/stock updates always require approval", action_type_pattern: "*inventory*", effect: "always_require_approval" },
      { rule_text: "Never send email to more than one recipient", action_type_pattern: "send_email", effect: "always_require_approval" },
    ],
  },
  {
    id: "customer-support-safe-defaults",
    name: "Customer support safe defaults",
    description: "Guardrails for a support-facing agent: replies are fine, but anything that changes money, access, or reaches many customers at once needs a human first.",
    suggested_strictness: "balanced",
    suggested_daily_cap_usd: 5,
    rules: [
      { rule_text: "Refunds or chargebacks always require approval", action_type_pattern: "*refund*", effect: "always_require_approval" },
      { rule_text: "Never message all customers at once", action_type_pattern: "*", effect: "always_require_approval" },
      { rule_text: "Account deletions or deactivations are always blocked", action_type_pattern: "*delete*", effect: "always_block" },
      { rule_text: "Password or access changes always require approval", action_type_pattern: "*password*", effect: "always_require_approval" },
    ],
  },
  {
    id: "conservative-high-scrutiny",
    name: "Conservative / high-scrutiny",
    description: "For an agent you don't fully trust yet, or a high-stakes account: almost everything requires a human, only clearly read-only actions are left alone.",
    suggested_strictness: "strict",
    suggested_daily_cap_usd: 3,
    rules: [
      { rule_text: "Every send/write action requires approval by default", action_type_pattern: "*", effect: "always_require_approval" },
      { rule_text: "Anything destructive is always blocked outright", action_type_pattern: "*delete*", effect: "always_block" },
      { rule_text: "Anything destructive is always blocked outright (drop/wipe wording)", action_type_pattern: "*drop*", effect: "always_block" },
    ],
  },
];

export function getTemplate(templateId: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.id === templateId);
}

export type ResolvedTemplateRule = TemplateRuleSpec & {
  agent_id: string | null;
  shadow_mode: true;
};

/**
 * Pure — resolves a template into the exact rows that would be inserted
 * into hard_rules, scoped to one agent (or account-wide when agentId is
 * null/undefined). Every resolved rule is shadow_mode: true, unconditionally
 * — a template can never create a live rule directly, by design.
 */
export function resolveTemplateRules(template: PolicyTemplate, agentId?: string | null): ResolvedTemplateRule[] {
  return template.rules.map((r) => ({
    ...r,
    agent_id: agentId ?? null,
    shadow_mode: true,
  }));
}
