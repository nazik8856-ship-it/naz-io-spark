import { describe, it, expect } from "vitest";
import { computeIncidentAnalytics, type IncidentForAnalytics } from "@/lib/incident-analytics";

const row = (overrides: Partial<IncidentForAnalytics>): IncidentForAnalytics => ({
  status: "open",
  opened_at: "2026-01-01T00:00:00.000Z",
  acknowledged_at: null,
  resolved_at: null,
  root_cause_category: null,
  ...overrides,
});

describe("computeIncidentAnalytics", () => {
  it("returns nulls and zero counts for an empty list", () => {
    const result = computeIncidentAnalytics([]);
    expect(result.mtta_hours).toBeNull();
    expect(result.mttr_hours).toBeNull();
    expect(result.acknowledged_count).toBe(0);
    expect(result.resolved_count).toBe(0);
    expect(result.root_cause_breakdown).toEqual([]);
  });

  it("computes MTTA across every acknowledged incident, resolved or not", () => {
    const incidents = [
      row({ status: "acknowledged", acknowledged_at: "2026-01-01T02:00:00.000Z" }),
      row({
        status: "resolved",
        acknowledged_at: "2026-01-01T04:00:00.000Z",
        resolved_at: "2026-01-01T06:00:00.000Z",
      }),
    ];
    const result = computeIncidentAnalytics(incidents);
    expect(result.mtta_hours).toBe(3);
    expect(result.acknowledged_count).toBe(2);
  });

  it("computes MTTR only across resolved incidents", () => {
    const incidents = [
      row({ status: "open" }),
      row({ status: "acknowledged", acknowledged_at: "2026-01-01T01:00:00.000Z" }),
      row({ status: "resolved", resolved_at: "2026-01-01T10:00:00.000Z" }),
      row({ status: "resolved", resolved_at: "2026-01-01T20:00:00.000Z" }),
    ];
    const result = computeIncidentAnalytics(incidents);
    expect(result.mttr_hours).toBe(15);
    expect(result.resolved_count).toBe(2);
  });

  it("buckets a resolved incident with no root_cause_category as 'uncategorized', not dropped", () => {
    const incidents = [
      row({ status: "resolved", resolved_at: "2026-01-01T05:00:00.000Z", root_cause_category: null }),
      row({ status: "resolved", resolved_at: "2026-01-01T05:00:00.000Z", root_cause_category: "software_bug" }),
    ];
    const result = computeIncidentAnalytics(incidents);
    expect(result.root_cause_breakdown).toEqual([
      { category: "software_bug", count: 1 },
      { category: "uncategorized", count: 1 },
    ]);
  });

  it("never counts an open or acknowledged (unresolved) incident toward the root-cause breakdown", () => {
    const incidents = [
      row({ status: "open" }),
      row({ status: "acknowledged", acknowledged_at: "2026-01-01T01:00:00.000Z", root_cause_category: "software_bug" }),
    ];
    const result = computeIncidentAnalytics(incidents);
    expect(result.root_cause_breakdown).toEqual([]);
  });

  it("sorts the breakdown by count descending, then alphabetically for ties", () => {
    const incidents = [
      row({ status: "resolved", resolved_at: "2026-01-01T01:00:00.000Z", root_cause_category: "software_bug" }),
      row({ status: "resolved", resolved_at: "2026-01-01T01:00:00.000Z", root_cause_category: "other" }),
      row({ status: "resolved", resolved_at: "2026-01-01T01:00:00.000Z", root_cause_category: "software_bug" }),
      row({ status: "resolved", resolved_at: "2026-01-01T01:00:00.000Z", root_cause_category: "configuration_error" }),
    ];
    const result = computeIncidentAnalytics(incidents);
    expect(result.root_cause_breakdown).toEqual([
      { category: "software_bug", count: 2 },
      { category: "configuration_error", count: 1 },
      { category: "other", count: 1 },
    ]);
  });
});
