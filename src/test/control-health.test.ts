import { describe, it, expect } from "vitest";
import { pctOf, alertDeliverySplit, isTrendingDown } from "@/lib/control-health";

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
