import { describe, it, expect } from "vitest";
import { summarizeHardRules } from "@/lib/policy-summary";

describe("summarizeHardRules", () => {
  it("an always_block rule appears in the blocked list", () => {
    const { blocked, needsApproval } = summarizeHardRules([
      { rule_text: "no bulk deletes", action_type_pattern: "*delete*", effect: "always_block" },
    ]);
    expect(blocked.length).toBe(1);
    expect(blocked[0]).toContain("cannot");
    expect(blocked[0]).toContain("no bulk deletes");
    expect(needsApproval).toEqual([]);
  });

  it("an always_require_approval rule appears in the needsApproval list", () => {
    const { blocked, needsApproval } = summarizeHardRules([
      { rule_text: "refunds need a human", action_type_pattern: "*refund*", effect: "always_require_approval" },
    ]);
    expect(needsApproval.length).toBe(1);
    expect(needsApproval[0]).toContain("approval");
    expect(blocked).toEqual([]);
  });

  it("a shadow-mode rule is excluded entirely (not actually enforced)", () => {
    const { blocked, needsApproval } = summarizeHardRules([
      { rule_text: "draft rule", action_type_pattern: "*", effect: "always_block", shadow_mode: true },
    ]);
    expect(blocked).toEqual([]);
    expect(needsApproval).toEqual([]);
  });

  it("a disabled rule is excluded entirely", () => {
    const { blocked } = summarizeHardRules([
      { rule_text: "old rule", action_type_pattern: "*", effect: "always_block", enabled: false },
    ]);
    expect(blocked).toEqual([]);
  });

  it("mentions the provider when the rule is provider-scoped", () => {
    const { blocked } = summarizeHardRules([
      { rule_text: "no posting", action_type_pattern: "*", effect: "always_block", provider: "Slack" },
    ]);
    expect(blocked[0]).toContain("Slack");
  });

  it("a '*' pattern reads as 'any action', not a literal asterisk", () => {
    const { blocked } = summarizeHardRules([
      { rule_text: "lock it down", action_type_pattern: "*", effect: "always_block" },
    ]);
    expect(blocked[0]).toContain("any action");
    expect(blocked[0]).not.toContain("*\"");
  });

  it("no rules at all returns empty lists, not a crash", () => {
    expect(summarizeHardRules([])).toEqual({ blocked: [], needsApproval: [] });
  });
});
