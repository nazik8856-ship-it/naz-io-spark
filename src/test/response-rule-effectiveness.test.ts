import { describe, it, expect } from "vitest";
import { findStaleResponseRules } from "@/lib/response-rule-effectiveness";

const WINDOW_START = "2026-07-01T00:00:00Z";
const OLD_ENOUGH = "2026-06-01T00:00:00Z";
const TOO_NEW = "2026-08-01T00:00:00Z";
const RECENT_MATCH = "2026-07-15T00:00:00Z";
const STALE_MATCH = "2026-06-10T00:00:00Z";

describe("findStaleResponseRules", () => {
  it("a rule that's never fired is reported as never_fired", () => {
    const stale = findStaleResponseRules(
      [{ id: "r1", trigger_phrase: "cancel", created_at: OLD_ENOUGH, use_count: 0, last_used_at: null }],
      WINDOW_START,
    );
    expect(stale.map((r) => r.id)).toEqual(["r1"]);
    expect(stale[0].reason).toBe("never_fired");
  });

  it("a rule that fired but not within the window is reported as no_recent_matches", () => {
    const stale = findStaleResponseRules(
      [{ id: "r1", trigger_phrase: "cancel", created_at: OLD_ENOUGH, use_count: 3, last_used_at: STALE_MATCH }],
      WINDOW_START,
    );
    expect(stale.map((r) => r.id)).toEqual(["r1"]);
    expect(stale[0].reason).toBe("no_recent_matches");
  });

  it("a rule with a recent match is healthy, not reported", () => {
    const stale = findStaleResponseRules(
      [{ id: "r1", trigger_phrase: "cancel", created_at: OLD_ENOUGH, use_count: 3, last_used_at: RECENT_MATCH }],
      WINDOW_START,
    );
    expect(stale).toEqual([]);
  });

  it("a disabled rule is never reported (nothing to evaluate)", () => {
    const stale = findStaleResponseRules(
      [{ id: "r1", trigger_phrase: "cancel", created_at: OLD_ENOUGH, use_count: 0, last_used_at: null, enabled: false }],
      WINDOW_START,
    );
    expect(stale).toEqual([]);
  });

  it("a rule created after the window start hasn't had a fair chance yet, so it's excluded", () => {
    const stale = findStaleResponseRules(
      [{ id: "r1", trigger_phrase: "brand new rule", created_at: TOO_NEW, use_count: 0, last_used_at: null }],
      WINDOW_START,
    );
    expect(stale).toEqual([]);
  });

  it("mixed batch: only the actually-stale live rules are returned, each with its own reason", () => {
    const stale = findStaleResponseRules(
      [
        { id: "healthy", trigger_phrase: "a", created_at: OLD_ENOUGH, use_count: 5, last_used_at: RECENT_MATCH },
        { id: "never-fired", trigger_phrase: "b", created_at: OLD_ENOUGH, use_count: 0, last_used_at: null },
        { id: "went-stale", trigger_phrase: "c", created_at: OLD_ENOUGH, use_count: 2, last_used_at: STALE_MATCH },
        { id: "disabled", trigger_phrase: "d", created_at: OLD_ENOUGH, use_count: 0, last_used_at: null, enabled: false },
        { id: "too-new", trigger_phrase: "e", created_at: TOO_NEW, use_count: 0, last_used_at: null },
      ],
      WINDOW_START,
    );
    expect(stale.map((r) => [r.id, r.reason])).toEqual([
      ["never-fired", "never_fired"],
      ["went-stale", "no_recent_matches"],
    ]);
  });

  it("no rules at all is an empty list, not a crash", () => {
    expect(findStaleResponseRules([], WINDOW_START)).toEqual([]);
  });
});
