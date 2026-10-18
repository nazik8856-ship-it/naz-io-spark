// Run with: deno test supabase/functions/_shared/outer-control-task_test.ts
import { chainLegs, contextFromHandoffs, deriveTaskState, makeHandoff, originContext, readAgentRun, type TaskLeg } from "./outer-control-task.ts";
import { rollupStatus, validateLegs } from "./outer-control-workflow-plan.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const leg = (n: number, status: string, o: Partial<TaskLeg> = {}): TaskLeg => ({ leg_no: n, status, final_output: null, depends_on: n > 1 ? [n - 1] : [], ...o });

Deno.test("state: running chain shows the current step and the progress", () => {
  const s = deriveTaskState([leg(1, "completed", { final_output: "a" }), leg(2, "running"), leg(3, "queued")]);
  assertEquals([s.status, s.current_leg, s.steps_done, s.steps_total, s.final_output, s.failed_leg], ["running", 2, 1, 3, null, null]);
});

Deno.test("state: a step waiting for a person is the current step and the Task waits", () => {
  const s = deriveTaskState([leg(1, "completed", { final_output: "a" }), leg(2, "awaiting_human")]);
  assertEquals([s.status, s.current_leg], ["awaiting_human", 2]);
});

Deno.test("state: a completed chain's final result is the controlled output of its last step, and only then", () => {
  const done = deriveTaskState([leg(1, "completed", { final_output: "first" }), leg(2, "completed", { final_output: "second" })]);
  assertEquals([done.status, done.final_leg, done.final_output, done.current_leg], ["completed", 2, "second", null]);
  const partial = deriveTaskState([leg(1, "completed", { final_output: "first" }), leg(2, "failed", { stop_reason: "boom" })]);
  assertEquals(partial.final_output, null, "a failed Task has no final result");
});

Deno.test("state: parallel branches that join: the final result is the join's, not a branch's", () => {
  const s = deriveTaskState([
    leg(1, "completed", { final_output: "branch a", depends_on: [] }), leg(2, "completed", { final_output: "branch b", depends_on: [] }),
    leg(3, "completed", { final_output: "joined", depends_on: [1, 2] }),
  ]);
  assertEquals([s.final_leg, s.final_output], [3, "joined"]);
});

Deno.test("state: independent finished steps with no join: the highest numbered one", () => {
  const s = deriveTaskState([leg(1, "completed", { final_output: "a", depends_on: [] }), leg(2, "completed", { final_output: "b", depends_on: [] })]);
  assertEquals(s.final_leg, 2);
});

Deno.test("state: a failure names the first step that failed on its own, not the ones cancelled because of it", () => {
  const s = deriveTaskState([
    leg(1, "completed", { final_output: "a" }), leg(2, "failed", { stop_reason: "The tool answered HTTP 503." }),
    leg(3, "cancelled", { stop_reason: "A step it depends on did not finish." }),
  ]);
  assertEquals([s.status, s.failed_leg, s.stop_reason, s.steps_done], ["failed", 2, "The tool answered HTTP 503.", 1]);
});

Deno.test("state: a hand-off that was stopped is a rejected step and fails the Task with that reason", () => {
  const s = deriveTaskState([leg(1, "completed", { final_output: "x" }), leg(2, "rejected", { stop_reason: "The result of step 1 breaks No codename, so it was not passed to step 2." })]);
  assertEquals([s.status, s.failed_leg], ["failed", 2]); assert(/No codename/.test(s.stop_reason ?? ""), "reason kept");
});

Deno.test("state: cancelled by the owner is cancelled, not failed (also for one step)", () => {
  assertEquals(deriveTaskState([leg(1, "cancelled", { stop_reason: "Cancelled by the owner." })]).status, "cancelled");
  const s = deriveTaskState([leg(1, "cancelled", { stop_reason: "Cancelled by the owner." }), leg(2, "cancelled", { stop_reason: "A step it depends on did not finish." })]);
  assertEquals([s.status, s.final_output], ["cancelled", null]);
  assertEquals(rollupStatus([leg(1, "cancelled", { stop_reason: "The tool was removed." })]).status, "failed", "any other cancellation is still a failure");
});

