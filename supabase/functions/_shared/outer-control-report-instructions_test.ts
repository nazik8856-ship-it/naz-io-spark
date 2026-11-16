// Run with: deno test --no-check supabase/functions/_shared/outer-control-report-instructions_test.ts
// What every tool is asked (docs/outer-control-context.md): positive requirements, and an answer long enough to be useful.
import { ANSWER_WORDS, challengeInstruction, MAX_OPINION_CHARS, NO_ASK, opinionInstruction, stepInstructionFor } from "./outer-control-report.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const TOPIC = "How should a two-person candle shop start selling to gift buyers in Germany?";
const words = (s: string) => s.replace(/<<<|>>>/g, " ").split(/\s+/).filter(Boolean).length;

Deno.test("no instruction asks for the old 250-word answer", () => {
  for (const k of ["compare", "factcheck", "research", "decision"] as const) assert(!/250 words|300 words|concise, around/.test(stepInstructionFor(k, TOPIC)), `${k} still asks for a short answer`);
  assert(!/250 words/.test(opinionInstruction(TOPIC)), "opinions still ask for 250 words");
});

Deno.test("each analysis action names how long a useful answer is", () => {
  assert(stepInstructionFor("research", TOPIC).includes(`Aim for ${ANSWER_WORDS.research} words.`), "research");
  assert(stepInstructionFor("compare", TOPIC).includes(`Aim for ${ANSWER_WORDS.compare} words.`), "compare");
  assert(stepInstructionFor("factcheck", TOPIC).includes(`Aim for ${ANSWER_WORDS.factcheck} words.`), "factcheck");
  assert(stepInstructionFor("decision", TOPIC).includes(`Aim for ${ANSWER_WORDS.decision} words.`), "decision");
  assert(opinionInstruction(TOPIC).includes(`Aim for ${ANSWER_WORDS.opinions} words.`), "opinions");
  assert(ANSWER_WORDS.research === "500 to 800", "research is 500 to 800 words");
});

Deno.test("the longest answer asked for fits what is kept of a tool's reply", () => {
  // 800 words are about 5,600 characters; the answer is kept whole up to MAX_OPINION_CHARS.
  assert(MAX_OPINION_CHARS >= 8000, `answers are cut at ${MAX_OPINION_CHARS} characters`);
});

Deno.test("research gives the answer a fixed shape: findings, what it means for you, assumptions, next steps", () => {
  const r = stepInstructionFor("research", TOPIC);
  for (const part of ["What this means for you", "Assumptions", "Next steps", "specific points"]) assert(r.includes(part), `research lacks "${part}"`);
  assert(r.includes("if there is none, say so in one line and carry on with stated assumptions"), "it also works when no context is given, without stopping to ask");
});

Deno.test("the requirements say what an answer must do, not only what it must not do", () => {
  for (const k of ["research", "compare", "decision"] as const) {
    const i = stepInstructionFor(k, TOPIC);
    assert(i.includes("Be specific to the situation in the context you are given"), `${k}: specific`);
    assert(i.includes('"Assumption: …"'), `${k}: assumptions`);
    assert(i.includes("Give a basis for every number, date or claim of fact"), `${k}: a basis for numbers`);
  }
  assert(stepInstructionFor("decision", TOPIC).includes("No generic advice: every recommendation says what to do, for whom, and what it would change."), "decision: no generic advice");
  assert(stepInstructionFor("factcheck", TOPIC).includes("Give a basis for every number"), "factcheck: a basis");
  assert(opinionInstruction(TOPIC).includes("what you would do in the asker's situation"), "opinions: what they would do");
});

Deno.test("the person's own text still comes first, so the completion check finds the subject's words", () => {
  assert(stepInstructionFor("research", TOPIC).startsWith(`TOPIC: ${TOPIC}`), "research");
  assert(stepInstructionFor("decision", TOPIC).startsWith(`QUESTION: ${TOPIC}`), "decision");
  assert(stepInstructionFor("compare", TOPIC).startsWith(TOPIC), "compare");
  assert(stepInstructionFor("factcheck", TOPIC).startsWith("CLAIM:"), "factcheck quotes the claim first");
});

