// Run with: deno test --no-check supabase/functions/_shared/outer-control-clarify_test.ts
// The clarifying step (docs/outer-control-context.md): ask only what nothing already says, only where the situation matters, at most 3.
import { clarifyingQuestions, CLARIFY_KINDS, CLARIFY_QUESTIONS, missingQuestions } from "./outer-control-clarify.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("what is missing is worked out whatever action NazAI read, so a person who picks Research by hand still gets the questions", () => {
  const req = { request: "How should a small AI startup get its first 10 paying customers?" };
  // "startup" says the stage; nothing says who it is for or the main limit.
  assert(missingQuestions(req).map((q) => q.id).join(",") === "audience,constraint", missingQuestions(req).map((q) => q.id).join(","));
  assert(clarifyingQuestions({ ...req, kind: "explain" }).length === 0, "an action that needs no situation still asks nothing");
  assert(CLARIFY_KINDS.includes("research") && !CLARIFY_KINDS.includes("rewrite"), "the page is told which actions they apply to");
});
const ids = (i: Parameters<typeof clarifyingQuestions>[0]) => clarifyingQuestions(i).map((q) => q.id).join(",");

Deno.test("a bare request with nothing known gets all three questions", () => {
  assert(ids({ kind: "research", request: "How do I find more customers?" }) === "stage,audience,constraint", ids({ kind: "research", request: "How do I find more customers?" }));
});

Deno.test("what the request already says is not asked", () => {
  assert(ids({ kind: "decision", request: "We launched 2 years ago. Should we sell to small businesses in Austria with a budget of 500 EUR a month?" }) === "", "nothing to ask");
  assert(ids({ kind: "opinions", request: "How should a startup find customers in Berlin?" }) === "constraint", "stage and audience are said");
});

Deno.test("what NazAI already knows is not asked: the business line, an audience, a limit in the notes or a saved answer", () => {
  const brief = "What NazAI knows about the person asking.\nBusiness: Lumen Candles. Hand-poured soy candles. Audience: gift buyers in Germany.\nTheir own notes: budget of 300 euros a month.";
  assert(ids({ kind: "research", request: "How do I find more customers?", brief }) === "", ids({ kind: "research", request: "How do I find more customers?", brief }));
  const saved = "Standing facts and instructions they wrote:\n- Stage of the business: first 10 customers\n- Who it is for: yoga teachers\n- Main limit: 2 people";
  assert(ids({ kind: "research", request: "How do I find more customers?", brief: saved }) === "", "answers kept from an earlier Task count");
});

Deno.test("the background counts too", () => {
  assert(ids({ kind: "compare", request: "Best channel to promote our app?", background: "Pre-launch MVP. For busy parents. Solo founder." }) === "", "all said in the background");
});

Deno.test("actions that do not depend on the situation ask nothing", () => {
  for (const kind of ["rewrite", "explain", "keypoints", "factcheck", "roles", "adapt", "alternatives", "draft", "unclear"] as const) {
    assert(clarifyingQuestions({ kind, request: "How do I find more customers?" }).length === 0, kind);
  }
});

Deno.test("each question says why it is asked and how the answer is written", () => {
  for (const q of Object.values(CLARIFY_QUESTIONS)) assert(q.question.endsWith("?") && q.why.length > 20 && q.placeholder.startsWith("e.g.") && q.label, q.id);
});