Deno.test("chain: each step waits for the one before and a chain ends instead of waiting for a person unless told otherwise", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const c = chainLegs([{ tool_id: T, instruction: "a" }, { tool_id: T, instruction: "b" }, { tool_id: T, instruction: "c", on_failure: "handoff" }]);
  assert(c.ok, "ok"); if (!c.ok) return;
  assertEquals(c.legs.map((l) => l.depends_on), [[], [1], [2]]); assertEquals(c.legs.map((l) => l.on_failure), ["reject", "reject", "handoff"]);
  const checked = validateLegs(c.legs); assert(checked.ok, "the chain passes the same validation as any workflow");
  assertEquals(chainLegs([]).ok, false); assertEquals(chainLegs("x").ok, false);
});

Deno.test("hand-off: passed unchanged, with the sender named, and logged as such", () => {
  const h = makeHandoff({ from_leg: 1, from_label: "Research Bot", to_leg: 2, text: "Thirty days.", check: { blocked: [], changed: [], cleaned: "Thirty days." }, maxChars: 1000 });
  assertEquals([h.outcome, h.rules, h.from_leg, h.to_leg], ["passed", [], 1, 2]);
  assertEquals(h.text, "Step 1 (Research Bot), checked by Outer Control:\nThirty days.");
});

Deno.test("hand-off: text a rule removes is handed over without it, naming the rule", () => {
  const h = makeHandoff({ from_leg: 1, from_label: "Bot", to_leg: 2, text: "Call Ann on 555", check: { blocked: [], changed: ["Phone numbers"], cleaned: "Call Ann on [REDACTED:pii]" }, maxChars: 1000 });
  assertEquals([h.outcome, h.rules], ["modified", ["Phone numbers"]]); assert(h.text.endsWith("Call Ann on [REDACTED:pii]") && !h.text.includes("555"), "cleaned text only");
});

Deno.test("hand-off: a blocking rule stops it: no text is passed", () => {
  const h = makeHandoff({ from_leg: 2, from_label: "Bot", to_leg: 3, text: "secret plan", check: { blocked: ["No codename"], changed: [], cleaned: "secret plan" }, maxChars: 1000 });
  assertEquals([h.outcome, h.text, h.rules], ["blocked", "", ["No codename"]]); assert(h.note.includes("step 2") && h.note.includes("step 3") && h.note.includes("No codename"), "the note says what and why");
});

Deno.test("hand-off: very long results are shortened to the limit; context is task context first, then hand-offs", () => {
  const long = "x".repeat(5000);
  const h = makeHandoff({ from_leg: 1, from_label: "Bot", to_leg: 2, text: long, check: { blocked: [], changed: [], cleaned: long }, maxChars: 300 });
  assert(h.text.length < 400, "shortened");
  const ctx = contextFromHandoffs("Customer: Dana", [h]);
  assert(ctx !== null && ctx.startsWith("Customer: Dana\n\nStep 1 (Bot)"), "task context first");
  assertEquals(contextFromHandoffs(null, []), null);
  assertEquals(contextFromHandoffs(null, [makeHandoff({ from_leg: 1, from_label: "B", to_leg: 2, text: "t", check: { blocked: ["R"], changed: [], cleaned: "t" }, maxChars: 100 })]), null, "a blocked hand-off contributes nothing");
});

Deno.test("origin: an external agent's controlled text is labelled as handed over", () => {
  assertEquals(originContext({ kind: "external_agent", source_model: "ChatGPT", evaluation_id: null, controlled_text: "hello", verdict: "allow" }), "Handed over by ChatGPT, checked by Outer Control:\nhello");
});

Deno.test("agent run: only the agent's own summary is the result; every other outcome says why there is none", () => {
  assertEquals(readAgentRun({ runId: "r", summary: "  Done: sent 3 emails.  ", goal_met: true }), { ok: true, text: "Done: sent 3 emails.", runId: "r" });
  assertEquals(readAgentRun({ paused: true, summary: "x" }), { ok: false, code: "agent_paused" });
  assertEquals(readAgentRun({ skipped: true, reason: "already running" }), { ok: false, code: "agent_skipped" });
  assertEquals(readAgentRun({ creditsExhausted: true, summary: "x" }), { ok: false, code: "agent_credits_exhausted" });
  assertEquals(readAgentRun({ error: "boom" }), { ok: false, code: "agent_error" });
  assertEquals(readAgentRun({ summary: "   " }), { ok: false, code: "agent_no_result" });
  assertEquals(readAgentRun("text"), { ok: false, code: "agent_no_result" });
  assertEquals(readAgentRun(null), { ok: false, code: "agent_no_result" });
});
