// Run with: deno test --no-check supabase/functions/_shared/outer-control-report-instructions_test.ts
// What every tool is asked (docs/outer-control-context.md): positive requirements, and an answer long enough to be useful.
import { ANSWER_WORDS, MAX_OPINION_CHARS, opinionInstruction, stepInstructionFor } from "./outer-control-report.ts";

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
  assert(r.includes("if there is none, say what you would need to know"), "it also works when no context is given");
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
