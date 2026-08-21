import { describe, it, expect } from "vitest";
import { findDeadRules } from "@/lib/rule-effectiveness";

const WINDOW_START = "2026-07-01T00:00:00Z";
const OLD_ENOUGH = "2026-06-01T00:00:00Z";
const TOO_NEW = "2026-08-01T00:00:00Z";

describe("findDeadRules", () => {
  it("a live rule with zero recorded hits is dead", () => {
    const dead = findDeadRules(
      [{ id: "r1", rule_text: "no refunds", created_at: OLD_ENOUGH }],
      {},
      WINDOW_START,
    );
    expect(dead.map((r) => r.id)).toEqual(["r1"]);
    expect(dead[0].hits).toBe(0);
  });

  it("a live rule with at least one hit is NOT dead", () => {
    const dead = findDeadRules(
      [{ id: "r1", rule_text: "no refunds", created_at: OLD_ENOUGH }],
      { r1: 3 },
      WINDOW_START,
    );
    expect(dead).toEqual([]);
  });

  it("a disabled rule is never reported (nothing to evaluate)", () => {
    const dead = findDeadRules(
      [{ id: "r1", rule_text: "no refunds", created_at: OLD_ENOUGH, enabled: false }],
      {},
      WINDOW_START,
    );
    expect(dead).toEqual([]);
  });

  it("a shadow-mode rule is never reported (it isn't live yet)", () => {
    const dead = findDeadRules(
      [{ id: "r1", rule_text: "no refunds", created_at: OLD_ENOUGH, shadow_mode: true }],
      {},
      WINDOW_START,
    );
    expect(dead).toEqual([]);
  });

  it("a rule created after the window start hasn't had a fair chance yet, so it's excluded", () => {
    const dead = findDeadRules(
      [{ id: "r1", rule_text: "brand new rule", created_at: TOO_NEW }],
      {},
      WINDOW_START,
    );
    expect(dead).toEqual([]);
  });

  it("mixed batch: only the actually-dead live rules are returned", () => {
    const dead = findDeadRules(
      [
        { id: "live-hit", rule_text: "a", created_at: OLD_ENOUGH },
        { id: "live-dead", rule_text: "b", created_at: OLD_ENOUGH },
        { id: "disabled", rule_text: "c", created_at: OLD_ENOUGH, enabled: false },
        { id: "shadow", rule_text: "d", created_at: OLD_ENOUGH, shadow_mode: true },
        { id: "too-new", rule_text: "e", created_at: TOO_NEW },
      ],
      { "live-hit": 5 },
      WINDOW_START,
    );
    expect(dead.map((r) => r.id)).toEqual(["live-dead"]);
  });

  it("no rules at all is an empty list, not a crash", () => {
    expect(findDeadRules([], {}, WINDOW_START)).toEqual([]);
  });
});
