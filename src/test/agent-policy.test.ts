import { describe, it, expect } from "vitest";
import { selectRulesForAgent, cloneHardRulesTo, cloneSafetyRulesTo } from "@/lib/agent-policy";

describe("selectRulesForAgent", () => {
  it("account-wide rules apply to every agent", () => {
    const rules = [{ id: "r1", agent_id: null }];
    expect(selectRulesForAgent(rules, "agent-1")).toEqual(rules);
  });

  it("an agent-scoped rule for a DIFFERENT agent is excluded", () => {
    const rules = [{ id: "r1", agent_id: "agent-2" }];
    expect(selectRulesForAgent(rules, "agent-1")).toEqual([]);
  });

  it("agent-specific rules are ordered before account-wide ones", () => {
    const accountWide = { id: "account", agent_id: null };
    const agentSpecific = { id: "agent", agent_id: "agent-1" };
    expect(selectRulesForAgent([accountWide, agentSpecific], "agent-1")).toEqual([agentSpecific, accountWide]);
  });

  it("no agentId (account-wide context) only sees account-wide rules", () => {
    const rules = [{ id: "r1", agent_id: null }, { id: "r2", agent_id: "agent-1" }];
    expect(selectRulesForAgent(rules, null)).toEqual([rules[0]]);
  });
});

describe("cloneHardRulesTo", () => {
  const source = [
    { rule_text: "no refunds", action_type_pattern: "*refund*", effect: "always_require_approval" as const, provider: null, shadow_mode: false },
  ];

  it("retargets user_id and agent_id to the destination", () => {
    const cloned = cloneHardRulesTo(source, "user-2", "agent-target");
    expect(cloned[0].user_id).toBe("user-2");
    expect(cloned[0].agent_id).toBe("agent-target");
  });

  it("preserves the rule's content and live/shadow state", () => {
    const cloned = cloneHardRulesTo(source, "user-2", "agent-target");
    expect(cloned[0].rule_text).toBe("no refunds");
    expect(cloned[0].effect).toBe("always_require_approval");
    expect(cloned[0].shadow_mode).toBe(false);
  });

  it("no source rules clones to an empty list, not a crash", () => {
    expect(cloneHardRulesTo([], "user-2", "agent-target")).toEqual([]);
  });
});

describe("cloneSafetyRulesTo", () => {
  it("retargets user_id and agent_id, preserving content", () => {
    const source = [{ name: "no PII", category: "custom", pattern: "ssn", severity: "block" as const, enabled: true }];
    const cloned = cloneSafetyRulesTo(source, "user-2", "agent-target");
    expect(cloned[0]).toEqual({ ...source[0], user_id: "user-2", agent_id: "agent-target" });
  });
});
