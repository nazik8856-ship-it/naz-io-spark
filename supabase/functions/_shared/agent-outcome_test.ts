// Run with: deno test --allow-none supabase/functions/_shared/agent-outcome_test.ts
import { deriveRunOutcome, type AgentEvent } from "./agent-outcome.ts";

function assertEq<T>(actual: T, expected: T, msg = ""): void {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("deriveRunOutcome: a successful delivered action is Done", () => {
  const events: AgentEvent[] = [{ kind: "action", payload: { type: "send_email", ok: true } }];
  assertEq(deriveRunOutcome(events), "Done");
});

Deno.test("deriveRunOutcome: a failed action with no recovery is Failed", () => {
  const events: AgentEvent[] = [{ kind: "action", payload: { type: "schedule_followup", ok: false } }];
  assertEq(deriveRunOutcome(events), "Failed");
});

Deno.test("deriveRunOutcome: no action delivered at all is Failed", () => {
  assertEq(deriveRunOutcome([]), "Failed");
});

Deno.test("deriveRunOutcome: an open pending_approval is Needs approval", () => {
  const events: AgentEvent[] = [{ kind: "pending_approval", payload: {} }];
  assertEq(deriveRunOutcome(events), "Needs approval");
});

Deno.test("deriveRunOutcome: a resolved approval no longer counts", () => {
  const events: AgentEvent[] = [
    { kind: "pending_approval", payload: {} },
    { kind: "approved", payload: {} },
    { kind: "action", payload: { type: "send_email", ok: true } },
  ];
  assertEq(deriveRunOutcome(events), "Done");
});

Deno.test("deriveRunOutcome: control_gate_blocked with verdict 'modify' counts as Needs approval, not Failed (regression: this was the real production mislabel)", () => {
  // The exact real event sequence from the one production run this
  // classification bug ever ran against: schedule_followup failed twice on
  // a hallucinated past date, then a third attempt was correctly held by
  // the control gate (verdict "modify", a real approval_id issued) instead
  // of executing. That run's own completion event self-reported "Failed" --
  // this fixture proves the fast-path derivation gets it right.
  const events: AgentEvent[] = [
    { kind: "action", payload: { type: "schedule_followup", ok: false } },
    { kind: "action", payload: { type: "schedule_followup", ok: false } },
    { kind: "control_gate_blocked", payload: { verdict: "modify", approval_id: "d3d5a221" } },
  ];
  assertEq(deriveRunOutcome(events), "Needs approval");
});

Deno.test("deriveRunOutcome: control_gate_blocked with a hard 'block' verdict still counts as Failed", () => {
  const events: AgentEvent[] = [
    { kind: "control_gate_blocked", payload: { verdict: "block" } },
  ];
  assertEq(deriveRunOutcome(events), "Failed");
});

Deno.test("deriveRunOutcome: an open clarification (ask_user) is Blocked", () => {
  const events: AgentEvent[] = [{ kind: "ask_user", payload: {} }];
  assertEq(deriveRunOutcome(events), "Blocked");
});

Deno.test("deriveRunOutcome: paused and step-limit flags take priority", () => {
  assertEq(deriveRunOutcome([{ kind: "action", payload: { type: "x", ok: true } }], { paused: true }), "Paused");
  assertEq(deriveRunOutcome([{ kind: "action", payload: { type: "x", ok: true } }], { hitStepLimit: true }), "Step limit");
});

Deno.test("deriveRunOutcome: credits exhausted gets its own label, not Step limit (blueprint #73 regression)", () => {
  // Before the fix, agent-runtime set hitStepLimit for ANY early break --
  // rate limit, a 402 from the AI gateway, this run's own spend ceiling --
  // not just a genuine 24-step timeout, so a run that died on step 2 for
  // lack of credits got the exact same "Step limit" label as one that
  // looped the full 24 steps.
  assertEq(
    deriveRunOutcome([{ kind: "action", payload: { type: "x", ok: true } }], { creditsExhausted: true }),
    "Credits exhausted",
  );
  // creditsExhausted takes priority even if a caller also passed hitStepLimit.
  assertEq(
    deriveRunOutcome([], { hitStepLimit: true, creditsExhausted: true }),
    "Credits exhausted",
  );
});