Deno.test("the longer instruction stays short enough to be cheap: under 220 words", () => {
  for (const k of ["research", "compare", "factcheck", "decision"] as const) assert(words(stepInstructionFor(k, TOPIC)) < 220, `${k}: ${words(stepInstructionFor(k, TOPIC))} words`);
});

Deno.test("actions that are not analysis (rewrite, alternatives, explain, key points, adapt) are unchanged", () => {
  assert(!stepInstructionFor("rewrite", "Hello there", ["formal"]).includes("Aim for"), "rewrite");
  assert(!stepInstructionFor("keypoints", "Some text of some length").includes("Requirements"), "keypoints");
  assert(!stepInstructionFor("explain", "Some text of some length").includes("Assumption"), "explain");
});

// ---- one source on an action meant to compare sources ------------------------------------------------------------------------
import { buildAnalysisPrompt, buildReportDoc } from "./outer-control-report.ts";

const op = (n: number, tool: string) => ({ n, tool, text: `Answer ${n} with enough words to count as an answer.`, shortened: false, sha256: String(n).repeat(64).slice(0, 64), at: "2026-11-15T02:00:00Z" });
const analysis = { summary: "s", agreements: [], differences: [], conclusion: "c" };

Deno.test("a report built from one answer on opinions, research, fact-check or decision is marked single-source", () => {
  for (const kind of [undefined, "research", "factcheck", "decision"] as const) {
    const d = buildReportDoc({ topic: "t", at: "2026-11-15T02:01:00Z", opinions: [op(1, "ChatGPT")], analysis, extra: kind ? { kind } : {} });
    assert(d.single_source === true, `${kind ?? "opinions"} with one answer is single-source`);
  }
});

Deno.test("two answers, or an action that is not meant to compare, is not marked", () => {
  const two = buildReportDoc({ topic: "t", at: "x", opinions: [op(1, "ChatGPT"), op(2, "Claude")], analysis, extra: { kind: "research" } });
  assert(!("single_source" in two), "two answers");
  for (const kind of ["rewrite", "explain", "keypoints", "draft"] as const) {
    const d = buildReportDoc({ topic: "t", at: "x", opinions: [op(1, "ChatGPT")], analysis, extra: { kind } });
    assert(!("single_source" in d), `${kind} is a one-tool action`);
  }
});

Deno.test("the report writer is told there is one source and not to write agreement or disagreement", () => {
  const solo = buildAnalysisPrompt("t", [op(1, "ChatGPT")]);
  assert(solo.system.includes("There is only ONE source, so nothing can be cross-checked"), "one source");
  const pair = buildAnalysisPrompt("t", [op(1, "ChatGPT"), op(2, "Claude")]);
  assert(!pair.system.includes("only ONE source"), "two sources are not told that");
});

Deno.test("a tool is told not to stop and ask: NazAI asks first, and a tool that stops holds the whole Task", () => {
  for (const k of ["compare", "research", "decision"] as const) assert(stepInstructionFor(k, TOPIC).includes(NO_ASK), `${k} does not say it`);
  assert(opinionInstruction(TOPIC).includes(NO_ASK), "opinions");
  assert(challengeInstruction(TOPIC).includes(NO_ASK), "the challenger");
  assert(!stepInstructionFor("research", TOPIC).includes("say what you would need to know"), "research no longer invites questions");
  assert(NO_ASK.includes("answer anyway") && NO_ASK.includes("say what you assumed"), "it says what to do instead");
  for (const k of ["compare", "research", "decision"] as const) assert(stepInstructionFor(k, "x".repeat(600)).length <= 2000, `${k} still fits an instruction`);
});
