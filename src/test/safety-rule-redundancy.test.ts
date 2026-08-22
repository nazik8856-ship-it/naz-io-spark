import { describe, it, expect } from "vitest";
import { findSafetyRuleRedundancies, type SafetyRuleForRedundancy } from "@/lib/safety-rule-redundancy";

const rule = (overrides: Partial<SafetyRuleForRedundancy>): SafetyRuleForRedundancy => ({
  id: "id",
  name: "name",
  category: "custom",
  pattern: "wire transfer",
  severity: "require_approval",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("findSafetyRuleRedundancies", () => {
  it("an exact-duplicate pattern with different severities is a redundancy", () => {
    const a = rule({ id: "a", pattern: "wire transfer", severity: "require_approval", created_at: "2026-01-01T00:00:00Z" });
    const b = rule({ id: "b", pattern: "wire transfer", severity: "block", created_at: "2026-01-02T00:00:00Z" });
    const redundancies = findSafetyRuleRedundancies([a, b]);
    expect(redundancies.length).toBe(1);
    expect(redundancies[0].older.id).toBe("a");
    expect(redundancies[0].newer.id).toBe("b");
  });

  it("a near-duplicate pattern (whitespace/case only) with different severities is a redundancy", () => {
    const a = rule({ id: "a", pattern: "  Wire Transfer  ", severity: "require_approval" });
    const b = rule({ id: "b", pattern: "wire transfer", severity: "block" });
    expect(findSafetyRuleRedundancies([a, b]).length).toBe(1);
  });

  it("identical patterns with the SAME severity are never flagged -- that's a plain duplicate, not this check's job", () => {
    const a = rule({ id: "a", pattern: "wire transfer", severity: "block" });
    const b = rule({ id: "b", pattern: "wire transfer", severity: "block" });
    expect(findSafetyRuleRedundancies([a, b])).toEqual([]);
  });

  it("genuinely different patterns are never flagged, even with different severities", () => {
    const a = rule({ id: "a", pattern: "wire transfer", severity: "require_approval" });
    const b = rule({ id: "b", pattern: "delete all records", severity: "block" });
    expect(findSafetyRuleRedundancies([a, b])).toEqual([]);
  });

  it("a disabled rule is never part of a redundancy pair", () => {
    const a = rule({ id: "a", pattern: "wire transfer", severity: "require_approval", enabled: false });
    const b = rule({ id: "b", pattern: "wire transfer", severity: "block" });
    expect(findSafetyRuleRedundancies([a, b])).toEqual([]);
  });

  it("a shadow-mode rule is never part of a redundancy pair", () => {
    const a = rule({ id: "a", pattern: "wire transfer", severity: "require_approval", shadow_mode: true });
    const b = rule({ id: "b", pattern: "wire transfer", severity: "block" });
    expect(findSafetyRuleRedundancies([a, b])).toEqual([]);
  });

  it("the older rule (by created_at) is always reported first, regardless of input order", () => {
    const older = rule({ id: "older", pattern: "wire transfer", severity: "require_approval", created_at: "2026-01-01T00:00:00Z" });
    const newer = rule({ id: "newer", pattern: "wire transfer", severity: "block", created_at: "2026-02-01T00:00:00Z" });
    const redundancies = findSafetyRuleRedundancies([newer, older]);
    expect(redundancies[0].older.id).toBe("older");
    expect(redundancies[0].newer.id).toBe("newer");
  });

  it("no rules at all is an empty list, not a crash", () => {
    expect(findSafetyRuleRedundancies([])).toEqual([]);
  });
});
