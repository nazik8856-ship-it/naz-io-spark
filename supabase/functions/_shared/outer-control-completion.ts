// Outer Control (active): what "Completed" means. A session is Completed only when every
// criterion below is true. The checklist is built by `buildChecklist` (pure), stored on the
// session (`completion`) and appended to `outer_control_completion_checks` for audit.
//
// The criteria, in order:
//   tool_finished     the tool's last reply said "done" (or was plain text, which is read as done)
//   steps_accounted   every step 1..N has a recorded exchange, and the last one has no error
//   nothing_pending   no approval, question or hand-off is still open for this session
//   output_present    there is a final result and it is not empty
//   output_useful     the result is not a placeholder, a refusal, an error message, a bare status or an echo of the request
//   rules_kept        the result keeps every blocking rule
//   goal_matched      the result answers the goal (or a person decided it)
//   output_stored     the stored result was read back and is identical to what was checked
//
// On top of these, a result is checked for being specific to the request (Quality, below): it uses the person's context, answers every
// part of the request, and gives concrete detail. A result that is not is sent back once with the exact gap; if it is still not, it
// completes with a visible "Partly generic" warning, never as a clean pass (docs/outer-control-completion.md).

import { parseStrictObject } from "./model-output.ts";
import { contentWords, stem, stems } from "./outer-control-words.ts";
import type { ReportKind } from "./outer-control-report-doc.ts";
export const COMPLETION_VERSION = 1;

export type CriterionId =
  | "tool_finished" | "steps_accounted" | "nothing_pending" | "output_present"
  | "output_useful" | "rules_kept" | "goal_matched" | "output_stored";

/** ok: true = met, false = not met, null = not evaluated (an earlier criterion already stopped the check). */
export type Criterion = { id: CriterionId; label: string; ok: boolean | null; detail: string };

export type Outcome =
  | "completed"        // every criterion met
  | "blocked"          // a blocking rule is broken: the result is not released
  | "retry"            // the result is unusable or off-goal: ask the tool again (once)
  | "needs_attention"  // still unusable after the retry: a person decides
  | "failed";          // a structural criterion failed (missing steps, open approval, storage)

export type Checklist = {
  version: number;
  at: string;
  outcome: Outcome;
  passed: boolean;
  criteria: Criterion[];
  /** One sentence: why it completed, or the first criterion that was not met. */
  summary: string;
  /** SHA-256 of the checked text (the text itself lives in the session's final_output). */
  output_sha256: string | null;
  /** Is the result specific to the request? Absent when no such check applies (a person's decision, NazAI's own report, a rewrite). */
  quality?: Quality;
};

const LABEL: Record<CriterionId, string> = {
  tool_finished: "The tool reported the work as done",
  steps_accounted: "Every step has a recorded exchange",
  nothing_pending: "No approval, question or hand-off is still open",
  output_present: "A final result exists",
  output_useful: "The result is usable (not a placeholder, refusal or error)",
  rules_kept: "The result keeps every blocking rule",
  goal_matched: "The result answers the goal",
  output_stored: "The stored result was read back and matches",
};
const ORDER = Object.keys(LABEL) as CriterionId[];

// ---------------------------------------------------------------------------------------
// Is the result usable?

export type Usability = {
  usable: boolean;
  code: "ok" | "empty" | "placeholder" | "refusal" | "error_text" | "status_only" | "echo" | "filler" | "repetitive" | "thin" | "generic" | "unstructured";
  detail: string;
};

const MARKER = /\[REDACTED:[a-z_]+\]/gi;
const PLACEHOLDER = /^(?:n\/?a|none|null|undefined|nil|nothing|ok|okay|done|success|completed|finished|acknowledged|\{\s*\}|\[\s*\]|[-.…]+)$/i;
const REFUSAL = /^(?:i\s*(?:can(?:'|’)?t|cannot|am unable to|(?:'|’)m unable to|won(?:'|’)t be able to)|sorry,?\s*(?:but\s*)?i\s*(?:can(?:'|’)?t|cannot)|i(?:'|’)m sorry,?\s*(?:but\s*)?(?:i|this)|as an ai\b|i do(?:n(?:'|’)t| not) have (?:access|the ability|enough information))/i;
const ERROR_TEXT = /^(?:error\b|an error (?:occurred|has occurred)|something went wrong|internal server error|service unavailable|bad gateway|rate limit|too many requests|unauthori[sz]ed|forbidden|invalid api key|request failed|exception\b|traceback\b)/i;
const SHORT_TEXT = 160; // a refusal or error line is short; a longer text that starts the same way is still an answer

