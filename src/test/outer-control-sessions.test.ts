import { describe, it, expect } from "vitest";
import { describeStep, describeWaiting, isOpen, STATUS_LABEL } from "@/lib/outer-control-sessions";

describe("outer-control-sessions", () => {
  it("only running and awaiting_human sessions are open", () => {
    expect(isOpen("running")).toBe(true);
    expect(isOpen("awaiting_human")).toBe(true);
    for (const s of ["completed", "rejected", "failed", "cancelled", "stopped"] as const) expect(isOpen(s)).toBe(false);
  });

  it("every status has a label", () => {
    expect(STATUS_LABEL.awaiting_human).toBe("Needs you");
    expect(Object.keys(STATUS_LABEL)).toHaveLength(7);
  });

  it("says what a person must do for each pause", () => {
    expect(describeWaiting("first_contact", null)).toMatch(/first contact/i);
    expect(describeWaiting("contact_gate", null)).toMatch(/before Outer Control contacts/);
    expect(describeWaiting("reply_approval", null)).toMatch(/reply needs your approval/);
    expect(describeWaiting("question", "Which order?")).toBe("The tool asks: Which order?");
    expect(describeWaiting("question", null)).toMatch(/needs information/);
    expect(describeWaiting(null, null)).toBeNull();
  });

  it("describes a step with its verdict and what was done", () => {
    expect(describeStep({ step_no: 2, attempt: 2, verdict: "allow", next_action: "continue", error: null, note: null }))
      .toBe("Step 2 (try 2) — verdict allow — accepted, asked for another round");
    expect(describeStep({ step_no: 1, attempt: 1, verdict: null, next_action: "retry_same", error: "Tool returned HTTP 500", note: null }))
      .toBe("Step 1 — Tool returned HTTP 500 — no usable reply, asking again");
    expect(describeStep({ step_no: 1, attempt: 1, verdict: "block", next_action: "mystery", error: null, note: null }))
      .toBe("Step 1 — verdict block — mystery");
  });
});
