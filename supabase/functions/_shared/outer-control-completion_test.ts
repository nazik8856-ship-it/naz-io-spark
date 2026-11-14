// Run with: deno test supabase/functions/_shared/outer-control-completion_test.ts
import { assessOutput, buildChecklist, correctionFor, passedCount, settle, stripFiller, tidyOutput, type ChecklistInput } from "./outer-control-completion.ts";

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

Deno.test("assessOutput: a placeholder with punctuation is still a placeholder", () => {
  for (const t of ["Done.", "OK!", "Success.", "Completed!!", "Okay…", "N/A."]) {
    const u = assessOutput(t, "Write a summary");
    if (u.usable || u.code !== "placeholder") throw new Error(`${t} should be a placeholder, got ${JSON.stringify(u)}`);
  }
  if (!assessOutput("Done. Refunds are paid within 14 days.", "Write a summary").usable) throw new Error("a real answer that starts with 'Done.' is usable");
});

// ---------------------------------------------------------------------------------------
// The quality floor (task 3)

const WORDS_60 = "Premium customers return items within thirty days of delivery and receive a full credit to the original payment method within five business days. " +
  "Items must be unused and in the original packaging, and the return label is free for orders above 50 EUR. ";

Deno.test("quality: only pleasantries is not a result", () => {
  for (const t of ["Certainly! I hope this helps.", "Sure! Here's the report:\n\nLet me know if you need anything else."]) {
    const u = assessOutput(t, "Write a report on returns");
    if (u.usable || u.code !== "filler") throw new Error(`${t} should be filler, got ${JSON.stringify(u)}`);
  }
  assert(assessOutput("Yes", OBJ).usable && assessOutput("42", OBJ).usable, "a short direct answer is not filler");
  assert(assessOutput("Sure, premium customers can return items within thirty days.", OBJ).usable, "a sentence that starts with Sure and says something is content");
});

Deno.test("quality: pleasantries around a real answer are removed, the answer is untouched", () => {
  const t = `Certainly! Here's the policy:\n\n${WORDS_60}\n\nI hope this helps! Let me know if you have any questions.`;
  const s = stripFiller(t);
  assertEquals(s.removed.length, 4);
  assertEquals(s.text, WORDS_60.trim());
  assertEquals(tidyOutput(t).text, WORDS_60.trim());
  // nothing to remove -> the very same text comes back
  assertEquals(tidyOutput(WORDS_60).removed, []);
  assertEquals(tidyOutput(WORDS_60).text, WORDS_60);
  // little would remain -> left as it is (judged, not rewritten)
  assertEquals(tidyOutput("Sure! Here you go:\n\nParis.").text, "Sure! Here you go:\n\nParis.");
  // a real line in the middle is never touched
  const mid = `${WORDS_60}\nFeel free to adjust the limit in settings.\n${WORDS_60}`;
  assertEquals(tidyOutput(mid).text, mid);
});

Deno.test("quality: the same sentences again and again are sent back", () => {
  const u = assessOutput("Returns are accepted within thirty days. ".repeat(8), "Explain returns");
  if (u.usable || u.code !== "repetitive") throw new Error(JSON.stringify(u));
});

Deno.test("quality: a document was asked for and almost nothing came back", () => {
  const u = assessOutput("Returns are generally fine and customers are happy with the process.", "Write a report on our returns process");
  if (u.usable || u.code !== "thin") throw new Error(JSON.stringify(u));
  assert(u.detail.includes("report"), "the detail names what was asked for");
  // a stated length, or a request to be brief, is respected
  assert(assessOutput("Returns are generally fine.", "Write a report on returns in at most 30 words").usable, "word limit");
  assert(assessOutput("Returns are generally fine.", "Write a brief report on returns").usable, "brief");
  // a short list of real items is a checklist, not thin
  assert(assessOutput("- Check the invoice\n- Inspect the parcel\n- Refund within 5 days", "Write a checklist for returns").usable, "three list items");
  // an answer to a question is never judged thin
  assert(assessOutput("Thirty days.", "How long do premium customers have to return items?").usable, "a question");
});

Deno.test("quality: general statements with nothing concrete in them are sent back; concrete ones are not", () => {
  const fluff = "In today's fast-paced world, it is important to note that returns play a crucial role. A wide range of factors influence how companies handle them, " +
    "and various approaches exist. At the end of the day, the process matters, and it is worth noting that customers value a good experience in every part of the journey. " +
    "Companies that want to succeed should think about what customers want and how they feel about the whole experience over time and across channels, " +
    "and they should always look for ways to improve what they do so that everyone involved can benefit from a smooth and pleasant process.";
  const u = assessOutput(fluff, "Explain how returns work");
  if (u.usable || u.code !== "generic") throw new Error(JSON.stringify(u));
  assert(assessOutput(WORDS_60 + WORDS_60, "Explain how returns work").usable, "concrete details pass");
  // filler phrases with real numbers and names are fine
  assert(assessOutput(fluff + " Zalando accepts returns for 100 days and Amazon for 30 days in 2025.", "Explain how returns work").usable, "specifics outweigh the phrases");
});

Deno.test("quality: a long answer in one block is sent back to be structured", () => {
  const block = ("Premium customers return items within thirty days and receive a credit to the original payment method. " + "The warehouse scans the parcel and the refund follows. ").repeat(9).replace(/Premium/g, (m, i) => (i % 2 ? m : m));
  const varied = Array.from({ length: 40 }, (_, i) => `Step ${i + 1} concerns parcel ${1000 + i} and the customer account ${2000 + i} in the warehouse queue.`).join(" ");
  const u = assessOutput(varied, "Explain the returns process");
  if (u.usable || u.code !== "unstructured") throw new Error(JSON.stringify(u));
  assert(assessOutput(varied.replace(/\. /g, ".\n"), "Explain the returns process").usable, "the same text in lines is fine");
  assert(block.length > 0, "fixture built");
});

Deno.test("quality: a result below the floor becomes a retry with a specific correction, then a person's decision", () => {
  const c = buildChecklist(base({ text: "Certainly! I hope this helps." , objective: "Write a report on returns", stored: { text: "Certainly! I hope this helps." } }));
  assertEquals(c.outcome, "retry");
  assert(correctionFor(c).includes("pleasantries"), "the tool is told what was wrong");
  assertEquals(settle(c, false).outcome, "needs_attention");
});