const norm = (s: string) => s.toLowerCase().replace(MARKER, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Deterministic checks only: no model call. */
export function assessOutput(text: string | null | undefined, objective: string): Usability {
  const raw = (text ?? "").trim();
  if (!raw) return { usable: false, code: "empty", detail: "the result is empty" };
  const visible = raw.replace(MARKER, "").trim();
  if (!visible || !/[\p{L}\p{N}]/u.test(visible)) return { usable: false, code: "empty", detail: "nothing is left of the result once removed text is taken out" };
  // "Done." and "OK!" are as empty as "done": trailing punctuation and spaces do not make a placeholder an answer.
  if (PLACEHOLDER.test(visible.replace(/[\s.!?…]+$/u, ""))) return { usable: false, code: "placeholder", detail: `the result is only "${visible.slice(0, 30)}"` };

  // A structured "done" with no answer comes through as the raw JSON of the reply itself.
  if (visible.startsWith("{")) {
    try {
      const o = (parseStrictObject(visible) ?? {}) as Record<string, unknown>;
      if (o && typeof o === "object" && typeof o.status === "string" && ["done", "continue", "need_info"].includes(o.status)
        && !(typeof o.answer === "string" && o.answer.trim())) {
        return { usable: false, code: "status_only", detail: "the reply carried a status but no answer" };
      }
    } catch { /* not JSON: judged as text below */ }
  }

  if (visible.length <= SHORT_TEXT) {
    if (REFUSAL.test(visible)) return { usable: false, code: "refusal", detail: "the tool declined or could not help" };
    if (ERROR_TEXT.test(visible)) return { usable: false, code: "error_text", detail: "the reply is an error message, not a result" };
  }
  const a = norm(visible);
  const o = norm(objective);
  if (a && o && a === o) return { usable: false, code: "echo", detail: "the tool only repeated the request" };

  // The quality floor (task 3): deterministic checks for a result that is technically an answer but not a useful one.
  const low = lowQuality(visible, objective);
  if (low) return { usable: false, ...low };
  return { usable: true, code: "ok", detail: `${visible.length} characters` };
}

// ---------------------------------------------------------------------------------------
// The quality floor. Each check names what is wrong and what to do about it, because that sentence is what the tool is told when its
// reply is sent back (correctionFor). The thresholds are deliberately loose: a short, direct answer to a short question passes.

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// Sentences that carry no content. Only the first and last sentences of a result are ever looked at, and a sentence is matched as a
// whole: "Sure! Here's the report:" and "I hope this helps!" are pleasantries, "Sure, revenue grew 12%." is content.
const FILLER_OPEN = [
  /^(?:certainly|sure|of course|absolutely|great question|good question)[!.,:]*$/i,
  /^(?:certainly|sure|of course|absolutely)[!,.:]*\s+(?:here(?:'|’)?s|here is|here are|below is|below are)\b.{0,100}:$/i,
  /^(?:here(?:'|’)?s|here is|here are|below is|below are)\b.{0,100}:$/i,
  /^i(?:'|’)?d be (?:happy|glad) to help\b.{0,80}$/i,
];
const FILLER_CLOSE = [
  /^(?:i hope (?:this|that) helps|hope (?:this|that) helps)\b.{0,80}$/i,
  /^(?:let me know|please let me know|don(?:'|’)?t hesitate to|feel free to (?:ask|reach out|contact|let me know))\b.{0,160}$/i,
  /^(?:if you (?:have|need|would like|want) (?:any |more |further |additional )?(?:questions|help|assistance|changes|adjustments|anything|more)|is there anything (?:else|more))\b.{0,160}$/i,
];
const MAX_FILLER_UNITS = 2;

/** The text without its opening and closing pleasantries (at most two sentences each side), and what was taken out. */
export function stripFiller(text: string): { text: string; removed: string[] } {
  // Sentence-sized units with their position, so what is kept is the original text, not a rebuilt copy.
  const units = [...text.matchAll(/[^\n.!?]+(?:[.!?]+|(?=\n)|$)/g)].map((m) => ({ t: m[0].trim(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })).filter((u) => u.t);
  const removed: string[] = [];
  let lo = 0;
  let hi = units.length;
  for (let n = 0; n < MAX_FILLER_UNITS && lo < hi; n++) {
    if (units[lo].t.length > 140 || !FILLER_OPEN.some((re) => re.test(units[lo].t))) break;
    removed.push(units[lo].t); lo++;
  }
  for (let n = 0; n < MAX_FILLER_UNITS && lo < hi; n++) {
    if (units[hi - 1].t.length > 200 || !FILLER_CLOSE.some((re) => re.test(units[hi - 1].t))) break;
    removed.push(units[hi - 1].t); hi--;
  }
  if (!removed.length) return { text: text.trim(), removed };
  return { text: lo < hi ? text.slice(units[lo].start, units[hi - 1].end).trim() : "", removed };
}

/**
 * The stored result: opening and closing pleasantries removed. Left alone when little would remain (a short answer that is mostly
 * pleasantry is judged, not rewritten) and whenever nothing matched.
 */
export function tidyOutput(text: string): { text: string; removed: string[] } {
  const s = stripFiller(text);
  if (!s.removed.length || wordCount(s.text) < 20) return { text, removed: [] };
  return s;
}

const GENERIC_PHRASES = [
  "it is important to note", "it's important to note", "it is worth noting", "in today's fast-paced", "in today's digital age", "in today's world",
  "plays a crucial role", "plays a vital role", "a wide range of", "a variety of", "various factors", "at the end of the day", "needless to say",
  "delve into", "ever-evolving", "game-changer", "unlock the potential", "take it to the next level", "in the realm of", "navigate the complexities",
  "in conclusion", "to sum up", "overall, it is clear",
];
// A document is asked for with a verb: "write a report on…", not "log in and report". Only then is a very short reply too thin.
const DELIVERABLE = /\b(?:write|draft|prepare|produce|compose|generate|create|make|put together|give me)\b[^.?!\n]{0,40}?\b(report|analysis|plan|proposal|strategy|comparison|article|essay|memo|checklist|outline|roadmap|guide)\b/i;
const WORD_CAP = /\b(?:at most|no more than|maximum|max|under|within|up to|fewer than|less than)\s+\d{1,4}\s+words?\b|\b\d{1,4}\s+words?\b|\b(?:one|1)[ -]?(?:line|sentence)\b|\bbrief(?:ly)?\b|\bshort\b|\btl;?dr\b/i;

/** Concrete detail: numbers, names (a capital letter inside a sentence), quoted text, links and list items. */
function specifics(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)) n++;
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const tokens = sentence.split(/\s+/).filter(Boolean);
      tokens.forEach((t, i) => {
        if (/\d/.test(t) || /^https?:\/\//i.test(t) || /["“”`]/.test(t)) n++;
        else if (i > 0 && /^[A-Z][a-z]{2,}/.test(t)) n++;
      });
    }
  }
  return n;
}

/** What is wrong with a result that is an answer but not a useful one; null when it clears the floor. */
export function lowQuality(text: string, objective: string): { code: "filler" | "repetitive" | "thin" | "generic" | "unstructured"; detail: string } | null {
  const stripped = stripFiller(text);
  const body = stripped.text;
  const words = wordCount(body);

  // Pleasantries and nothing else.
  if (stripped.removed.length && words < 5) {
    return { code: "filler", detail: "the reply is only pleasantries (such as \"Certainly!\" or \"I hope this helps\") and contains no content. Give the content itself, without opening or closing pleasantries" };
  }

  // The same sentences again and again.
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((s) => norm(s)).filter((s) => s.split(" ").length >= 3);
  if (sentences.length >= 6 && new Set(sentences).size / sentences.length < 0.5) {
    return { code: "repetitive", detail: "the reply repeats the same sentences. Say each thing once and add what is missing" };
  }

  // A document was asked for and almost nothing came back. A stated length or a request to be brief is respected.
  if (DELIVERABLE.test(objective) && !WORD_CAP.test(objective)) {
    const items = body.split("\n").filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).length;
    if (words < 40 && items < 3) {
      return { code: "thin", detail: `the goal asks for a ${objective.match(DELIVERABLE)![1].toLowerCase()} but the reply is only ${words} words. Write it out in full: the main points, each with its reasoning or detail` };
    }
  }

  // General statements with nothing concrete in them.
  if (words >= 80) {
    const lower = body.toLowerCase();
    const hits = GENERIC_PHRASES.filter((p) => lower.includes(p)).length;
    if (hits >= 3 && specifics(body) < Math.max(3, Math.floor(words / 50))) {
      return { code: "generic", detail: "the reply is generic: it makes general statements and gives no concrete fact, number, name or step. Give specific facts, numbers, names or steps for this goal" };
    }
  }

  // A long answer as one block of text.
  if (words >= 300 && body.split("\n").filter((l) => l.trim()).length <= 1) {
    return { code: "unstructured", detail: `the reply is ${words} words in one block. Reply again in short paragraphs, with headings or a list so it can be read and checked` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Specific to the request. Three deterministic checks, each applied only where it means something:
//   context_used    the result refers to the person's situation (the distinctive words of the Task's context, not of the request)
//   parts_answered  each numbered or bulleted part, each separate question, and each item of an "A, B and C" list is answered
//   concrete        a long result gives concrete detail (numbers, names, list items, quotes) in proportion to its length
// Each detail is written to be read by the tool when the result is sent back, and by the person in the warning.

export type QualityId = "context_used" | "parts_answered" | "concrete";
export type QualityCheck = { id: QualityId; label: string; ok: boolean; detail: string };
export type Quality = { ok: boolean; checks: QualityCheck[]; warning?: string };
/** What a result is checked against: the person's own request, the Task's context, and which checks apply. */
export type QualityScope = { request: string; context: string | null; checks: QualityId[] };

export const QUALITY_LABEL: Record<QualityId, string> = {
  context_used: "Uses your context",
  parts_answered: "Answers every part of the request",
  concrete: "Gives concrete detail",
};
export const ALL_QUALITY: QualityId[] = ["context_used", "parts_answered", "concrete"];

/**
 * Which checks apply to a step of each action. A rewrite, an explanation, key points, role answers, an adaptation, options and a draft
 * are told to add nothing, so nothing is asked of them here. A fact-check answers a claim, not the person's situation. A step of a
 * multi-step or delegated Task does one part on purpose, so it is not asked to answer every part.
 */
export const QUALITY_BY_KIND: Record<ReportKind, QualityId[]> = {
  opinions: ALL_QUALITY, research: ALL_QUALITY, compare: ALL_QUALITY, decision: ALL_QUALITY,
  factcheck: ["concrete"], multistep: ["context_used", "concrete"], delegate: ["context_used", "concrete"],
  rewrite: [], explain: [], keypoints: [], roles: [], adapt: [], alternatives: [], draft: [],
};

const MIN_WORDS_CONTEXT = 80;
const MIN_WORDS_CONCRETE = 150;
const MAX_PARTS = 8;
// Words of the context's own structure (the brief's labels and its first line), not of the person's situation.
const CONTEXT_LABELS = stems("what nazai knows about the person asking information instructions situation assumption answer business industry audience " +
  "offers tone channels their own notes standing facts wrote background context project");
// Words every request has ("write", "explain", "give me"): a part is answered by its subject, not by these.
const REQUEST_FILLER = stems("write give explain list describe provide tell make help please include cover answer show find create prepare draft need want " +
  "know best good also using based like think should could would");

const quote = (s: string, n = 60) => `"${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}"`;

/**
 * The distinctive words of the context: names (a capital letter inside a sentence), numbers, and longer words; not the context's own
 * structure, and not words already in the request (using those proves nothing).
 */
export function contextTerms(context: string, request: string): string[] {
  const req = stems(request);
  const out = new Map<string, string>();
  for (const sentence of context.split(/(?<=[.!?:])\s+|\n+/)) {
    (sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).forEach((raw, i) => {
      const [w] = contentWords(raw);
      if (!w) return;
      const name = i > 0 && /^\p{Lu}/u.test(raw);
      if (!(name || /\d/.test(w) || w.length >= 6)) return;
      const st = stem(w);
      if (req.has(st) || CONTEXT_LABELS.has(st) || out.has(st)) return;
      out.set(st, w);
    });
  }
  return [...out.values()];
}

/** The parts of a request: numbered or bulleted lines, separate questions, or the items of an "A, B and C" list. Empty when it is one ask. */
export function requestParts(request: string): string[] {
  const t = request.replace(/<<<|>>>/g, " ").trim();
  const listed = t.split("\n").map((l) => l.match(/^\s*(?:\d{1,2}[.)]|[-*•])\s+(.*\S)\s*$/)?.[1] ?? "").filter(Boolean);
  // More than a few list lines is pasted material, not a list of asks.
  if (listed.length >= 2) return listed.length <= MAX_PARTS ? listed : [];
  const questions = t.split(/(?<=\?)\s+/).map((q) => q.trim()).filter((q) => q.endsWith("?") && contentWords(q).length > 0);
  if (questions.length >= 2) return questions.length <= MAX_PARTS ? questions : [];
  const m = t.match(/(?:\b(?:cover(?:ing)?|includ(?:e|ing)|about|regarding|for|on)\b|:)\s*([^.?!\n;,]{2,80}(?:,\s*[^.?!\n;,]{2,80}){1,6},?\s+and\s+[^.?!\n;,]{2,80})/i);
  if (m) {
    const items = m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
    if (items.length >= 3 && items.length <= MAX_PARTS) return items;
  }
  return [];
}

/** True when the result says something about the part: enough of the part's subject words appear in it. */
function answers(part: string, result: Set<string>): boolean {
  const subject = [...stems(part)].filter((w) => !REQUEST_FILLER.has(w));
  if (subject.length === 0) return true;
  return subject.filter((w) => result.has(w)).length >= Math.max(1, Math.ceil(subject.length / 3));
}

/** The result checked for being specific to the request; null when none of the checks applies. Deterministic: no model call. */
export function assessSpecific(text: string, scope: QualityScope): Quality | null {
  const body = stripFiller(text ?? "").text;
  const words = wordCount(body);
  const have = stems(body);
  const checks: QualityCheck[] = [];
  const add = (id: QualityId, ok: boolean, detail: string) => checks.push({ id, label: QUALITY_LABEL[id], ok, detail });

  if (scope.checks.includes("context_used") && scope.context && words >= MIN_WORDS_CONTEXT) {
    const terms = contextTerms(scope.context, scope.request);
    if (terms.length >= 3) {
      const used = terms.filter((w) => have.has(stem(w)));
      const need = terms.length >= 6 ? 2 : 1;
      if (used.length >= need) add("context_used", true, `it refers to your situation (${used.slice(0, 3).map((w) => quote(w, 30)).join(", ")})`);
      else add("context_used", false, `nothing in it refers to the person's situation given in the context (for example ${terms.slice(0, 3).map((w) => quote(w, 30)).join(", ")}): say what applies to them`);
    }
  }
  if (scope.checks.includes("parts_answered")) {
    const parts = requestParts(scope.request);
    if (parts.length >= 2) {
      const missing = parts.map((p, i) => ({ p, i })).filter(({ p }) => !answers(p, have));
      if (missing.length === 0) add("parts_answered", true, `all ${parts.length} parts of the request are answered`);
      else add("parts_answered", false, `${missing.length === 1 ? "this part of the request was" : "these parts of the request were"} not answered: ${missing.map(({ p, i }) => `${i + 1} (${quote(p)})`).join(", ")}`);
    }
  }
  if (scope.checks.includes("concrete") && words >= MIN_WORDS_CONCRETE) {
    const n = specifics(body);
    const need = Math.max(3, Math.ceil(words / 100));
    if (n >= need) add("concrete", true, `${n} concrete details in ${words} words`);
    else add("concrete", false, `it is ${words} words but has only ${n} concrete detail${n === 1 ? "" : "s"} (numbers, names, steps or examples); give at least ${need}`);
  }
  if (checks.length === 0) return null;
  return { ok: checks.every((c) => c.ok), checks };
}

/** The warning a result carries when it completes without being specific: what is missing, in plain words. */
export const genericWarning = (q: Quality) => `Partly generic: ${q.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}.`;

// ---------------------------------------------------------------------------------------
// The checklist

export type StepExchange = { step_no: number; attempt: number; error: string | null };

export type ChecklistInput = {
  now: string;
  /** The tool's status on the last reply; null for plain text. */
  toolStatus: "done" | "continue" | "need_info" | null;
  stepNo: number;
  /** Every recorded exchange of the session (any attempt). */
  exchanges: StepExchange[];
  /** The approval this session waited on, if any: its current status. */
  approval: { status: string | null } | null;
  /** A question or hand-off is still recorded as open. */
  openPending: boolean;
  text: string | null;
  objective: string;
  /** Names of blocking rules the result still breaks. */
  brokenRules: string[];
  /** null when a person decided the result, so no goal check ran. */
  goal: { ok: boolean; problems: string[] } | null;
  fromPerson: boolean;
  /** The read-back of the stored result; null before it was stored. */
  stored: { text: string | null } | null;
  outputSha256: string | null;
  /** Is the result specific to the request (assessSpecific)? null or absent: no such check applies. */
  quality?: Quality | null;
  /** The result may still be sent back once. Default true. */
  retriesLeft?: boolean;
};

const SETTLED_APPROVAL = new Set(["approved", "executed", "auto_approved"]);

export function buildChecklist(i: ChecklistInput): Checklist {
  const c = new Map<CriterionId, Criterion>();
  const set = (id: CriterionId, ok: boolean | null, detail: string) => c.set(id, { id, label: LABEL[id], ok, detail });

  // tool_finished
  if (i.toolStatus === "continue" || i.toolStatus === "need_info") set("tool_finished", false, `the tool's last reply was "${i.toolStatus}"`);
  else set("tool_finished", true, i.toolStatus === "done" ? "the tool said done" : "plain-text reply, read as done");

  // steps_accounted: a row for every step, and the closing exchange is not an error
  const seen = new Set(i.exchanges.map((e) => e.step_no));
  const missing: number[] = [];
  for (let n = 1; n <= i.stepNo; n++) if (!seen.has(n)) missing.push(n);
  const last = i.exchanges.filter((e) => e.step_no === i.stepNo).sort((a, b) => b.attempt - a.attempt)[0];
  if (i.stepNo < 1) set("steps_accounted", false, "no step was run");
  else if (missing.length) set("steps_accounted", false, `no recorded exchange for step ${missing.slice(0, 5).join(", ")}`);
  else if (last?.error) set("steps_accounted", false, `the closing exchange of step ${i.stepNo} recorded an error`);
  else set("steps_accounted", true, `${i.stepNo} step${i.stepNo === 1 ? "" : "s"}, each with a recorded exchange`);

  // nothing_pending
  if (i.openPending) set("nothing_pending", false, "a question or hand-off is still open");
  else if (i.approval && !(i.approval.status && SETTLED_APPROVAL.has(i.approval.status))) set("nothing_pending", false, `the approval is "${i.approval.status ?? "unknown"}", not approved`);
  else set("nothing_pending", true, i.approval ? "the approval was granted" : "nothing waiting");

  // output_present / output_useful
  const present = !!(i.text ?? "").trim();
  set("output_present", present, present ? "a result exists" : "there is no result");
  const use = assessOutput(i.text, i.objective);
  // A person who wrote or approved the text decided it is the result; only emptiness is still refused.
  if (i.fromPerson && present) set("output_useful", true, "a person decided this result");
  else set("output_useful", present ? use.usable : false, present ? use.detail : "no result to judge");

  // rules_kept / goal_matched
  set("rules_kept", i.brokenRules.length === 0, i.brokenRules.length ? `breaks ${i.brokenRules.join("; ")}` : "no blocking rule is broken");
  if (i.fromPerson) set("goal_matched", true, "a person decided this result");
  else if (!i.goal) set("goal_matched", true, "no goal check applied");
  else set("goal_matched", i.goal.ok, i.goal.ok ? "the result matches the goal" : i.goal.problems.slice(0, 3).join(" ") || "the result does not match the goal");

  // output_stored: only meaningful once everything above holds
  const before = ORDER.filter((id) => id !== "output_stored").every((id) => c.get(id)?.ok === true);
  if (!before) set("output_stored", null, "not checked: an earlier criterion was not met");
  else if (!i.stored) set("output_stored", null, "not stored yet");
  else if (!(i.stored.text ?? "").trim()) set("output_stored", false, "the stored result is empty");
  else if (i.stored.text !== i.text) set("output_stored", false, "the stored result differs from the checked result");
  else set("output_stored", true, "stored and read back identically");

  const criteria = ORDER.map((id) => c.get(id)!);
  const failed = criteria.filter((x) => x.ok === false);
  const pending = criteria.some((x) => x.ok === null);
  const passed = failed.length === 0 && !pending;

  let outcome: Outcome;
  if (passed) outcome = "completed";
  else if (c.get("rules_kept")!.ok === false) outcome = "blocked";
  else if (c.get("output_present")!.ok === false || c.get("output_useful")!.ok === false || c.get("goal_matched")!.ok === false) outcome = "retry";
  else outcome = "failed";

  const first = failed[0];
  const q = i.quality ?? null;
  // Not specific enough, and nothing else wrong: sent back once with the exact gap, before anything is stored.
  if (q && !q.ok && failed.length === 0 && (i.retriesLeft ?? true)) {
    const gap = q.checks.find((x) => !x.ok)!;
    return {
      version: COMPLETION_VERSION, at: i.now, outcome: "retry", passed: false, criteria, quality: q,
      summary: `Completion check: not specific enough — ${gap.label.toLowerCase()}: ${gap.detail}.`, output_sha256: i.outputSha256,
    };
  }
  // Still not specific after the one retry: it completes (the hard criteria hold), with the warning in its own words.
  const quality = q ? (q.ok ? q : { ...q, warning: genericWarning(q) }) : null;
  const summary = passed
    ? quality
      ? quality.ok
        ? `Completion check passed. Specific to the request: ${quality.checks.map((x) => x.label.toLowerCase()).join("; ")}.`
        : `Completion check passed with a warning. ${quality.warning}`
      : `Completion check passed: all ${criteria.length} criteria met.`
    : pending && !first
      ? "Completion check not finished: the result was not stored and read back yet."
      : `Completion check failed: ${first ? `${first.label.toLowerCase()} — ${first.detail}` : "a criterion was not met"}.`;
  return { version: COMPLETION_VERSION, at: i.now, outcome, passed, criteria, summary, output_sha256: i.outputSha256, ...(quality ? { quality } : {}) };
}

/** Everything that was not met, hard criteria first, then what is not specific. */
export const problemsOf = (c: Checklist): string[] => [
  ...c.criteria.filter((x) => x.ok === false).map((x) => x.detail),
  ...(c.quality?.checks ?? []).filter((x) => !x.ok).map((x) => x.detail),
];

/** After a retry was already used, "retry" becomes a person's decision. */
export function settle(c: Checklist, retriesLeft: boolean): Checklist {
  if (c.outcome !== "retry" || retriesLeft) return c;
  return { ...c, outcome: "needs_attention" };
}

/** What the tool is told when its result is sent back, from the first unmet criterion. */
export function correctionFor(c: Checklist): string {
  const bad = c.criteria.find((x) => x.ok === false && (x.id === "output_present" || x.id === "output_useful"));
  if (bad) return `Your previous reply had no usable result (${bad.detail}). Reply again with the actual answer to the goal.`;
  if (c.quality && !c.quality.ok && !c.criteria.some((x) => x.ok === false)) {
    const gaps = c.quality.checks.filter((x) => !x.ok).map((x) => x.detail).join("; ");
    return `Your previous reply is not specific enough: ${gaps}. Reply again with the complete answer to the goal, fixing exactly this and keeping everything that was right.`;
  }
  const goal = c.criteria.find((x) => x.id === "goal_matched" && x.ok === false);
  return `The result does not match the goal. ${goal?.detail ?? ""} Answer the goal directly.`.trim();
}

/** The one-line audit text for the session's stop reason. */
export const passedCount = (c: Checklist) => `${c.criteria.filter((x) => x.ok === true).length}/${c.criteria.length}`;
