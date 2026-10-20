import { describe, it, expect } from "vitest";
import {
  ABSOLUTE_MAX_ROUNDS, blockedActions, criteriaProgress, goalHeadline, isGoalTask, parseCriteriaLines, roundsLine,
} from "@/lib/outer-control-goal-ui";

describe("goal Task states", () => {
  it("names three states: in progress, completed, and blocked for every other way a Task can stand", () => {
    expect(goalHeadline("running").label).toBe("In progress");
    expect(goalHeadline("queued").label).toBe("In progress");
    expect(goalHeadline("completed").label).toBe("Completed");
    for (const k of ["waiting", "stopped", "failed", "partial"] as const) expect(goalHeadline(k)).toEqual({ key: "blocked", label: "Blocked" });
  });

  it("knows a goal Task from a steps Task", () => {
    expect(isGoalTask({ mode: "goal" })).toBe(true);
    expect(isGoalTask({ mode: "steps" })).toBe(false);
    expect(isGoalTask({ mode: undefined })).toBe(false);
  });

  it("counts met criteria and words the round", () => {
    const state = [
      { id: "c1", text: "A", met: true, evidence: "e", round: 1 }, { id: "c2", text: "B", met: false, evidence: null, round: null }, { id: "c3", text: "C", met: null, evidence: null, round: null },
    ];
    expect(criteriaProgress({ criteria_state: state })).toEqual({ met: 1, total: 3 });
    expect(criteriaProgress({ criteria_state: null })).toEqual({ met: 0, total: 0 });
    expect(roundsLine({ rounds_used: 2, max_rounds: 4 })).toBe("Round 2 of 4");
    expect(roundsLine({})).toBe("Round 1 of 1");
  });

  it("offers the three ways out only for a Task that is blocked on its criteria, and not more rounds past the maximum", () => {
    const blocked = { mode: "goal", status: "awaiting_human", blocked_reason: "Rounds used up.", max_rounds: 4 };
    expect(blockedActions(blocked)).toEqual({ accept: true, more: true, stop: true });
    expect(blockedActions({ ...blocked, max_rounds: ABSOLUTE_MAX_ROUNDS })).toEqual({ accept: true, more: false, stop: true });
    expect(blockedActions({ ...blocked, blocked_reason: null })).toEqual({ accept: false, more: false, stop: false });
    expect(blockedActions({ ...blocked, status: "running" })).toEqual({ accept: false, more: false, stop: false });
  });
});

describe("done criteria typed one per line", () => {
  it("trims bullets and blanks and removes repeats", () => {
    expect(parseCriteriaLines("- States the return window\n\n  2) Names a date \nStates the return window")).toEqual({ ok: true, criteria: ["States the return window", "Names a date"] });
    expect(parseCriteriaLines("")).toEqual({ ok: true, criteria: [] });
  });
  it("refuses more than five, or one that is too long", () => {
    expect(parseCriteriaLines("a\nb\nc\nd\ne\nf").ok).toBe(false);
    const long = parseCriteriaLines("x".repeat(201));
    expect(long.ok).toBe(false);
  });
});
