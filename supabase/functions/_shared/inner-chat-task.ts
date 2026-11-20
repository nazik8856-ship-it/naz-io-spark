// Inner Control chat: "do this" runs a Task under the account's rules (docs/inner-control.md).
//
// The chat never runs work itself: it starts an ordinary Outer Control Task (outer-control-drive start_report), so every answer goes
// through the same rules, checks and result as any Task. It uses NazAI's own built-in tools (Writer, Analyst, Reviewer), never the
// person's connected tools: those spend the person's own API balance and are chosen on purpose in Start a task. The account's first
// STARTER_TASKS Tasks with the built-in tools are free; after that each chat Task costs the action's usual credits, and the chat says
// so before it starts (a task offer the person confirms). Pure, no dependencies.
import { ACTION_INFO, TASK_CREDITS, TASK_LIMITS, type ReportKind } from "./outer-control-report-doc.ts";

/** The actions the chat can run with the built-in tools: no styles, roles or audiences to choose, and at most three tools. */
export const INNER_TASK_KINDS: readonly ReportKind[] = ["opinions", "research", "decision", "compare", "factcheck", "explain", "keypoints", "draft"];
export const isInnerTaskKind = (k: unknown): k is ReportKind => typeof k === "string" && (INNER_TASK_KINDS as readonly string[]).includes(k);

/** The built-in tools a chat Task asks: as many as the action takes, at most three. */
export function toolsForKind(kind: ReportKind, starter: { id: string; name: string }[]): { id: string; name: string }[] {
  const l = TASK_LIMITS[kind];
  const n = Math.min(l.maxTools, 3, starter.length);
  return n >= l.minTools ? starter.slice(0, n) : [];
}

/** A request the chat can run, or the reason it can not (5 characters to the action's own limit). */
export function requestProblem(kind: ReportKind, request: string): string | null {
  const t = request.trim();
  if (t.length < 5) return "Tell me what to do in a sentence.";
  if (t.length > TASK_LIMITS[kind].maxText) return `${ACTION_INFO[kind].title} takes at most ${TASK_LIMITS[kind].maxText} characters; shorten it.`;
  return null;
}

/** What the chat shows before a Task starts: the action, what it will do, the tools, and what it costs. */
export type TaskOffer = { kind: ReportKind; title: string; request: string; tools: string[]; credits: number; free_left: number; line: string };

export function taskOffer(i: { kind: ReportKind; request: string; tools: { name: string }[]; freeUsed: number; freeTasks: number }): TaskOffer {
  const freeLeft = Math.max(0, i.freeTasks - i.freeUsed);
  const credits = freeLeft > 0 ? 0 : TASK_CREDITS[i.kind];
  const names = i.tools.map((t) => t.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const cost = credits === 0 ? `Free (${freeLeft} of ${i.freeTasks} free NazAI tasks left)` : `Uses ${credits} credit${credits === 1 ? "" : "s"}, given back if no result comes`;
  return {
    kind: i.kind, title: ACTION_INFO[i.kind].title, request: i.request.trim(), tools: names, credits, free_left: freeLeft,
    line: `${ACTION_INFO[i.kind].title} with ${who}, every answer checked against your rules. ${cost}.`,
  };
}

// A message that plainly asks for a piece of work ("Draft a polite reply…", "Can you research…", "Compare A and B"): the kind of
// task it is, or null. Used only as a safety net when the chat model answered such a message as off-topic instead of offering the
// task. Deliberately narrow: a leading request verb, never a message about rules (those become a drafted rule) or about what an
// agent or AI wants to do (that is an action review), and never "explain" (questions about the Control System use that word too).
const WORK_VERBS: [RegExp, ReportKind][] = [
  [/^(draft|write|compose|rewrite|reword|polish|reply to|respond to|answer)\b/, "draft"],
  [/^(research|look into|find out|investigate)\b/, "research"],
  [/^compare\b/, "compare"],
  [/^(summari[sz]e|sum up|give me the key points|list the key points)\b/, "keypoints"],
  [/^(fact[- ]?check|verify)\b/, "factcheck"],
];
const POLITE = /^(please\s+|can you\s+|could you\s+|would you\s+|help me\s+|i need you to\s+|i want you to\s+)+/;
// A message that is only a piece of text to check ("Your order will arrive by Friday, guaranteed."): the exact text, or null.
// The safety net for the core loop (paste text, get it checked against your rules): when the chat model answers such a message as
// off-topic, the server checks the text itself. "Check this: …" / "Is this ok? …" keep only the text after the lead-in. Never a
// question to the assistant (one sentence ending in "?"), a greeting or thanks, a work request, or a message about rules or
// about what an agent wants to do: those have their own modes.
const CHECK_LEAD_IN = /^(please\s+)?(check|review|verify|scan|clean( up)?|is this (ok|okay|fine|safe|allowed)\??|can i send this\??)\s*(this|the following|that)?\s*(text|reply|message|answer|response|output)?\s*[:\n-]\s*/i;
const SMALL_TALK = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|good (morning|afternoon|evening))\b/i; // short ones only
const NOT_TEXT_TO_CHECK = /^(what|how|why|when|where|which|who|can|could|should|would|will|do|does|did|is|are|am|show|tell|list|explain|add|delete|remove|turn|switch|enable|disable|make|create|help)\b/i;
export function pastedTextToCheck(message: string): string | null {
  let t = String(message ?? "").trim();
  const lead = t.match(CHECK_LEAD_IN);
  if (lead) t = t.slice(lead[0].length).trim();
  t = t.replace(/^["“'`]+|["”'`]+$/g, "").trim();
  if (t.length < 12 || t.length > 8000 || t.split(/\s+/).length < 3) return null;
  if (!lead) {
    const lower = t.toLowerCase();
    if (NOT_TEXT_TO_CHECK.test(lower) || workRequestKind(lower)) return null;
    if (SMALL_TALK.test(lower) && t.split(/\s+/).length <= 6) return null; // "thanks a lot", not "Thanks for waiting. Your refund…"
    if (/\brules?\b|\b(my|our|the) (agent|ai|bot)s? (wants?|is trying|would like|plans?)\b/.test(lower)) return null;
    // A rule asked for in words ("Never let my AI mention prices", "Always ask me before…") becomes a drafted rule instead.
    if (/^(never|always|don'?t let|do not let|stop|block|forbid|ban)\b|\b(my|our) (ai|agent|bot|assistant)s?\b/.test(lower)) return null;
    if (/\?\s*$/.test(t) && !/[.!?]\s+\S/.test(t.replace(/\?\s*$/, ""))) return null; // one sentence that is a question
  }
  return t;
}

export function workRequestKind(message: string): ReportKind | null {
  const m = String(message ?? "").trim().toLowerCase();
  if (!m || m.length > 1500) return null;
  if (/\brules?\b|\b(my|our|the) (agent|ai|bot)s? (wants?|is trying|would like|plans?)\b/.test(m)) return null;
  const s = m.replace(POLITE, "");
  for (const [re, kind] of WORK_VERBS) if (re.test(s)) return kind;
  return null;
}
