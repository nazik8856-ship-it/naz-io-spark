// Outer Control brain, round 2: how sure the decision is, how risky the situation is, why it was
// decided that way, what earlier human corrections say about similar text, and whether the final
// result still answers the original goal. Everything here is pure; the brain (`think`) and the
// session driver call it and store the results.
import type { RuleHit } from "./outer-control-brain.ts";

export type Level = "low" | "medium" | "high";
const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };
const maxLevel = (a: Level, b: Level): Level => (RANK[b] > RANK[a] ? b : a);
const minLevel = (a: Level, b: Level): Level => (RANK[b] < RANK[a] ? b : a);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------------------------------
// Risk classification

export type Risk = { level: Level; reasons: string[] };

/** Categories where a leak or an action cannot be taken back. */
const HIGH_IMPACT_CATEGORIES = new Set(["secrets", "pii", "destructive", "recipients"]);

const AMOUNT = /(?:[$€£]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:usd|eur|gbp|dollars|euros|pounds)\b)/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
export const AMOUNT_THRESHOLD = 500;

/** Largest money amount mentioned in the text (0 when none). */
export function largestAmount(text: string): number {
  let best = 0;
  for (const m of text.matchAll(AMOUNT)) {
    const n = Number((m[1] ?? m[2]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

/**
 * Low / medium / high, from the rules that matched and from the content.
 *   high    a blocking rule matched; text that cannot be taken back (secrets, personal data,
 *           destructive wording, recipients) had to be removed; or a rule keeps being broken in this task
 *   medium  a rule needs a person's approval; other text had to be removed; or the text mentions
 *           a large amount of money or an email address although no rule matched
 *   low     nothing matched and the content shows none of those signals
 */
export function classifyRisk(i: { hits: RuleHit[]; content: string; ruleOutcomes: Record<string, { blocked: number }> }): Risk {
  let level: Level = "low";
  const reasons: string[] = [];
  const raise = (to: Level, why: string) => { level = maxLevel(level, to); if (!reasons.includes(why)) reasons.push(why); };

  for (const h of i.hits) {
    if (h.effect === "block") raise("high", `"${clip(h.name, 60)}" is a blocking rule`);
    else if (h.effect === "redact") {
      if (HIGH_IMPACT_CATEGORIES.has(h.category)) raise("high", `text that cannot be taken back (${h.category}) had to be removed`);
      else raise("medium", `text matching "${clip(h.name, 60)}" had to be removed`);
    } else raise("medium", `"${clip(h.name, 60)}" needs a person's approval`);
    if ((i.ruleOutcomes[h.name]?.blocked ?? 0) >= 2) raise("high", `"${clip(h.name, 60)}" was already broken ${i.ruleOutcomes[h.name].blocked} times in this task`);
  }
  if (!i.hits.length) {
    const amount = largestAmount(i.content);
    if (amount >= AMOUNT_THRESHOLD) raise("medium", `the text mentions an amount of ${amount.toLocaleString("en-US")}`);
    if (EMAIL.test(i.content)) raise("medium", "the text contains an email address");
  }
  if (!reasons.length) reasons.push("no rule matched and the content shows no sensitive signal");
  return { level, reasons };
}

// ---------------------------------------------------------------------------------------
// Learning from human corrections

/** What is stored about a person's decision on an earlier reply: never the text, only hashes of its words. */
export type Correction = {
  outcome: "approved" | "declined" | "edited";
  rule_ids: string[];
  rule_names: string[];
  fingerprint: number[];
};

const FP_SIZE = 64;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) & 0x7fffffff;
}

/** A small word-overlap fingerprint: the 64 smallest hashes of the text's 3-word windows. */
export function fingerprintOf(text: string): number[] {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const shingles = words.length < 3 ? words : words.slice(0, words.length - 2).map((_, k) => words.slice(k, k + 3).join(" "));
  return [...new Set(shingles.map(fnv1a))].sort((a, b) => a - b).slice(0, FP_SIZE);
}

/** Jaccard overlap of two fingerprints, 0 to 1. */
export function similarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const x of new Set(b)) if (sa.has(x)) inter++;
  const union = sa.size + new Set(b).size - inter;
  return union ? inter / union : 0;
}

/** Same rule and fairly similar text, or very similar text on its own. */
export const SIMILAR_WITH_RULE = 0.4;
export const SIMILAR_ALONE = 0.75;

