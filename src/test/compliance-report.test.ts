import { describe, it, expect } from "vitest";
import { buildComplianceReport } from "@/lib/compliance-report";

const base = { from: "2026-08-01", to: "2026-08-19", generatedAt: "2026-08-19T00:00:00.000Z" };

describe("buildComplianceReport", () => {
  it("includes the range and generated timestamp in the header", () => {
    const report = buildComplianceReport({ ...base, testRuns: [], incidents: [], changes: [] });
    expect(report).toContain("Range: 2026-08-01 to 2026-08-19");
    expect(report).toContain("Generated: 2026-08-19T00:00:00.000Z");
  });

  it("an empty range reports 'None in this range.' for all three sections", () => {
    const report = buildComplianceReport({ ...base, testRuns: [], incidents: [], changes: [] });
    const noneCount = (report.match(/None in this range\./g) || []).length;
    expect(noneCount).toBe(3);
  });

  it("lists a self-audit run's pass rate, and regressions only when present", () => {
    const report = buildComplianceReport({
      ...base,
      testRuns: [
        { created_at: "2026-08-10T06:00:00Z", pass_rate_pct: 100, regressions: [] },
        { created_at: "2026-08-11T06:00:00Z", pass_rate_pct: 90, regressions: ["scenario_x", "scenario_y"] },
      ],
      incidents: [],
      changes: [],
    });
    expect(report).toContain("2026-08-10T06:00:00Z: 100% pass");
    expect(report).not.toContain("100% pass,"); // no regression suffix when the array is empty
    expect(report).toContain("2026-08-11T06:00:00Z: 90% pass, 2 regression(s)");
  });

  it("lists an incident with its status, summary, open/resolve times, and note", () => {
    const report = buildComplianceReport({
      ...base,
      testRuns: [],
      incidents: [{
        kind: "circuit_breaker_trip",
        status: "resolved",
        summary: "tripped for send_email",
        opened_at: "2026-08-05T10:00:00Z",
        resolved_at: "2026-08-05T12:00:00Z",
        resolution_note: "Fixed the upstream provider outage.",
      }],
      changes: [],
    });
    expect(report).toContain("[resolved] circuit_breaker_trip — tripped for send_email");
    expect(report).toContain("Opened: 2026-08-05T10:00:00Z · Resolved: 2026-08-05T12:00:00Z");
    expect(report).toContain("Note: Fixed the upstream provider outage.");
  });

  it("an open incident (no resolved_at) omits the resolved time and note lines", () => {
    const report = buildComplianceReport({
      ...base,
      testRuns: [],
      incidents: [{ kind: "gate_error", status: "open", summary: "boom", opened_at: "2026-08-05T10:00:00Z", resolved_at: null, resolution_note: null }],
      changes: [],
    });
    expect(report).toContain("Opened: 2026-08-05T10:00:00Z");
    expect(report).not.toContain("Resolved:");
    expect(report).not.toContain("Note:");
  });

  it("summarizes a settings change using the same diff logic as the change-log page", () => {
    const report = buildComplianceReport({
      ...base,
      testRuns: [],
      incidents: [],
      changes: [{
        table_name: "hard_rules",
        action: "update",
        before: { effect: "always_require_approval" },
        after: { effect: "always_block" },
        created_at: "2026-08-03T00:00:00Z",
      }],
    });
    expect(report).toContain('hard_rules update: effect: "always_require_approval" → "always_block"');
  });
});
