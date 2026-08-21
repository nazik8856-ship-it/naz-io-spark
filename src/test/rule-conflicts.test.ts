import { describe, it, expect } from "vitest";
import { findRuleConflicts, type HardRuleForConflict } from "@/lib/rule-conflicts";

const rule = (overrides: Partial<HardRuleForConflict>): HardRuleForConflict => ({
  id: "id",
  rule_text: "text",
  action_type_pattern: "*",
  effect: "always_block",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("findRuleConflicts", () => {
  it("a specific-action rule overlapping a broader wildcard rule with a different effect is a conflict", () => {
    const wide = rule({ id: "wide", action_type_pattern: "slack_*", effect: "always_require_approval", created_at: "2026-01-01T00:00:00Z" });
    const narrow = rule({ id: "narrow", action_type_pattern: "slack_post_message", effect: "always_block", created_at: "2026-01-02T00:00:00Z" });
    const conflicts = findRuleConflicts([wide, narrow]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].winner.id).toBe("wide");
    expect(conflicts[0].shadowed.id).toBe("narrow");
  });

  it("two rules with the same effect are never a conflict, even if they overlap", () => {
    const a = rule({ id: "a", action_type_pattern: "slack_*", effect: "always_block" });
    const b = rule({ id: "b", action_type_pattern: "slack_post_message", effect: "always_block" });
    expect(findRuleConflicts([a, b])).toEqual([]);
  });

  it("two rules scoped to different providers never conflict, even with overlapping patterns", () => {
    const a = rule({ id: "a", action_type_pattern: "*", effect: "always_block", provider: "Slack" });
    const b = rule({ id: "b", action_type_pattern: "*", effect: "always_require_approval", provider: "Gmail" });
    expect(findRuleConflicts([a, b])).toEqual([]);
  });

  it("a disabled rule is never part of a conflict", () => {
    const a = rule({ id: "a", action_type_pattern: "*", effect: "always_block", enabled: false });
    const b = rule({ id: "b", action_type_pattern: "slack_post_message", effect: "always_require_approval" });
    expect(findRuleConflicts([a, b])).toEqual([]);
  });

  it("a shadow-mode rule is never part of a conflict (nothing is enforced yet)", () => {
    const a = rule({ id: "a", action_type_pattern: "*", effect: "always_block", shadow_mode: true });
    const b = rule({ id: "b", action_type_pattern: "slack_post_message", effect: "always_require_approval" });
    expect(findRuleConflicts([a, b])).toEqual([]);
  });

  it("two disjoint literal patterns never conflict", () => {
    const a = rule({ id: "a", action_type_pattern: "slack_post_message", effect: "always_block" });
    const b = rule({ id: "b", action_type_pattern: "send_email", effect: "always_require_approval" });
    expect(findRuleConflicts([a, b])).toEqual([]);
  });

  it("the older rule (by created_at) is always reported as the winner", () => {
    const older = rule({ id: "older", action_type_pattern: "*", effect: "always_block", created_at: "2026-01-01T00:00:00Z" });
    const newer = rule({ id: "newer", action_type_pattern: "send_email", effect: "always_require_approval", created_at: "2026-02-01T00:00:00Z" });
    // Pass them in reverse order -- the function must sort internally, not trust input order.
    const conflicts = findRuleConflicts([newer, older]);
    expect(conflicts[0].winner.id).toBe("older");
    expect(conflicts[0].shadowed.id).toBe("newer");
  });

  it("no rules at all is an empty list, not a crash", () => {
    expect(findRuleConflicts([])).toEqual([]);
  });
});