export type Learned = {
  approved: number;
  declined: number;
  edited: number;
  /** Declines outnumber approvals for similar replies: the brain sends this one to a person. */
  tighten: boolean;
  lines: string[];
};

export function learnedSignal(i: { corrections: Correction[]; fingerprint: number[]; hitIds: string[]; hitNames: string[] }): Learned {
  const out: Learned = { approved: 0, declined: 0, edited: 0, tighten: false, lines: [] };
  for (const c of i.corrections) {
    const sim = similarity(c.fingerprint, i.fingerprint);
    const sameRule = c.rule_ids.some((id) => i.hitIds.includes(id)) || c.rule_names.some((n) => i.hitNames.includes(n));
    if (!((sameRule && sim >= SIMILAR_WITH_RULE) || sim >= SIMILAR_ALONE)) continue;
    out[c.outcome]++;
  }
  const times = (n: number) => `${n} similar repl${n === 1 ? "y" : "ies"}`;
  if (out.approved) out.lines.push(`A person approved ${times(out.approved)} before.`);
  if (out.declined) out.lines.push(`A person declined ${times(out.declined)} before.`);
  if (out.edited) out.lines.push(`A person had to rewrite ${times(out.edited)} before.`);
  // Learning only ever tightens: a decline outweighing approvals sends this reply to a person.
  // Approvals are shown, but never let a reply through by themselves.
  out.tighten = out.declined > out.approved;
  return out;
}

// ---------------------------------------------------------------------------------------
// Confidence

export type Confidence = { level: Level; reasons: string[] };

export type ConfidenceInput = {
  verdict: string;
  foundationVerdict: string;
  hits: RuleHit[];
  conflicts: string[];
  /** The decision was tightened by this task's earlier decisions. */
  tightened: boolean;
  /** Text had to be removed but the removal could not be proven, so the reply was blocked. */
  removalFailed: boolean;
  shadowMatches: number;
  contentLength: number;
  /** Rules fired earlier in this task. */
  priorConcerns: boolean;
  learned: Learned;
  /** A hard rule or kill switch decided it directly (no pattern involved). */
  decidedByHardRule: boolean;
};

export const LONG_REPLY = 3000;

/** How far the decision can be trusted to stand without a person looking at it. */
export function scoreConfidence(i: ConfidenceInput): Confidence {
  let level: Level = "high";
  const reasons: string[] = [];
  const lower = (to: Level, why: string) => { level = minLevel(level, to); reasons.push(why); };

  if (i.removalFailed) lower("low", "text had to be removed but the removal could not be proven, so the reply was blocked");
  if (i.learned.declined > 0) lower("low", "a person declined similar replies before");
  if (i.learned.edited > 0) lower("medium", "a person had to rewrite a similar reply before");
  if (i.tightened) lower("medium", "this task's earlier decisions tightened the result");
  if (i.conflicts.length) lower("medium", "the matched rules asked for different outcomes");
  if (i.shadowMatches > 0) lower("medium", `${i.shadowMatches} observe-only rule${i.shadowMatches === 1 ? "" : "s"} also matched`);
  if (i.verdict === "allow") {
    if (i.priorConcerns) lower("medium", "rules fired earlier in this task");
    if (i.contentLength > LONG_REPLY) lower("medium", "the reply is long and only rule patterns were checked");
  }
  if (!reasons.length) {
    reasons.push(i.decidedByHardRule ? "a hard rule decided this directly"
      : i.hits.length ? `decided directly by "${clip(i.hits[0].name, 60)}"`
        : "no rule matched and nothing earlier in this task raised a concern");
  }
  return { level, reasons };
}

/** A person must look at it when the situation is high-risk and the decision is not trustworthy. */
export const needsCare = (risk: Risk, confidence: Confidence) => risk.level === "high" && confidence.level === "low";

// ---------------------------------------------------------------------------------------
// Reasoning trace

const VERDICT_WORD: Record<string, string> = { allow: "Allow", modify: "Modify", block: "Block", escalate: "Escalate" };
const EFFECT_WORD: Record<string, string> = { block: "block", approval: "require approval", redact: "remove text" };

export type TraceInput = {
  verdict: string;
  foundationVerdict: string;
  winner: RuleHit | null;
  overridden: { rule: RuleHit; reason: string }[];
  changesText: string;
  guard: string[];
  learned: Learned;
  risk: Risk;
  confidence: Confidence;
  escalatedForCare: boolean;
  escalatedByLearning: boolean;
};

