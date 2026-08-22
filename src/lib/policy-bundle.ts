// Policy-as-code export/import (Wave 5 follow-up) -- a portable,
// versioned bundle of an account's entire policy (hard rules, safety
// rules, spend cap, strictness, per-agent overrides), downloadable and
// re-importable. Enables backup outside the platform, staging->prod
// promotion, and keeping policy in the customer's own git repo -- the
// same idea as Terraform state or an OPA bundle.
//
// Agents are referenced by NAME, not raw id, since agent ids are
// account-specific UUIDs that mean nothing across accounts (importing
// into a different account than the one exported from is a real,
// intended use case, not an edge case).

export const POLICY_BUNDLE_VERSION = 1;

export type BundleHardRule = {
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider: string | null;
  shadow_mode: boolean;
  agent_name: string | null; // null = account-wide
};

export type BundleSafetyRule = {
  name: string;
  category: string;
  pattern: string;
  severity: "block" | "require_approval";
  enabled: boolean;
  shadow_mode: boolean;
  agent_name: string | null;
};

export type BundleAgentSetting = {
  agent_name: string;
  strictness_override: "loose" | "balanced" | "strict" | null;
  spend_cap_usd: number | null;
};

// Circuit breaker sensitivity (BREAKER_WINDOW / BREAKER_MIN_ATTEMPTS /
// BREAKER_FAIL_RATE in supabase/functions/_shared/control-gate.ts) is a
// fixed constant today, not a stored, configurable setting -- unlike
// every other control knob in this bundle (spend cap, strictness), there
// is no per-agent (or even per-account) THRESHOLD to capture, only
// per-agent breaker STATE (tripped/not, recent outcomes), which a bundle
// must never carry over anyway (the "imports land inert" rule below).
// Duplicated here (not imported -- same cross-runtime reason as
// coverage-gaps.ts) purely as read-only documentation of what governed
// the account at export time, matching how account-wide strictness/spend
// cap are captured for completeness without being blindly re-applied on
// import.
export const BREAKER_DEFAULTS = { window: 10, min_attempts: 4, fail_rate: 0.5 } as const;

export type PolicyBundle = {
  version: number;
  exported_at: string;
  account_wide: {
    strictness: string;
    spend_cap_usd: number;
    spend_cap_enabled: boolean;
    circuit_breaker_defaults?: { window: number; min_attempts: number; fail_rate: number };
  };
  agents: BundleAgentSetting[];
  hard_rules: BundleHardRule[];
  safety_rules: BundleSafetyRule[];
};

export type SourceHardRule = { rule_text: string; action_type_pattern: string; effect: "always_block" | "always_require_approval"; provider: string | null; shadow_mode: boolean; agent_id: string | null };
export type SourceSafetyRule = { name: string; category: string; pattern: string; severity: "block" | "require_approval"; enabled: boolean; shadow_mode: boolean; agent_id: string | null };
export type SourceAgentSetting = { agent_id: string; strictness_override: string | null; spend_cap_usd: number | null };

/** Pure — builds a portable bundle from already-fetched account data. */
export function buildPolicyBundle(input: {
  accountWideStrictness: string;
  accountWideSpendCapUsd: number;
  accountWideSpendCapEnabled: boolean;
  agentNamesById: Record<string, string>;
  agentSettings: SourceAgentSetting[];
  hardRules: SourceHardRule[];
  safetyRules: SourceSafetyRule[];
}): PolicyBundle {
  const nameFor = (id: string | null) => (id ? input.agentNamesById[id] ?? null : null);
  return {
    version: POLICY_BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    account_wide: {
      strictness: input.accountWideStrictness,
      spend_cap_usd: input.accountWideSpendCapUsd,
      spend_cap_enabled: input.accountWideSpendCapEnabled,
      circuit_breaker_defaults: { ...BREAKER_DEFAULTS },
    },
    agents: input.agentSettings
      .filter((a) => nameFor(a.agent_id))
      .map((a) => ({
        agent_name: nameFor(a.agent_id)!,
        strictness_override: (a.strictness_override as BundleAgentSetting["strictness_override"]) ?? null,
        spend_cap_usd: a.spend_cap_usd,
      })),
    hard_rules: input.hardRules.map((r) => ({ ...r, agent_name: nameFor(r.agent_id) })),
    safety_rules: input.safetyRules.map((r) => ({ ...r, agent_name: nameFor(r.agent_id) })),
  };
}

export type BundleValidation = { valid: boolean; errors: string[] };

const EFFECTS = new Set(["always_block", "always_require_approval"]);
const SEVERITIES = new Set(["block", "require_approval"]);
const STRICTNESS_VALUES = new Set(["loose", "balanced", "strict"]);

function patternCompiles(pattern: string): boolean {
  try {
    new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return true;
  } catch {
    return false;
  }
}

