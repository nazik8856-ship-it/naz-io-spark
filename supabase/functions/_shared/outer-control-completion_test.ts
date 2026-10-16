// Run with: deno test supabase/functions/_shared/outer-control-completion_test.ts
import { assessOutput, buildChecklist, correctionFor, passedCount, settle, type ChecklistInput } from "./outer-control-completion.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const OBJ = "Summarise the returns policy for premium customers";
const GOOD = "Premium customers can return items within thirty days of delivery, free of charge.";

const base = (o: Partial<ChecklistInput> = {}): ChecklistInput => ({
  now: "2026-10-20T00:00:00.000Z", toolStatus: "done", stepNo: 2,
  exchanges: [{ step_no: 1, attempt: 1, error: null }, { step_no: 2, attempt: 1, error: null }],
  approval: null, openPending: false, text: GOOD, objective: OBJ, brokenRules: [], goal: { ok: true, problems: [] },
  fromPerson: false, stored: { text: GOOD }, outputSha256: "a".repeat(64), ...o,
});
const get = (c: ReturnType<typeof buildChecklist>, id: string) => c.criteria.find((x) => x.id === id)!;

Deno.test("checklist: the eight criteria are fixed and in order", () => {
  const c = buildChecklist(base());
  assertEquals(c.criteria.map((x) => x.id), ["tool_finished", "steps_accounted", "nothing_pending", "output_present", "output_useful", "rules_kept", "goal_matched", "output_stored"]);
  assertEquals(c.outcome, "completed"); assert(c.passed, "all met"); assertEquals(passedCount(c), "8/8");
});

Deno.test("checklist: plain text with no status is read as done; continue / need_info are not", () => {
  assert(buildChecklist(base({ toolStatus: null })).passed, "null status is plain text");
  assertEquals(get(buildChecklist(base({ toolStatus: "continue" })), "tool_finished").ok, false);
  assertEquals(buildChecklist(base({ toolStatus: "need_info" })).passed, false);
});

Deno.test("checklist: a missing step record, or an error on the closing exchange, fails steps_accounted -> failed", () => {
  const missing = buildChecklist(base({ exchanges: [{ step_no: 2, attempt: 1, error: null }] }));
  assertEquals(get(missing, "steps_accounted").ok, false);
  assert(get(missing, "steps_accounted").detail.includes("step 1"), "names the step");
  assertEquals(missing.outcome, "failed");
  const err = buildChecklist(base({ exchanges: [{ step_no: 1, attempt: 1, error: null }, { step_no: 2, attempt: 1, error: "HTTP 500" }] }));
  assertEquals(get(err, "steps_accounted").ok, false);
  assertEquals(buildChecklist(base({ stepNo: 0, exchanges: [] })).passed, false);
});

Deno.test("checklist: an earlier failed attempt does not matter once the last exchange of the step is clean", () => {
  const c = buildChecklist(base({ exchanges: [{ step_no: 1, attempt: 1, error: null }, { step_no: 2, attempt: 1, error: "HTTP 503" }, { step_no: 2, attempt: 2, error: null }] }));
  assert(c.passed, "retried then fine");
});

Deno.test("checklist: an approval that is not granted, or an open question, fails nothing_pending", () => {
  assertEquals(get(buildChecklist(base({ approval: { status: "pending" } })), "nothing_pending").ok, false);
  assertEquals(get(buildChecklist(base({ approval: { status: "rejected" } })), "nothing_pending").ok, false);
  assert(buildChecklist(base({ approval: { status: "approved" } })).passed, "approved");
  assert(buildChecklist(base({ approval: { status: "auto_approved" } })).passed, "auto approved");
  assertEquals(get(buildChecklist(base({ openPending: true })), "nothing_pending").ok, false);
});

Deno.test("checklist: no result, or an unusable one, asks for a retry (not a completion) and leaves output_stored unevaluated", () => {
  for (const text of [null, "", "   ", "N/A", "null", "OK", "{}", "[REDACTED:secrets]", OBJ]) {
    const c = buildChecklist(base({ text, stored: null }));
    assertEquals(c.passed, false, `text ${JSON.stringify(text)} must not complete`);
    assertEquals(c.outcome, "retry");
    assertEquals(get(c, "output_stored").ok, null);
  }
});

