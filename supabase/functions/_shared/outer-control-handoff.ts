// Outer Control (active): the clean hand-off to a person when a run cannot safely go on
// by itself. A hand-off says what happened, what was already done, what the options are
// and which one Outer Control recommends. Pure; the driver stores and resumes it.
import type { FailureClass } from "./outer-control-recovery.ts";
import { humanRetriesAt, renderMemoryCounted, type MemoryEntry } from "./outer-control-memory.ts";

export type HandoffKind = "rule_exhausted" | "tool_failed" | "goal_unmet";
export type HandoffOptionId = "retry" | "stop" | "edit";
export type HandoffOption = { id: HandoffOptionId; label: string; description: string };
export type Handoff = {
  kind: HandoffKind;
  title: string;
  summary: string[];
  options: HandoffOption[];
  recommended: HandoffOptionId;
  /** The last rejected reply as stored (sensitive text masked), offered as a starting point for "edit". */
  draft?: string | null;
};

const EDIT_OPTION: HandoffOption = {
  id: "edit",
  label: "Write the reply myself",
  description: "You write (or fix) the reply for this step. It is checked against the same rules, then used as if the tool had sent it.",
};

export type HandoffInput = {
  kind: HandoffKind;
  stepNo: number;
  toolName: string;
  /** Rules the last reply broke (rule_exhausted). */
  ruleNames: string[];
  /** Why the last exchange failed (tool_failed). */
  failure: FailureClass | null;
  attempts: number;
  memory: MemoryEntry[];
  /** What the final result got wrong about the goal (goal_unmet). */
  problems?: string[];
};

export function buildHandoff(i: HandoffInput): Handoff {
  const earlier = humanRetriesAt(i.memory, i.stepNo);
  const recent = renderMemoryCounted(i.memory, 3);

  if (i.kind === "goal_unmet") {
    const recommended: HandoffOptionId = earlier > 0 ? "stop" : "retry";
    return {
      kind: i.kind,
      title: `"${i.toolName}" gave a result that may not match the goal (step ${i.stepNo})`,
      summary: [
        `Step ${i.stepNo}: the result passed every rule, but the final check found a problem with the goal.`,
        ...(i.problems ?? []).slice(0, 3),
        "The tool was already asked once to fix it. Nothing was finished yet.",
        earlier > 0
          ? "You already chose to retry this step once, so stopping is recommended."
          : "A short note about what the result should contain may let the tool get it right.",
        ...recent.map((l) => `Earlier: ${l}`),
      ],
      options: [
        { id: "retry", label: "Ask again with my note", description: "Gives the tool one more try. Your note is added to the request." },
        EDIT_OPTION,
        { id: "stop", label: "Stop the session", description: "Ends the session. Accepted steps are kept." },
      ],
      recommended,
    };
  }

  if (i.kind === "rule_exhausted") {
    const names = i.ruleNames.length ? i.ruleNames.join("; ") : "a rule";
    const recommended: HandoffOptionId = earlier > 0 ? "stop" : "retry";
    return {
      kind: i.kind,
      title: `"${i.toolName}" keeps breaking a rule on step ${i.stepNo}`,
      summary: [
        `Step ${i.stepNo}: the reply broke ${names}, and the tool was asked ${Math.max(1, i.attempts - 1)} time(s) to fix it.`,
        "Nothing from the rejected replies was used.",
        earlier > 0
          ? "You already chose to retry this step once and it broke the rule again, so stopping is recommended."
          : "A short note from you about what is allowed may let the tool get it right.",
        ...recent.map((l) => `Earlier: ${l}`),
      ],
      options: [
        { id: "retry", label: "Ask again with my note", description: "Gives the tool one more try. Your note is added to the request." },
        EDIT_OPTION,
        { id: "stop", label: "Stop the session", description: "Ends the session. Accepted steps are kept." },
      ],
      recommended,
    };
  }

  const f = i.failure;
  const hopeless = !!f && (f.kind === "auth" || f.kind === "client" || f.kind === "unusable");
  const recommended: HandoffOptionId = hopeless || earlier > 0 ? "stop" : "retry";
  return {
    kind: i.kind,
    title: `Outer Control could not get a usable reply from "${i.toolName}" on step ${i.stepNo}`,
    summary: [
      `Step ${i.stepNo}: ${f?.reason ?? "the tool failed."} It was tried ${Math.max(1, i.attempts)} time(s).`,
      hopeless
        ? "Asking again will not change this until the tool or its settings are fixed."
        : "This kind of failure often clears up by itself.",
      ...recent.map((l) => `Earlier: ${l}`),
    ],
    options: [
      { id: "retry", label: "Try again now", description: "Contacts the tool again with the same request." },
      EDIT_OPTION,
      { id: "stop", label: "Stop the session", description: "Ends the session. Accepted steps are kept." },
    ],
    recommended,
  };
}

export function findOption(h: Handoff | null | undefined, id: unknown): HandoffOption | null {
  if (!h || typeof id !== "string") return null;
  return h.options.find((o) => o.id === id) ?? null;
}

/** What a person's choice is stored as until the session resumes. */
export function encodeChoice(optionId: "retry" | "stop", note: string | null): string {
  return JSON.stringify({ option: optionId, note: note && note.trim() ? note.trim().slice(0, 1000) : null });
}
export function decodeChoice(raw: string | null | undefined): { option: "retry" | "stop"; note: string | null } | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { option?: unknown; note?: unknown };
    if (o.option !== "retry" && o.option !== "stop") return null;
    return { option: o.option, note: typeof o.note === "string" && o.note.trim() ? o.note : null };
  } catch { return null; }
}