/** Pure — structural validation before anything is ever inserted. */
export function validatePolicyBundle(input: unknown): BundleValidation {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) return { valid: false, errors: ["Not a JSON object."] };
  const b = input as Partial<PolicyBundle>;

  if (b.version !== POLICY_BUNDLE_VERSION) errors.push(`Unrecognized bundle version: ${String(b.version)} (expected ${POLICY_BUNDLE_VERSION}).`);
  if (!Array.isArray(b.hard_rules)) errors.push("Missing or invalid hard_rules array.");
  if (!Array.isArray(b.safety_rules)) errors.push("Missing or invalid safety_rules array.");
  if (!Array.isArray(b.agents)) errors.push("Missing or invalid agents array.");

  (b.hard_rules ?? []).forEach((r, i) => {
    if (!r?.rule_text || typeof r.rule_text !== "string") errors.push(`hard_rules[${i}]: missing rule_text.`);
    if (!r?.action_type_pattern || typeof r.action_type_pattern !== "string") errors.push(`hard_rules[${i}]: missing action_type_pattern.`);
    else if (!patternCompiles(r.action_type_pattern)) errors.push(`hard_rules[${i}]: action_type_pattern doesn't compile.`);
    if (!EFFECTS.has(r?.effect as string)) errors.push(`hard_rules[${i}]: invalid effect "${String(r?.effect)}".`);
  });

  (b.safety_rules ?? []).forEach((r, i) => {
    if (!r?.name || typeof r.name !== "string") errors.push(`safety_rules[${i}]: missing name.`);
    if (!r?.pattern || typeof r.pattern !== "string") errors.push(`safety_rules[${i}]: missing pattern.`);
    else if (!patternCompiles(r.pattern)) errors.push(`safety_rules[${i}]: pattern doesn't compile.`);
    if (!SEVERITIES.has(r?.severity as string)) errors.push(`safety_rules[${i}]: invalid severity "${String(r?.severity)}".`);
  });

  (b.agents ?? []).forEach((a, i) => {
    if (!a?.agent_name || typeof a.agent_name !== "string") errors.push(`agents[${i}]: missing agent_name.`);
    if (a?.strictness_override != null && !STRICTNESS_VALUES.has(a.strictness_override as string)) {
      errors.push(`agents[${i}]: invalid strictness_override "${String(a.strictness_override)}".`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export type ResolvedImport = {
  hardRuleInserts: Record<string, unknown>[];
  safetyRuleInserts: Record<string, unknown>[];
  warnings: string[];
};

/**
 * Pure — resolves a validated bundle against the TARGET account's own
 * agents (matched by name). A rule scoped to an agent name that doesn't
 * exist in the target account falls back to account-wide, with a
 * warning -- never silently dropped, never left dangling on a
 * nonexistent agent_id. Every imported rule lands inert (shadow_mode:
 * true, for both hard rules and safety rules -- safety rules got real
 * shadow-mode support on 2026-08-22, closing the enabled:false-as-a-
 * shadow-mode-workaround this function used before that) regardless of
 * the source's own live/shadow state -- nothing a bundle imports goes
 * live without the customer reviewing it, the same safety principle
 * policy templates already use.
 *
 * account_wide and agents (strictness, spend cap, circuit breaker
 * defaults) are captured in the bundle for backup/documentation/
 * cross-account comparison but deliberately NOT applied here -- same as
 * before circuit_breaker_defaults existed: only hard_rules/safety_rules
 * ever get inserted on import, so importing someone else's bundle can
 * never silently overwrite this account's own strictness or spend cap.
 */
export function resolveImportForAccount(
  bundle: PolicyBundle,
  targetUserId: string,
  targetAgentIdsByName: Record<string, string>,
): ResolvedImport {
  const warnings: string[] = [];
  const resolveAgentId = (name: string | null, ruleLabel: string): string | null => {
    if (!name) return null;
    const id = targetAgentIdsByName[name];
    if (!id) {
      warnings.push(`${ruleLabel}: no agent named "${name}" in this account — imported as account-wide instead.`);
      return null;
    }
    return id;
  };

  const hardRuleInserts = bundle.hard_rules.map((r) => ({
    user_id: targetUserId,
    rule_text: r.rule_text,
    action_type_pattern: r.action_type_pattern,
    effect: r.effect,
    provider: r.provider,
    shadow_mode: true, // always -- see doc comment above
    agent_id: resolveAgentId(r.agent_name, `Hard rule "${r.rule_text}"`),
  }));

  const safetyRuleInserts = bundle.safety_rules.map((r) => ({
    user_id: targetUserId,
    name: r.name,
    category: r.category,
    pattern: r.pattern,
    severity: r.severity,
    shadow_mode: true, // always -- see doc comment above (enabled defaults to true, same as hard_rules -- shadow_mode is what keeps it inert)
    agent_id: resolveAgentId(r.agent_name, `Safety rule "${r.name}"`),
  }));

  return { hardRuleInserts, safetyRuleInserts, warnings };
}
