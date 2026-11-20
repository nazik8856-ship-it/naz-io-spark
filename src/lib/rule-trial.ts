// "Try it first" (Inner Control Day 2): what a rule would have done to what really happened, before it is switched on. Nothing is
// saved by trying.
//   An action rule is replayed on the account's recent decisions (their action names), with the same matching as the gate.
//   A text rule is replayed on the account's recent tool replies by the server (projects try_rule): they are stored encrypted.
// Pure: the wording and the action replay.
import { globToRe } from "@/lib/coverage-gaps"; // the client copy of the server's rule glob, held to it by a parity test

export type ActionTrial = { checked: number; matched: number; wasAllowed: number; byAction: { action: string; count: number }[] };
export type TextHit = { tool: string; at: string; before: string; match: string; after: string };
export type TextTrial = { checked: number; matched: number; hits: TextHit[] };
/** A rule in plain words, tried by the AI judge: replies it could not read are counted apart. */
export type MeaningTrial = TextTrial & { unavailable: number };

import { verdictOf } from "@/lib/inner-control-ui"; // the status card's parser: a check, not an agent step

/** Which of these recorded actions an action rule would have matched (any provider, as a rule made here has none). */
export function replayActionRule(pattern: string, decisions: { decision: string; action_type: string | null }[]): ActionTrial {
  let re: RegExp;
  try { re = globToRe(pattern || "*"); } catch { return { checked: 0, matched: 0, wasAllowed: 0, byAction: [] }; }
  const actions = decisions.filter((d) => d.action_type && verdictOf(d.decision));
  const hit = actions.filter((d) => re.test(d.action_type!));
  const counts = new Map<string, number>();
  for (const d of hit) counts.set(d.action_type!, (counts.get(d.action_type!) ?? 0) + 1);
  return {
    checked: actions.length, matched: hit.length, wasAllowed: hit.filter((d) => verdictOf(d.decision) === "ALLOW").length,
    byAction: [...counts.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)),
  };
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** One line on what an action rule would have done. */
export function actionTrialLine(t: ActionTrial, effect: "always_block" | "always_require_approval"): string {
  if (t.checked === 0) return "Nothing has run yet, so there is nothing to try it on. It will apply from the first action.";
  if (t.matched === 0) return `Of your last ${n(t.checked, "action")}, none would have been affected.`;
  const did = effect === "always_block" ? "blocked" : "held for approval";
  const top = t.byAction.slice(0, 3).map((a) => `${a.action} ×${a.count}`).join(", ");
  const allowed = t.wasAllowed ? ` ${t.wasAllowed} of them ${t.wasAllowed === 1 ? "was" : "were"} allowed then.` : "";
  return `Of your last ${n(t.checked, "action")}, ${t.matched} would have been ${did} (${top}).${allowed}`;
}

/** One line on what a text rule would have done. */
export function textTrialLine(t: TextTrial, action: "block" | "approval" | "redact"): string {
  if (t.checked === 0) return "There are no tool replies yet to try it on. It will apply from the first reply.";
  if (t.matched === 0) return `None of your last ${n(t.checked, "reply", "replies")} would have been caught.`;
  const did = action === "redact" ? "had the matching text removed" : action === "block" ? "been blocked" : "been held for approval";
  return `${t.matched} of your last ${n(t.checked, "reply", "replies")} would have ${did}.`;
}

/** What is tried: an action rule's pattern and effect, a text rule's pattern and what it does on a match, or a rule in plain words. */
export type TrialSpec =
  | { kind: "action"; pattern: string; effect: "always_block" | "always_require_approval"; narrower?: boolean }
  | { kind: "text"; pattern: string; action: "block" | "approval" | "redact" }
  | { kind: "meaning"; name: string; description: string; action: "block" | "approval" | "remove" };

/** One line on what a rule in plain words would have done. */
export function meaningTrialLine(t: MeaningTrial, action: "block" | "approval" | "remove"): string {
  const unread = t.unavailable ? ` ${t.unavailable} could not be read by the AI judge.` : "";
  if (t.checked === 0 && !t.unavailable) return "There are no replies yet to try it on. It will apply from the first reply.";
  if (t.checked === 0) return `The AI judge could not read any of your recent replies, so it was not tried. Try again in a minute.`;
  if (t.matched === 0) return `None of your last ${n(t.checked, "reply", "replies")} would have broken it.${unread}`;
  const did = action === "remove" ? "had the words that break it removed" : action === "block" ? "been blocked" : "been held for approval";
  return `${t.matched} of your last ${n(t.checked, "reply", "replies")} would have ${did}.${unread}`;
}

/** The trial for a rule being added, or null while it is not complete enough to try. */
export function trialSpecOfDraft(kind: "action" | "text" | "meaning", rule: { scope?: string; effect?: string; pattern?: string; action?: string; name?: string; description?: string }): TrialSpec | null {
  if (kind === "meaning") {
    const description = String(rule.description ?? "").trim();
    if (description.length < 3 || (rule.action !== "block" && rule.action !== "approval" && rule.action !== "remove")) return null;
    return { kind: "meaning", name: String(rule.name ?? "").trim() || "This rule", description, action: rule.action };
  }
  if (kind === "action") {
    const scope = String(rule.scope ?? "").trim();
    if (!scope || (rule.effect !== "always_block" && rule.effect !== "always_require_approval")) return null;
    return { kind: "action", pattern: scope, effect: rule.effect };
  }
  const pattern = String(rule.pattern ?? "").trim();
  if (!pattern || (rule.action !== "block" && rule.action !== "approval" && rule.action !== "redact")) return null;
  return { kind: "text", pattern, action: rule.action };
}

/** The trial for a saved rule. One tied to an agent, a key or a provider is tried on all actions, and says so. */
export function trialSpecOfRow(row: Record<string, unknown> | null): TrialSpec | null {
  if (!row) return null;
  if (typeof row.action_type_pattern === "string") {
    const s = trialSpecOfDraft("action", { scope: row.action_type_pattern || "*", effect: row.effect as string });
    return s && s.kind === "action" ? { ...s, narrower: !!(row.agent_id || row.api_key_id || row.provider) } : s;
  }
  if (typeof row.description === "string") return trialSpecOfDraft("meaning", { name: row.name as string, description: row.description, action: row.action as string });
  if (typeof row.pattern === "string") {
    const action = row.redact ? "redact" : row.severity === "block" ? "block" : "approval";
    return trialSpecOfDraft("text", { pattern: row.pattern, action });
  }
  return null;
}