/** Up to nine short lines: what was decided, by which rule, what overrode what, what earlier tasks taught, risk, confidence. */
export function buildTrace(t: TraceInput): string[] {
  const lines: string[] = [];
  const word = VERDICT_WORD[t.verdict] ?? t.verdict;
  lines.push(t.verdict === t.foundationVerdict ? `Decision: ${word}.` : `Decision: ${word} (the base check said ${VERDICT_WORD[t.foundationVerdict] ?? t.foundationVerdict}).`);
  if (t.winner) lines.push(`Decided by "${clip(t.winner.name, 80)}" (${t.winner.scope} rule: ${EFFECT_WORD[t.winner.effect]}).`);
  for (const o of t.overridden.slice(0, 2)) lines.push(`Overrode "${clip(o.rule.name, 60)}": ${o.reason}.`);
  if (t.changesText) lines.push(t.changesText);
  for (const g of t.guard.slice(0, 2)) lines.push(g);
  for (const l of t.learned.lines) lines.push(l);
  if (t.escalatedByLearning) lines.push("Because declines outnumber approvals for similar replies, a person must approve this one.");
  lines.push(`Risk: ${t.risk.level} — ${t.risk.reasons.slice(0, 2).join("; ")}.`);
  lines.push(`Confidence: ${t.confidence.level} — ${t.confidence.reasons.slice(0, 2).join("; ")}.`);
  if (t.escalatedForCare) lines.push("Because confidence is low and risk is high, a person must approve this reply.");
  return lines.slice(0, 9).map((l) => clip(l, 240));
}

// ---------------------------------------------------------------------------------------
// Goal alignment (the check before a loop finishes)

const STOPWORDS = new Set((
  "that this with from have will your about what which their there would could should please been being were they them then than " +
  "into onto over under also just only more most some such very when where while whom whose these those here does doing done " +
  "write draft make create give tell show list explain summarise summarize describe provide generate send reply help find need want " +
  "using used use like just kindly"
).split(" "));

/** Up to 8 content words of the objective (task verbs and filler excluded). */
export function salientTerms(objective: string): string[] {
  const words = objective.toLowerCase().replace(/\[[^\]]*\]/g, " ").match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))].slice(0, 8);
}

const WORD_LIMIT = [
  /\b(?:at most|no more than|maximum of|maximum|max|under|within|up to|fewer than|less than)\s+(\d{1,4})\s+words?\b/i,
  /\b(\d{1,4})\s+words?\s+(?:or\s+)?(?:fewer|less|max|maximum)\b/i,
];
const FORBIDDEN = /\b(?:do not|don't|never|without)\s+(?:mention(?:ing)?|say(?:ing)?|includ(?:e|ing)|us(?:e|ing))\s+["“']([^"”']{2,60})["”']/gi;

export const MIN_TOPIC_CHECK_CHARS = 60;
export const MIN_TOPIC_TERMS = 3;

export type GoalCheck = { ok: boolean; problems: string[] };

/**
 * Does the final text still answer the original goal? Deterministic checks only:
 *   - a word limit stated in the goal ("at most 80 words") is kept
 *   - a quoted phrase the goal forbids ("do not mention "X"") is absent
 *   - a reply of some length shares at least one key term with a goal that has several
 * It catches an off-topic, over-long or forbidden-phrase result; it does not judge quality.
 */
export function checkGoal(objective: string, text: string): GoalCheck {
  const problems: string[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  for (const re of WORD_LIMIT) {
    const m = objective.match(re);
    if (m) {
      const limit = Number(m[1]);
      if (words > limit) problems.push(`The result has ${words} words but the goal asks for at most ${limit}.`);
      break;
    }
  }
  const lower = text.toLowerCase();
  for (const m of objective.matchAll(FORBIDDEN)) {
    if (lower.includes(m[1].toLowerCase())) problems.push(`The result mentions "${m[1]}", which the goal says not to.`);
  }
  const terms = salientTerms(objective);
  if (terms.length >= MIN_TOPIC_TERMS && text.trim().length >= MIN_TOPIC_CHECK_CHARS) {
    const stems = terms.map((t) => (t.length > 5 ? t.slice(0, 5) : t));
    if (!stems.some((s) => lower.includes(s))) problems.push(`The result does not mention any key term of the goal (${terms.slice(0, 4).join(", ")}).`);
  }
  return { ok: problems.length === 0, problems };
}
