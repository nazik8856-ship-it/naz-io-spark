import { describe, it, expect } from "vitest";
import { buildPolicyBundle, validatePolicyBundle, resolveImportForAccount, POLICY_BUNDLE_VERSION, type PolicyBundle } from "@/lib/policy-bundle";

describe("buildPolicyBundle", () => {
  it("resolves agent_id to agent_name for rules and agent settings", () => {
    const bundle = buildPolicyBundle({
      accountWideStrictness: "balanced",
      accountWideSpendCapUsd: 5,
      accountWideSpendCapEnabled: true,
      agentNamesById: { "agent-1": "Support Bot" },
      agentSettings: [{ agent_id: "agent-1", strictness_override: "strict", spend_cap_usd: 2 }],
      hardRules: [{ rule_text: "no refunds", action_type_pattern: "*refund*", effect: "always_require_approval", provider: null, shadow_mode: false, agent_id: "agent-1" }],
      safetyRules: [],
    });
    expect(bundle.agents[0]).toEqual({ agent_name: "Support Bot", strictness_override: "strict", spend_cap_usd: 2 });
    expect(bundle.hard_rules[0].agent_name).toBe("Support Bot");
  });

  it("account-wide rules (agent_id null) have agent_name null", () => {
    const bundle = buildPolicyBundle({
      accountWideStrictness: "balanced", accountWideSpendCapUsd: 5, accountWideSpendCapEnabled: true,
      agentNamesById: {}, agentSettings: [],
      hardRules: [{ rule_text: "x", action_type_pattern: "*", effect: "always_block", provider: null, shadow_mode: false, agent_id: null }],
      safetyRules: [],
    });
    expect(bundle.hard_rules[0].agent_name).toBeNull();
  });

  it("an agent setting whose agent_id has no matching name is dropped (agent was deleted)", () => {
    const bundle = buildPolicyBundle({
      accountWideStrictness: "balanced", accountWideSpendCapUsd: 5, accountWideSpendCapEnabled: true,
      agentNamesById: {}, agentSettings: [{ agent_id: "ghost", strictness_override: null, spend_cap_usd: null }],
      hardRules: [], safetyRules: [],
    });
    expect(bundle.agents).toEqual([]);
  });

  it("stamps the current bundle version and an exported_at timestamp", () => {
    const bundle = buildPolicyBundle({
      accountWideStrictness: "balanced", accountWideSpendCapUsd: 5, accountWideSpendCapEnabled: true,
      agentNamesById: {}, agentSettings: [], hardRules: [], safetyRules: [],
    });
    expect(bundle.version).toBe(POLICY_BUNDLE_VERSION);
    expect(typeof bundle.exported_at).toBe("string");
  });
});

const validBundle: PolicyBundle = {
  version: POLICY_BUNDLE_VERSION,
  exported_at: "2026-08-21T00:00:00Z",
  account_wide: { strictness: "balanced", spend_cap_usd: 5, spend_cap_enabled: true },
  agents: [{ agent_name: "Support Bot", strictness_override: "strict", spend_cap_usd: 2 }],
  hard_rules: [{ rule_text: "no refunds", action_type_pattern: "*refund*", effect: "always_require_approval", provider: null, shadow_mode: false, agent_name: "Support Bot" }],
  safety_rules: [{ name: "no PII", category: "custom", pattern: "ssn", severity: "block", enabled: true, agent_name: null }],
};

describe("validatePolicyBundle", () => {
  it("a well-formed bundle is valid", () => {
    expect(validatePolicyBundle(validBundle)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a non-object", () => {
    expect(validatePolicyBundle(null).valid).toBe(false);
    expect(validatePolicyBundle("just a string").valid).toBe(false);
  });

  it("rejects an unrecognized version", () => {
    const result = validatePolicyBundle({ ...validBundle, version: 999 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects a hard rule with an invalid effect", () => {
    const result = validatePolicyBundle({ ...validBundle, hard_rules: [{ ...validBundle.hard_rules[0], effect: "always_allow" }] });
    expect(result.valid).toBe(false);
  });

  it("a pattern containing regex metacharacters is treated as a literal, not rejected (same escaping as globToRe elsewhere)", () => {
    const result = validatePolicyBundle({ ...validBundle, hard_rules: [{ ...validBundle.hard_rules[0], action_type_pattern: "[unclosed" }] });
    expect(result.valid).toBe(true);
  });

  it("rejects a safety rule with an invalid severity", () => {
    const result = validatePolicyBundle({ ...validBundle, safety_rules: [{ ...validBundle.safety_rules[0], severity: "warn" }] });
    expect(result.valid).toBe(false);
  });

  it("rejects an agent entry with an invalid strictness_override", () => {
    const result = validatePolicyBundle({ ...validBundle, agents: [{ ...validBundle.agents[0], strictness_override: "extreme" }] });
    expect(result.valid).toBe(false);
  });

  it("an agent with strictness_override null is valid (no override)", () => {
    const result = validatePolicyBundle({ ...validBundle, agents: [{ ...validBundle.agents[0], strictness_override: null }] });
    expect(result.valid).toBe(true);
  });
});

describe("resolveImportForAccount", () => {
  it("resolves a rule's agent_name to the target account's matching agent_id", () => {
    const resolved = resolveImportForAccount(validBundle, "user-2", { "Support Bot": "agent-target" });
    expect(resolved.hardRuleInserts[0].agent_id).toBe("agent-target");
    expect(resolved.warnings).toEqual([]);
  });

  it("falls back to account-wide with a warning when the agent name doesn't exist in the target account", () => {
    const resolved = resolveImportForAccount(validBundle, "user-2", {});
    expect(resolved.hardRuleInserts[0].agent_id).toBeNull();
    expect(resolved.warnings.length).toBe(1);
    expect(resolved.warnings[0]).toContain("Support Bot");
  });

  it("every imported hard rule is shadow_mode true regardless of the source's own state", () => {
    const resolved = resolveImportForAccount(validBundle, "user-2", { "Support Bot": "agent-target" });
    expect(resolved.hardRuleInserts[0].shadow_mode).toBe(true);
  });

  it("every imported safety rule is enabled false regardless of the source's own state", () => {
    const resolved = resolveImportForAccount(validBundle, "user-2", {});
    expect(resolved.safetyRuleInserts[0].enabled).toBe(false);
  });

  it("an account-wide rule (agent_name null) is never a warning", () => {
    const resolved = resolveImportForAccount(validBundle, "user-2", {});
    expect(resolved.safetyRuleInserts[0].agent_id).toBeNull();
    expect(resolved.warnings.some((w) => w.includes("no PII"))).toBe(false);
  });

  it("stamps every insert with the target user_id", () => {
    const resolved = resolveImportForAccount(validBundle, "user-2", { "Support Bot": "agent-target" });
    expect(resolved.hardRuleInserts[0].user_id).toBe("user-2");
    expect(resolved.safetyRuleInserts[0].user_id).toBe("user-2");
  });
});
