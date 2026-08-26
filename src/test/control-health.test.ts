import { describe, it, expect } from "vitest";
import { pctOf, alertDeliverySplit, isTrendingDown, gateLatencyStats, isAuditIntegritySweepFailing, engineUptimeStats, recentGateErrors } from "@/lib/control-health";

describe("pctOf", () => {
  it("computes a percentage to one decimal place", () => {
    expect(pctOf(1, 3)).toBe(33.3);
  });

  it("returns 0 when total is 0, not NaN or Infinity", () => {
    expect(pctOf(5, 0)).toBe(0);
  });

  it("100 count / 100 total is exactly 100", () => {
    expect(pctOf(100, 100)).toBe(100);
  });
});

describe("alertDeliverySplit", () => {
  it("splits slack vs log delivered alerts and computes slack percentage", () => {
    const alerts = [
      { delivered_via: "slack" as const },
      { delivered_via: "slack" as const },
      { delivered_via: "log" as const },
    ];
    expect(alertDeliverySplit(alerts)).toEqual({ slack: 2, log: 1, total: 3, slackPct: 66.7 });
  });

  it("no alerts at all reports slackPct 100 (nothing failed to deliver), not 0", () => {
    expect(alertDeliverySplit([])).toEqual({ slack: 0, log: 0, total: 0, slackPct: 100 });
  });

  it("all log (no Slack connected) is slackPct 0", () => {
    const alerts = [{ delivered_via: "log" as const }, { delivered_via: "log" as const }];
    expect(alertDeliverySplit(alerts)).toEqual({ slack: 0, log: 2, total: 2, slackPct: 0 });
  });
});

describe("isTrendingDown", () => {
  it("fewer than 2 runs is never trending down", () => {
    expect(isTrendingDown([])).toBe(false);
    expect(isTrendingDown([{ pass_rate_pct: 80, created_at: "2026-08-01" }])).toBe(false);
  });

  it("a lower pass rate than the previous run is trending down", () => {
    const runs = [
      { pass_rate_pct: 70, created_at: "2026-08-02" },
      { pass_rate_pct: 90, created_at: "2026-08-01" },
    ];
    expect(isTrendingDown(runs)).toBe(true);
  });

  it("an equal or higher pass rate is NOT trending down", () => {
    const equal = [
      { pass_rate_pct: 90, created_at: "2026-08-02" },
      { pass_rate_pct: 90, created_at: "2026-08-01" },
    ];
    const higher = [
      { pass_rate_pct: 95, created_at: "2026-08-02" },
      { pass_rate_pct: 90, created_at: "2026-08-01" },
    ];
    expect(isTrendingDown(equal)).toBe(false);
    expect(isTrendingDown(higher)).toBe(false);
  });
});

describe("gateLatencyStats", () => {
  it("no data returns all zeros, not NaN", () => {
    expect(gateLatencyStats([])).toEqual({ avgMs: 0, p95Ms: 0, count: 0 });
  });

  it("computes a rounded average", () => {
    expect(gateLatencyStats([10, 20, 30])).toEqual({ avgMs: 20, p95Ms: 30, count: 3 });
  });

  it("p95 is dominated by the tail, not the average", () => {
    const durations = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const stats = gateLatencyStats(durations);
    expect(stats.p95Ms).toBe(95);
    expect(stats.avgMs).toBe(51);
  });

  it("input order doesn't matter", () => {
    expect(gateLatencyStats([30, 10, 20])).toEqual(gateLatencyStats([10, 20, 30]));
  });
});

describe("isAuditIntegritySweepFailing", () => {
  it("no run yet is not a failure", () => {
    expect(isAuditIntegritySweepFailing(null)).toBe(false);
  });

  it("a clean run (no mismatches, nothing unsigned) is not a failure", () => {
    expect(isAuditIntegritySweepFailing({ mismatched_count: 0, unsigned: 0, created_at: "2026-08-24" })).toBe(false);
  });

  it("any mismatch is a failure", () => {
    expect(isAuditIntegritySweepFailing({ mismatched_count: 1, unsigned: 0, created_at: "2026-08-24" })).toBe(true);
  });

  it("any unsigned decision in range is a failure", () => {
    expect(isAuditIntegritySweepFailing({ mismatched_count: 0, unsigned: 1, created_at: "2026-08-24" })).toBe(true);
  });
});

describe("engineUptimeStats", () => {
  it("no decisions at all in the window -> null uptimePct, not a false 100%", () => {
    expect(engineUptimeStats(0, 0)).toEqual({ uptimePct: null, errorCount: 0, total: 0 });
  });

  it("zero errors out of real traffic is exactly 100% uptime", () => {
    expect(engineUptimeStats(0, 500)).toEqual({ uptimePct: 100, errorCount: 0, total: 500 });
  });

  it("some gate errors bring uptime below 100, rounded to one decimal", () => {
    expect(engineUptimeStats(1, 3)).toEqual({ uptimePct: 66.7, errorCount: 1, total: 3 });
  });

  it("every decision erroring is exactly 0% uptime, not negative or NaN", () => {
    expect(engineUptimeStats(10, 10)).toEqual({ uptimePct: 0, errorCount: 10, total: 10 });
  });
});

describe("recentGateErrors", () => {
  const rows = [
    { source: "hard_rule", reasoning: "blocked on purpose", created_at: "2026-08-20T00:00:00Z" },
    { source: "gate_error", reasoning: "provider timeout", created_at: "2026-08-25T00:00:00Z" },
    { source: "gate_error", reasoning: "missing api key", created_at: "2026-08-22T00:00:00Z" },
    { source: "safety_scanner", reasoning: "flagged content", created_at: "2026-08-26T00:00:00Z" },
  ];

  it("only returns gate_error rows, excluding deliberate blocks", () => {
    const result = recentGateErrors(rows);
    expect(result).toHaveLength(2);
    expect(result.every((r) => "reasoning" in r)).toBe(true);
  });

  it("sorts newest first regardless of input order", () => {
    const result = recentGateErrors(rows);
    expect(result[0]).toEqual({ reasoning: "provider timeout", created_at: "2026-08-25T00:00:00Z" });
    expect(result[1]).toEqual({ reasoning: "missing api key", created_at: "2026-08-22T00:00:00Z" });
  });

  it("caps at the given limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      source: "gate_error", reasoning: `error ${i}`, created_at: `2026-08-${10 + i}T00:00:00Z`,
    }));
    expect(recentGateErrors(many, 5)).toHaveLength(5);
  });

  it("no gate_error rows returns an empty array, not a crash", () => {
    expect(recentGateErrors([{ source: "hard_rule", reasoning: "x", created_at: "2026-08-20T00:00:00Z" }])).toEqual([]);
  });
});
