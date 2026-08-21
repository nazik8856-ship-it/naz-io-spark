import { describe, it, expect } from "vitest";
import {
  classifyDecisionOutcome,
  summarizeDecisionsForRoi,
  costPerAutonomousDecision,
  projectMonthlySpend,
  buildRoiReport,
} from "@/lib/roi-report";

describe("classifyDecisionOutcome", () => {
  it("classifies each known verb prefix", () => {
    expect(classifyDecisionOutcome("BLOCK send_email (Gmail)")).toBe("block");
    expect(classifyDecisionOutcome("MODIFY send_email (Gmail)")).toBe("modify");
    expect(classifyDecisionOutcome("ALLOW send_email (Gmail)")).toBe("allow");
    expect(classifyDecisionOutcome("DEFERRED send_email (Gmail)")).toBe("deferred");
    expect(classifyDecisionOutcome("APPROVAL_REQUIRED send_email (Gmail)")).toBe("approval_required");
  });

  it("is case-insensitive on the verb", () => {
    expect(classifyDecisionOutcome("block send_email (Gmail)")).toBe("block");
  });

  it("anything unrecognized (kill-switch trips, undo records) is 'other'", () => {
    expect(classifyDecisionOutcome("KILL_SWITCH_ON (daily AI spend cap)")).toBe("other");
    expect(classifyDecisionOutcome("UNDO send_email (Gmail)")).toBe("other");
  });
});

describe("summarizeDecisionsForRoi", () => {
  it("counts blocked/modified/allowed and autonomous vs needs-human overall", () => {
    const { overall } = summarizeDecisionsForRoi([
      { decision: "BLOCK a (X)", escalated: false, agent_id: null },
      { decision: "MODIFY a (X)", escalated: false, agent_id: null },
      { decision: "ALLOW a (X)", escalated: false, agent_id: null },
      { decision: "APPROVAL_REQUIRED a (X)", escalated: true, agent_id: null },
    ]);
    expect(overall).toEqual({ total: 4, blocked: 1, modified: 1, allowed: 1, needsHuman: 1, autonomous: 3 });
  });

  it("groups by agent_id, with null grouped under 'account-wide'", () => {
    const { byAgent } = summarizeDecisionsForRoi([
      { decision: "ALLOW a (X)", escalated: false, agent_id: "agent-1" },
      { decision: "BLOCK a (X)", escalated: false, agent_id: "agent-1" },
      { decision: "ALLOW a (X)", escalated: false, agent_id: null },
    ]);
    expect(byAgent["agent-1"].total).toBe(2);
    expect(byAgent["agent-1"].blocked).toBe(1);
    expect(byAgent["account-wide"].total).toBe(1);
  });

  it("no decisions at all is a well-formed zeroed summary, not a crash", () => {
    const { overall, byAgent } = summarizeDecisionsForRoi([]);
    expect(overall).toEqual({ total: 0, blocked: 0, modified: 0, allowed: 0, needsHuman: 0, autonomous: 0 });
    expect(byAgent).toEqual({});
  });
});

describe("costPerAutonomousDecision", () => {
  it("divides total spend by autonomous count", () => {
    expect(costPerAutonomousDecision(10, 100)).toBe(0.1);
  });

  it("is null when there were no autonomous decisions (avoids divide-by-zero)", () => {
    expect(costPerAutonomousDecision(10, 0)).toBeNull();
  });
});

describe("projectMonthlySpend", () => {
  it("projects at the average daily rate observed so far", () => {
    // $10/day average over 30-day month -> $300
    expect(projectMonthlySpend([10, 10, 10], 3, 30)).toBe(300);
  });

  it("zero days elapsed projects zero, not NaN/Infinity", () => {
    expect(projectMonthlySpend([], 0, 30)).toBe(0);
  });

  it("uneven daily spend still averages correctly", () => {
    // $30 total over 3 days -> $10/day average -> * 30 days = $300
    expect(projectMonthlySpend([0, 15, 15], 3, 30)).toBe(300);
  });
});

describe("buildRoiReport", () => {
  const baseInput = {
    from: "2026-08-01",
    to: "2026-08-21",
    generatedAt: "2026-08-21T00:00:00Z",
    decisions: [
      { decision: "BLOCK a (X)", escalated: false, agent_id: "agent-1" },
      { decision: "ALLOW a (X)", escalated: false, agent_id: "agent-1" },
    ],
    totalSpendUsd: 5,
    spendByAgent: { "agent-1": 2 },
    agentNames: { "agent-1": "Support Bot" },
    decisionsTrend: { current: 2, previous: 1, changePct: 100, direction: "up" },
    spendTrend: { current: 5, previous: 2, changePct: 150, direction: "up" },
    projectedMonthlySpendUsd: 150,
  };

  it("includes the agent's display name, not a raw uuid", () => {
    const report = buildRoiReport(baseInput);
    expect(report).toContain("Support Bot");
    expect(report).not.toContain("agent-1");
  });

  it("never states a fabricated dollar 'exposure avoided' figure", () => {
    const report = buildRoiReport(baseInput);
    expect(report.toLowerCase()).not.toContain("exposure avoided");
  });

  it("reports 'n/a' for cost-per-decision when there are no autonomous decisions", () => {
    const report = buildRoiReport({
      ...baseInput,
      decisions: [{ decision: "APPROVAL_REQUIRED a (X)", escalated: true, agent_id: null }],
    });
    expect(report).toContain("n/a");
  });
});
