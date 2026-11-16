// Outer Control: a short clarifying step before a Task runs (docs/outer-control-context.md). A tool asked "how do I find more
// customers?" by someone it knows nothing about gives the answer for anybody. When neither the request, its background nor what NazAI
// already knows (the context brief) says the business's stage, who it is for, or its main limit, NazAI asks those, at most three
// short questions, before the Task starts. Every answer is optional; the Task never waits for them. Pure, no dependencies.
import type { ReportKind } from "./outer-control-report-doc.ts";

export type ClarifyId = "stage" | "audience" | "constraint";
/** label: how the answer is written into the Task's background and, when kept, into the knowledge base ("<label>: <answer>"). */
export type ClarifyQuestion = { id: ClarifyId; question: string; why: string; placeholder: string; label: string };

/** The actions whose answer depends on the person's situation. A rewrite, an explanation or a fact-check does not need it. */
export const CLARIFY_KINDS: readonly ReportKind[] = ["opinions", "research", "compare", "decision", "multistep", "delegate"];
export const MAX_ANSWER_CHARS = 160;

export const CLARIFY_QUESTIONS: Record<ClarifyId, ClarifyQuestion> = {
  stage: {
    id: "stage", label: "Stage of the business", question: "What stage is the business at?",
    why: "Advice for an idea and for a business with steady sales is different.", placeholder: "e.g. idea only · first 10 customers · 3 years in, steady sales",
  },
  audience: {
    id: "audience", label: "Who it is for", question: "Who is it for?",
    why: "So the answer speaks to your real buyers or readers, not to everyone.", placeholder: "e.g. gift buyers in Germany · small accounting firms",
  },
  constraint: {
    id: "constraint", label: "Main limit", question: "What is the main limit: money, time or people?",
    why: "So every recommendation fits what you can actually do.", placeholder: "e.g. 300 EUR a month · 2 people · launch by March",
  },
};

// What already answers each question. The brief's own labels count too ("Audience: …", "Stage of the business: …").
const STAGE = /\b(?:stage of the business|idea(?:\s+stage)?|pre-?launch|launch(?:ed|ing)?|start-?up|mvp|prototype|early[- ]stage|founded|established|existing (?:business|company|shop|store)|(?:first|our)\s+\d+\s+(?:customers|clients|users)|\d+\s+(?:years?|months?)\s+(?:in|old|of trading|running)|revenue|turnover|profitable|scal(?:e|ing)|growing)\b/i;
// A bare "customers" does not say who they are: an audience is named ("Audience: …", B2B, students) or qualified ("customers in Berlin").
const AUDIENCE = /\b(?:who it is for|audience\s*[:\-]|target (?:audience|market|customers?|group)|aimed at|b2b|b2c|smes?|small business(?:es)?|freelancers?|students?|parents?|families|teachers?|doctors?|nurses?|developers?|retirees|pensioners|teenagers?|(?:customers?|clients?|users?|buyers?|readers?|shoppers?|visitors?|subscribers?|patients?)\s+(?:in|from|who|aged|at|across|that|of|between)\b|for (?:small|local|young|older|busy|new|first-time)\s+\w)/i;
const CONSTRAINT = /(?:[$€£]\s?\d|\d\s?(?:k|eur|euros?|usd|dollars?|gbp|pounds?)\b|\b(?:main limit|budget|deadline|by (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|within \d+\s+(?:days?|weeks?|months?)|\d+\s+(?:hours?|days?|weeks?|months?)\b|\d+\s+(?:people|persons?|employees|staff|developers?)|team of \d+|solo|on my own|part[- ]time|no money|free tools?|cheap|low[- ]cost)\b)/i;

/**
 * The questions worth asking before this Task runs: only for the actions whose answer depends on the situation, only what neither the
 * request, its background nor what NazAI already knows answers, and at most three. Empty: nothing to ask.
 */
export function clarifyingQuestions(i: { kind: ReportKind | "unclear"; request: string; background?: string | null; brief?: string | null }): ClarifyQuestion[] {
  if (i.kind === "unclear" || !CLARIFY_KINDS.includes(i.kind)) return [];
  return missingQuestions(i);
}

/**
 * What nothing says yet, whatever the action: the page shows these for any action in CLARIFY_KINDS, including one the person picks by
 * hand after NazAI read the request as something else (route_task returns them with the list of actions they apply to).
 */
export function missingQuestions(i: { request: string; background?: string | null; brief?: string | null }): ClarifyQuestion[] {
  const said = [i.request, i.background ?? "", i.brief ?? ""].join("\n");
  const out: ClarifyQuestion[] = [];
  // The brief's business line ("Business: Lumen Candles. Hand-poured …") already says what the business is and how far along.
  if (!STAGE.test(said) && !/^Business: /m.test(i.brief ?? "")) out.push(CLARIFY_QUESTIONS.stage);
  if (!AUDIENCE.test(said)) out.push(CLARIFY_QUESTIONS.audience);
  if (!CONSTRAINT.test(said)) out.push(CLARIFY_QUESTIONS.constraint);
  return out.slice(0, 3);
}
