import { describe, it, expect } from "vitest";
import { DECISION_LABEL, DEFAULT_DECISIONS, healthText, splitSessions, timeAgo, toolStatus, visibleItems } from "@/lib/outer-control-ui";

describe("toolStatus", () => {
  const base = { approved_at: "2026-10-01T00:00:00Z", last_checked_at: null as string | null, last_error: null as string | null };
  it("ranks a failed test above everything else", () => {
    expect(toolStatus({ ...base, approved_at: null, last_checked_at: "2026-10-02", last_error: "HTTP 401" })).toMatchObject({ label: "Test failed", tone: "bad" });
  });
  it("asks for the first approval before claiming the tool works", () => {
    expect(toolStatus({ ...base, approved_at: null, last_checked_at: "2026-10-02" })).toMatchObject({ label: "Needs first approval", tone: "warn" });
  });
  it("says Working after a good test and Not tested yet before any test", () => {
    expect(toolStatus({ ...base, last_checked_at: "2026-10-02" })).toMatchObject({ label: "Working", tone: "ok" });
    expect(toolStatus(base)).toMatchObject({ label: "Not tested yet", tone: "idle" });
  });
});

describe("healthText", () => {
  it("tells a new account what to do first", () => {
    expect(healthText({ total7d: 0, nonAllow7d: 0, anyEver: false })).toMatch(/Connect a tool and start a session/);
  });
  it("counts replies in plain words", () => {
    expect(healthText({ total7d: 1, nonAllow7d: 0, anyEver: true })).toBe("1 reply checked in the last 7 days, all allowed.");
    expect(healthText({ total7d: 12, nonAllow7d: 3, anyEver: true })).toBe("12 replies checked in the last 7 days; 3 changed, blocked or sent for approval.");
    expect(healthText({ total7d: 0, nonAllow7d: 0, anyEver: true })).toBe("No replies checked in the last 7 days.");
  });
});

describe("decision wording and lists", () => {
  it("shows an escalation as what the person has to do", () => {
    expect(DECISION_LABEL.escalate.label).toBe("Needs approval");
    expect(DECISION_LABEL.allow.label).toBe("Allow");
    expect(DECISION_LABEL.modify.label).toBe("Modify");
    expect(DECISION_LABEL.block.label).toBe("Block");
  });
  it("the default list is 5 to 7 decisions", () => {
    expect(DEFAULT_DECISIONS).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_DECISIONS).toBeLessThanOrEqual(7);
  });
  it("visibleItems cuts to n until everything is asked for", () => {
    expect(visibleItems([1, 2, 3, 4], 3, false)).toEqual([1, 2, 3]);
    expect(visibleItems([1, 2, 3, 4], 3, true)).toEqual([1, 2, 3, 4]);
  });
  it("splitSessions puts running and waiting sessions first, finished ones in the history", () => {
    const r = splitSessions([{ status: "running" as const }, { status: "completed" as const }, { status: "awaiting_human" as const }, { status: "cancelled" as const }]);
    expect(r.open.map((s) => s.status)).toEqual(["running", "awaiting_human"]);
    expect(r.past.map((s) => s.status)).toEqual(["completed", "cancelled"]);
  });
  it("timeAgo is short", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe("3h ago");
    expect(timeAgo(new Date(Date.now() - 2 * 86400_000).toISOString())).toBe("2d ago");
  });
});
