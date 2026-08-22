import { describe, it, expect } from "vitest";
import { classifyAnomalyCoverage, topAgentlessActionTypes } from "@/lib/anomaly-coverage";

describe("classifyAnomalyCoverage", () => {
  it("zero total decisions is severity none, not a division-by-zero crash", () => {
    expect(classifyAnomalyCoverage(0, 0)).toEqual({ pct: 0, severity: "none" });
  });

  it("under 5% agentless is severity none", () => {
    expect(classifyAnomalyCoverage(1000, 40)).toEqual({ pct: 4, severity: "none" });
  });

  it("5% to under 20% is severity low", () => {
    expect(classifyAnomalyCoverage(100, 5)).toEqual({ pct: 5, severity: "low" });
    expect(classifyAnomalyCoverage(100, 19)).toEqual({ pct: 19, severity: "low" });
  });

  it("20% to under 50% is severity moderate", () => {
    expect(classifyAnomalyCoverage(100, 20)).toEqual({ pct: 20, severity: "moderate" });
    expect(classifyAnomalyCoverage(100, 49)).toEqual({ pct: 49, severity: "moderate" });
  });

  it("50% or more is severity high", () => {
    expect(classifyAnomalyCoverage(100, 50)).toEqual({ pct: 50, severity: "high" });
    expect(classifyAnomalyCoverage(10, 10)).toEqual({ pct: 100, severity: "high" });
  });

  it("rounds the percentage to one decimal place", () => {
    expect(classifyAnomalyCoverage(3, 1).pct).toBe(33.3);
  });
});

describe("topAgentlessActionTypes", () => {
  it("groups by (action_type, provider) and counts", () => {
    const rows = [
      { action_type: "send_email", provider: "Gmail" },
      { action_type: "send_email", provider: "Gmail" },
      { action_type: "slack_post_message", provider: "Slack" },
    ];
    const result = topAgentlessActionTypes(rows);
    expect(result).toEqual([
      { action_type: "send_email", provider: "Gmail", count: 2 },
      { action_type: "slack_post_message", provider: "Slack", count: 1 },
    ]);
  });

  it("the same action_type with a DIFFERENT provider is a separate group", () => {
    const rows = [
      { action_type: "send_email", provider: "Gmail" },
      { action_type: "send_email", provider: "Outlook" },
    ];
    expect(topAgentlessActionTypes(rows).length).toBe(2);
  });

  it("null action_type/provider are labeled rather than crashing", () => {
    const result = topAgentlessActionTypes([{ action_type: null, provider: null }]);
    expect(result).toEqual([{ action_type: "(unknown)", provider: null, count: 1 }]);
  });

  it("sorts descending by count and caps at n", () => {
    const rows = [
      ...Array(5).fill({ action_type: "a", provider: "P" }),
      ...Array(3).fill({ action_type: "b", provider: "P" }),
      ...Array(1).fill({ action_type: "c", provider: "P" }),
    ];
    const result = topAgentlessActionTypes(rows, 2);
    expect(result.length).toBe(2);
    expect(result[0].action_type).toBe("a");
    expect(result[1].action_type).toBe("b");
  });

  it("no rows at all is an empty list, not a crash", () => {
    expect(topAgentlessActionTypes([])).toEqual([]);
  });
});