Deno.test("checklist: a broken blocking rule is 'blocked', whatever else is true", () => {
  const c = buildChecklist(base({ brokenRules: ["Card number"] }));
  assertEquals(c.outcome, "blocked"); assertEquals(get(c, "rules_kept").ok, false);
});

Deno.test("checklist: goal not met is a retry; a person's decision skips the goal and usefulness checks but not emptiness", () => {
  const off = buildChecklist(base({ goal: { ok: false, problems: ["The result does not mention any key term of the goal (returns)."] }, stored: null }));
  assertEquals(off.outcome, "retry");
  assert(get(off, "goal_matched").detail.includes("key term"), "detail names the problem");
  const person = buildChecklist(base({ text: "N/A", stored: { text: "N/A" }, fromPerson: true, goal: null }));
  assert(person.passed, "a person decided it");
  assertEquals(buildChecklist(base({ text: "  ", stored: null, fromPerson: true, goal: null })).passed, false);
});

Deno.test("checklist: the stored copy must be read back and identical", () => {
  assertEquals(get(buildChecklist(base({ stored: null })), "output_stored").ok, null, "not stored yet");
  assertEquals(buildChecklist(base({ stored: null })).passed, false, "an unfinished check is not a pass");
  const diff = buildChecklist(base({ stored: { text: GOOD + " (changed)" } }));
  assertEquals(get(diff, "output_stored").ok, false); assertEquals(diff.outcome, "failed");
  assertEquals(get(buildChecklist(base({ stored: { text: null } })), "output_stored").ok, false);
});

Deno.test("settle: a retry becomes needs_attention once the retry was used; other outcomes are untouched", () => {
  const retry = buildChecklist(base({ text: "N/A", stored: null }));
  assertEquals(settle(retry, true).outcome, "retry");
  assertEquals(settle(retry, false).outcome, "needs_attention");
  const failed = buildChecklist(base({ exchanges: [] }));
  assertEquals(settle(failed, false).outcome, "failed");
});

Deno.test("correctionFor: tells the tool what was missing", () => {
  assert(correctionFor(buildChecklist(base({ text: "N/A", stored: null }))).startsWith("Your previous reply had no usable result"), "unusable");
  assert(correctionFor(buildChecklist(base({ goal: { ok: false, problems: ["Off topic."] }, stored: null }))).includes("does not match the goal"), "goal");
});

Deno.test("assessOutput: what counts as nothing useful", () => {
  const no = (t: string | null, why: string) => { const u = assessOutput(t, OBJ); assert(!u.usable, `${JSON.stringify(t)} should be unusable`); assertEquals(u.code, why); };
  no("", "empty"); no("   ", "empty"); no("[REDACTED:pii] [REDACTED:secrets]", "empty"); no("...", "empty");
  no("{}", "empty"); no("N/A", "placeholder"); no("none", "placeholder"); no("Done", "placeholder"); no("null", "placeholder");
  no('{"status":"done"}', "status_only"); no('{"status":"done","answer":"  "}', "status_only");
  no("I'm sorry, but I can't help with that.", "refusal"); no("I cannot assist with this request.", "refusal"); no("As an AI language model, I do not have opinions.", "refusal");
  no("Error: upstream request failed", "error_text"); no("Internal Server Error", "error_text"); no("Rate limit exceeded, retry later", "error_text");
  no("summarise the RETURNS policy for premium customers!", "echo");
});

Deno.test("assessOutput: real answers are not flagged", () => {
  for (const t of [
    GOOD, "Yes", "No", "42", "Paris",
    '{"status":"done","answer":"Returns are free within thirty days."}',
    "I can't give you the exact figure, but premium customers typically get thirty days to return items and a full credit to their original payment method, " +
      "which usually appears within five business days of the parcel being scanned back into the warehouse. See the policy page for exceptions.",
    "The error rate fell to 2% after the fix.",
  ]) assert(assessOutput(t, OBJ).usable, `${t.slice(0, 40)} should be usable`);
});
