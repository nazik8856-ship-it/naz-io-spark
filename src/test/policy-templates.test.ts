import { describe, it, expect } from "vitest";
import { POLICY_TEMPLATES, getTemplate, resolveTemplateRules } from "@/lib/policy-templates";

describe("policy templates", () => {
  it("has exactly the 3 documented starter playbooks", () => {
    expect(POLICY_TEMPLATES.map((t) => t.id)).toEqual([
      "ecommerce-safe-defaults",
      "customer-support-safe-defaults",
      "conservative-high-scrutiny",
    ]);
  });

  it("every template has at least one rule", () => {
    for (const t of POLICY_TEMPLATES) {
      expect(t.rules.length).toBeGreaterThan(0);
    }
  });

  it("getTemplate finds a template by id", () => {
    expect(getTemplate("ecommerce-safe-defaults")?.name).toBe("E-commerce safe defaults");
  });

  it("getTemplate returns undefined for an unknown id", () => {
    expect(getTemplate("not-a-real-template")).toBeUndefined();
  });

  it("resolveTemplateRules always sets shadow_mode true, regardless of template", () => {
    for (const t of POLICY_TEMPLATES) {
      const resolved = resolveTemplateRules(t);
      expect(resolved.every((r) => r.shadow_mode === true)).toBe(true);
    }
  });

  it("resolveTemplateRules with no agent is account-wide (agent_id null)", () => {
    const resolved = resolveTemplateRules(getTemplate("conservative-high-scrutiny")!);
    expect(resolved.every((r) => r.agent_id === null)).toBe(true);
  });

  it("resolveTemplateRules with an agent scopes every rule to that agent", () => {
    const resolved = resolveTemplateRules(getTemplate("conservative-high-scrutiny")!, "agent-42");
    expect(resolved.every((r) => r.agent_id === "agent-42")).toBe(true);
    expect(resolved.length).toBe(getTemplate("conservative-high-scrutiny")!.rules.length);
  });

  it("resolveTemplateRules preserves rule_text, pattern and effect from the template", () => {
    const template = getTemplate("ecommerce-safe-defaults")!;
    const resolved = resolveTemplateRules(template);
    expect(resolved[0].rule_text).toBe(template.rules[0].rule_text);
    expect(resolved[0].action_type_pattern).toBe(template.rules[0].action_type_pattern);
    expect(resolved[0].effect).toBe(template.rules[0].effect);
  });
});
