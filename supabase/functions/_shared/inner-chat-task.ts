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
