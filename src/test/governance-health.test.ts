import { describe, it, expect } from "vitest";
import { computeGovernanceHealth } from "@/lib/governance-health";

describe("computeGovernanceHealth", () => {
  it("is green when trust score is high, rules apply, and spend is well within cap", () => {
    const result = computeGovernanceHealth({ trustScore: 95, rulesApplied: 3, spendPct: 0.2 });
    expect(result.level).toBe("green");
  });

  it("is green when there isn't enough data yet for a trust score, as long as rules apply and spend is fine", () => {
    const result = computeGovernanceHealth({ trustScore: null, rulesApplied: 2, spendPct: null });
    expect(result.level).toBe("green");
  });

  it("is red when trust score is low, regardless of rules/spend", () => {
    const result = computeGovernanceHealth({ trustScore: 40, rulesApplied: 3, spendPct: 0.1 });
    expect(result.level).toBe("red");
    expect(result.reasons[0]).toMatch(/trust score is low/i);
  });

  it("is red when today's spend is at or over the cap", () => {
    const result = computeGovernanceHealth({ trustScore: 90, rulesApplied: 3, spendPct: 1 });
    expect(result.level).toBe("red");
  });

  it("is amber when no rule governs this entity at all", () => {
    const result = computeGovernanceHealth({ trustScore: 90, rulesApplied: 0, spendPct: 0.1 });
    expect(result.level).toBe("amber");
    expect(result.reasons[0]).toMatch(/no rule currently governs/i);
  });

  it("is amber when trust score is mediocre but not low", () => {
    const result = computeGovernanceHealth({ trustScore: 65, rulesApplied: 1, spendPct: 0 });
    expect(result.level).toBe("amber");
  });

  it("is amber when spend is near but not over the cap", () => {
    const result = computeGovernanceHealth({ trustScore: 90, rulesApplied: 1, spendPct: 0.85 });
    expect(result.level).toBe("amber");
  });

  it("red takes priority over amber when both conditions are present", () => {
    const result = computeGovernanceHealth({ trustScore: 40, rulesApplied: 0, spendPct: 0.85 });
    expect(result.level).toBe("red");
  });

  it("boundary: exactly the amber trust threshold is still green (strict less-than)", () => {
    const result = computeGovernanceHealth({ trustScore: 80, rulesApplied: 1, spendPct: 0 });
    expect(result.level).toBe("green");
  });

  it("boundary: exactly the red trust threshold reads as amber, not red", () => {
    const result = computeGovernanceHealth({ trustScore: 50, rulesApplied: 1, spendPct: 0 });
    expect(result.level).toBe("amber");
  });
});
