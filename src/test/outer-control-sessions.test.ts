import { describe, it, expect } from "vitest";
import { describeDecision, riskConfidenceBadges, describeStep, describeWaiting, isOpen, legsPayload, STATUS_LABEL, WORKFLOW_LABEL } from "@/lib/outer-control-sessions";

describe("outer-control-sessions", () => {
  it("queued, running and awaiting_human sessions are open", () => {
    expect(isOpen("queued")).toBe(true);
    expect(isOpen("running")).toBe(true);
    expect(isOpen("awaiting_human")).toBe(true);
    for (const s of ["completed", "rejected", "failed", "cancelled", "stopped"] as const) expect(isOpen(s)).toBe(false);
  });

  it("every status has a label", () => {
    expect(STATUS_LABEL.awaiting_human).toBe("Needs you");
    expect(Object.keys(STATUS_LABEL)).toHaveLength(9);
    expect(Object.keys(WORKFLOW_LABEL)).toHaveLength(5);
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

  it("describes a hand-off and the new recovery actions", () => {
    expect(describeWaiting("handoff", null)).toMatch(/choose how to continue/);
    expect(describeStep({ step_no: 1, attempt: 4, verdict: null, next_action: "switch_tool", error: "The tool answered HTTP 500.", note: null }))
      .toBe("Step 1 (try 4) — The tool answered HTTP 500. — the tool kept failing, switched to the fallback tool");
    expect(describeStep({ step_no: 2, attempt: 2, verdict: "block", next_action: "handoff", error: null, note: null })).toMatch(/handed to a person/);
  });

  it("builds the workflow steps from the form and reports the first problem", () => {
    const draft = (o: Partial<{ toolId: string; instruction: string; deps: number[]; fallbackId: string }>) => ({ toolId: "t1", instruction: "Do it", deps: [], fallbackId: "", ...o });
    expect(legsPayload([]).message).toMatch(/at least one step/);
    expect(legsPayload([draft({ toolId: "" })]).message).toBe("Step 1: choose a tool.");
    expect(legsPayload([draft({}), draft({ instruction: "  " })]).message).toBe("Step 2: say what the tool should do.");
    const ok = legsPayload([draft({}), draft({ toolId: "t2", instruction: " Draft ", deps: [1, 2, 7], fallbackId: "t1" })]);
    expect(ok.legs).toEqual([
      { tool_id: "t1", instruction: "Do it", depends_on: [] },
      { tool_id: "t2", instruction: "Draft", depends_on: [1], fallback_tool_id: "t1" },
    ]);
  });

  it("builds step conditions from the form and refuses an incomplete one", () => {
    const d = (o: object) => ({ toolId: "t1", instruction: "Do it", deps: [], fallbackId: "", ...o });
    const ok = legsPayload([d({}), d({ condKind: "contains", condLeg: 1, condValue: " exchange " }), d({ condKind: "dep_failed", condLeg: 1 })]);
    expect(ok.legs?.[1]).toEqual({ tool_id: "t1", instruction: "Do it", depends_on: [], condition: { leg: 1, op: "contains", value: "exchange" } });
    expect(ok.legs?.[2]).toEqual({ tool_id: "t1", instruction: "Do it", depends_on: [], condition: { leg: 1, op: "dep_failed" } });
    expect(legsPayload([d({}), d({ condKind: "contains", condLeg: 1, condValue: "  " })]).message).toBe("Step 2: say which text the condition looks for.");
    expect(legsPayload([d({}), d({ condKind: "not_contains", condLeg: 5, condValue: "x" })]).message).toBe("Step 2: choose which earlier step the condition looks at.");
    expect(legsPayload([d({ condKind: "dep_failed", condLeg: 1 })]).message).toBe("Step 1: choose which earlier step the condition looks at.");
    expect(legsPayload([d({}), d({ condKind: "always" })]).legs?.[1]).not.toHaveProperty("condition");
  });

  it("labels skipped steps", () => {
    expect(STATUS_LABEL.skipped).toBe("Skipped");
    expect(isOpen("skipped")).toBe(false);
  });

  it("turns a stored decision into short reasoning lines, and says nothing when there is none", () => {
    expect(describeDecision(null)).toEqual([]);
    expect(describeDecision(undefined)).toEqual([]);
    expect(describeDecision({})).toEqual([]);
    const lines = describeDecision({
      why: "Needs your approval. Matched rules asked for different outcomes. The strictest wins: require approval (\"Quote\").",
      plan: { kind: "pause_human", reason: "The reply needs a person's approval.", basis: ["\"Quote\" blocked 2 time(s) earlier in this task."] },
    });
    expect(lines).toEqual([
      'Why: Needs your approval. Matched rules asked for different outcomes. The strictest wins: require approval ("Quote").',
      'Based on: "Quote" blocked 2 time(s) earlier in this task.',
      "Next: The reply needs a person's approval.",
    ]);
    expect(describeDecision({ why: "x".repeat(400) })[0].length).toBeLessThanOrEqual(286);
  });

  it("describes the request-tightening step", () => {
    expect(describeStep({ step_no: 1, attempt: 2, verdict: "block", next_action: "modify_request", error: null, note: null })).toMatch(/request tightened/);
  });
});

describe("trace, risk and confidence in the step log", () => {
  it("shows the trace instead of the single reason, then what it was based on and what happens next", () => {
    const lines = describeDecision({
      why: "old single reason", trace: ["Decision: Block.", "Risk: high — a blocking rule.", "Confidence: high — decided directly by a rule."],
      plan: { reason: "A person decides.", basis: ["Rule X blocked 1 time earlier."] },
    });
    expect(lines).toEqual(["Decision: Block.", "Risk: high — a blocking rule.", "Confidence: high — decided directly by a rule.", "Based on: Rule X blocked 1 time earlier.", "Next: A person decides."]);
    expect(lines.some((l) => l.startsWith("Why:"))).toBe(false);
  });

  it("falls back to the single reason for steps stored before traces existed, and clips long trace lines", () => {
    expect(describeDecision({ why: "Because." })).toEqual(["Why: Because."]);
    expect(describeDecision({ trace: ["x".repeat(400)] })[0].length).toBeLessThanOrEqual(240);
  });

  it("badges: risk is red when high, confidence is red when low", () => {
    const b = riskConfidenceBadges({ risk: { level: "high" }, confidence: { level: "low" } });
    expect(b.map((x) => x.label)).toEqual(["Risk high", "Confidence low"]);
    expect(b[0].className).toMatch(/rose/);
    expect(b[1].className).toMatch(/rose/);
    const ok = riskConfidenceBadges({ risk: { level: "low" }, confidence: { level: "high" } });
    expect(ok[0].className).toMatch(/emerald/);
    expect(ok[1].className).toMatch(/emerald/);
    expect(riskConfidenceBadges({})).toEqual([]);
    expect(riskConfidenceBadges(null)).toEqual([]);
  });
});

