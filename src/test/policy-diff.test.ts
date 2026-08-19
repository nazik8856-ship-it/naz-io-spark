import { describe, it, expect } from "vitest";
import { diffPolicySnapshots } from "@/lib/policy-diff";

const rule = (over: Partial<{ id: string; rule_text: string; action_type_pattern: string; effect: string; provider: string | null; enabled: boolean }> = {}) => ({
  id: "r1", rule_text: "block it", action_type_pattern: "*", effect: "always_block", provider: null, enabled: true, ...over,
});

describe("diffPolicySnapshots", () => {
  it("two identical snapshots have no changes", () => {
    const snap = { hard_rules: [rule()], spend_cap: { daily_cap_usd: 5, enabled: true } };
    const diff = diffPolicySnapshots(snap, snap);
    expect(diff.hasChanges).toBe(false);
  });

  it("a hard rule present only in 'after' is added", () => {
    const before = { hard_rules: [] };
    const after = { hard_rules: [rule()] };
    const diff = diffPolicySnapshots(before, after);
    expect(diff.hardRules.added).toEqual([rule()]);
    expect(diff.hardRules.removed).toEqual([]);
    expect(diff.hardRules.changed).toEqual([]);
    expect(diff.hasChanges).toBe(true);
  });

  it("a hard rule present only in 'before' is removed", () => {
    const before = { hard_rules: [rule()] };
    const after = { hard_rules: [] };
    const diff = diffPolicySnapshots(before, after);
    expect(diff.hardRules.removed).toEqual([rule()]);
    expect(diff.hardRules.added).toEqual([]);
  });

  it("the same id with different fields is a change, not add+remove", () => {
    const before = { hard_rules: [rule({ effect: "always_require_approval" })] };
    const after = { hard_rules: [rule({ effect: "always_block" })] };
    const diff = diffPolicySnapshots(before, after);
    expect(diff.hardRules.added).toEqual([]);
    expect(diff.hardRules.removed).toEqual([]);
    expect(diff.hardRules.changed).toHaveLength(1);
    expect(diff.hardRules.changed[0].before.effect).toBe("always_require_approval");
    expect(diff.hardRules.changed[0].after.effect).toBe("always_block");
  });

  it("the same id with identical fields is not reported as changed", () => {
    const before = { hard_rules: [rule()] };
    const after = { hard_rules: [rule()] };
    const diff = diffPolicySnapshots(before, after);
    expect(diff.hardRules.changed).toEqual([]);
  });

  it("thresholds are keyed by agent_id, not id", () => {
    const before = { thresholds: [{ agent_id: "a1", confidence_threshold: 60 }] };
    const after = { thresholds: [{ agent_id: "a1", confidence_threshold: 80 }] };
    const diff = diffPolicySnapshots(before, after);
    expect(diff.thresholds.changed).toHaveLength(1);
  });

  it("spend cap changes are detected at the object level", () => {
    const before = { spend_cap: { daily_cap_usd: 5, enabled: true } };
    const after = { spend_cap: { daily_cap_usd: 10, enabled: true } };
    const diff = diffPolicySnapshots(before, after);
    expect(diff.spendCapChanged).toBe(true);
    expect(diff.hasChanges).toBe(true);
  });

  it("missing sections default to empty arrays, no crash", () => {
    const diff = diffPolicySnapshots({}, {});
    expect(diff.hasChanges).toBe(false);
    expect(diff.hardRules.added).toEqual([]);
  });

  it("a snapshot missing spend_cap entirely vs. one that has it counts as a change", () => {
    const diff = diffPolicySnapshots({}, { spend_cap: { daily_cap_usd: 5, enabled: true } });
    expect(diff.spendCapChanged).toBe(true);
  });
});
