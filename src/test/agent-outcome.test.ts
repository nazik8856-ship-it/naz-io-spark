import { describe, it, expect } from "vitest";
import { computeRunOutcome } from "@/lib/agent-outcome";

describe("computeRunOutcome", () => {
  it("no events yet reads as Running, not Failed (run in progress)", () => {
    expect(computeRunOutcome([])).toEqual({ label: "Running", tone: "zinc" });
  });

  it("a successful delivered action is Done", () => {
    expect(computeRunOutcome([{ kind: "action", payload: { type: "send_email", ok: true } }]))
      .toEqual({ label: "Done", tone: "green" });
  });

  it("a failed action with no recovery is Failed", () => {
    expect(computeRunOutcome([{ kind: "action", payload: { type: "schedule_followup", ok: false } }]))
      .toEqual({ label: "Failed", tone: "red" });
  });

  it("an open pending_approval is Needs approval", () => {
    expect(computeRunOutcome([{ kind: "pending_approval", payload: {} }]))
      .toEqual({ label: "Needs approval", tone: "amber" });
  });

  it("control_gate_blocked with verdict 'modify' counts as Needs approval, not Failed (regression: this was the real production mislabel)", () => {
    // The exact real event sequence from the one production run this
    // classification bug ever ran against.
    const events = [
      { kind: "action", payload: { type: "schedule_followup", ok: false } },
      { kind: "action", payload: { type: "schedule_followup", ok: false } },
      { kind: "control_gate_blocked", payload: { verdict: "modify", approval_id: "d3d5a221" } },
    ];
    expect(computeRunOutcome(events)).toEqual({ label: "Needs approval", tone: "amber" });
  });

  it("control_gate_blocked with a hard 'block' verdict still counts as Failed", () => {
    const events = [
      { kind: "action", payload: { type: "x", ok: false } },
      { kind: "control_gate_blocked", payload: { verdict: "block" } },
    ];
    expect(computeRunOutcome(events)).toEqual({ label: "Failed", tone: "red" });
  });

  it("an open clarification (ask_user) is Blocked", () => {
    expect(computeRunOutcome([{ kind: "ask_user", payload: {} }]))
      .toEqual({ label: "Blocked", tone: "amber" });
  });

  it("a resolved approval no longer counts", () => {
    const events = [
      { kind: "pending_approval", payload: {} },
      { kind: "approved", payload: {} },
      { kind: "action", payload: { type: "send_email", ok: true } },
    ];
    expect(computeRunOutcome(events)).toEqual({ label: "Done", tone: "green" });
  });
});
