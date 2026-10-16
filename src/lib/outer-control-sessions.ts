// Outer Control (active): wording and small helpers for the sessions card.
export type SessionStatus = "queued" | "skipped" | "running" | "awaiting_human" | "completed" | "rejected" | "failed" | "cancelled" | "stopped";
export type PendingKind = "first_contact" | "contact_gate" | "reply_approval" | "question" | "handoff";

export const STATUS_LABEL: Record<SessionStatus, string> = {
  queued: "Waiting",
  skipped: "Skipped",
  running: "Running",
  awaiting_human: "Needs you",
  completed: "Completed",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
  stopped: "Stopped",
};

export const isOpen = (s: SessionStatus) => s === "queued" || s === "running" || s === "awaiting_human";

/** What the person must do, in one sentence. Null when nothing is needed. */
export function describeWaiting(kind: PendingKind | null, question: string | null): string | null {
  switch (kind) {
    case "first_contact": return "First contact with this tool needs your approval in the approval queue.";
    case "contact_gate": return "A rule requires your approval before Outer Control contacts this tool.";
    case "reply_approval": return "The tool's reply needs your approval in the approval queue.";
    case "handoff": return "Outer Control could not go on safely by itself. Review the summary and choose how to continue.";
    case "question": return question ? `The tool asks: ${question}` : "The tool needs information from you.";
    default: return null;
  }
}

export type StepLike = { step_no: number; attempt: number; verdict: string | null; next_action: string | null; error: string | null; note: string | null };

const NEXT_ACTION_LABEL: Record<string, string> = {
  continue: "accepted, asked for another round",
  finish: "accepted, finished",
  retry_with_correction: "rejected, asked again without the broken rule",
  retry_same: "no usable reply, asking again",
  pause_human: "waiting for a person",
  reject: "rejected, no retries left",
  stop: "stopped at a limit",
  modify_request: "request tightened, asked again",
  switch_tool: "the tool kept failing, switched to the fallback tool",
  handoff: "handed to a person with a recommendation",
  fail: "the tool kept failing",
};

/** One line per exchange: what came back and what Outer Control did about it. */
export function describeStep(s: StepLike): string {
  const what = s.error ? s.error : s.verdict ? `verdict ${s.verdict}` : "no verdict";
  const next = s.next_action ? NEXT_ACTION_LABEL[s.next_action] ?? s.next_action : null;
  return `Step ${s.step_no}${s.attempt > 1 ? ` (try ${s.attempt})` : ""} — ${what}${next ? ` — ${next}` : ""}`;
}

export type HandoffView = {
  kind: "rule_exhausted" | "tool_failed" | "goal_unmet";
  title: string;
  summary: string[];
  options: { id: "retry" | "edit" | "stop"; label: string; description: string }[];
  recommended: "retry" | "edit" | "stop";
  /** The last rejected reply (sensitive text masked), the starting point for writing the reply by hand. */
  draft?: string | null;
};

export type WorkflowStatus = "running" | "awaiting_human" | "completed" | "failed" | "cancelled";

export const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  running: "Running", awaiting_human: "Needs you", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

export type CondKind = "always" | "contains" | "not_contains" | "dep_failed";
export type DraftLeg = { toolId: string; instruction: string; deps: number[]; fallbackId: string; condKind?: CondKind; condLeg?: number; condValue?: string };

/** The legs as the API expects them (`legs`), or the first thing wrong with the form (`message`). */
export function legsPayload(drafts: DraftLeg[]): { legs: Record<string, unknown>[] | null; message: string } {
  if (!drafts.length) return { legs: null, message: "Add at least one step." };
  const legs: Record<string, unknown>[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (!d.toolId) return { legs: null, message: `Step ${i + 1}: choose a tool.` };
    if (!d.instruction.trim()) return { legs: null, message: `Step ${i + 1}: say what the tool should do.` };
    const leg: Record<string, unknown> = {
      tool_id: d.toolId, instruction: d.instruction.trim(), depends_on: d.deps.filter((n) => n >= 1 && n <= i),
      ...(d.fallbackId ? { fallback_tool_id: d.fallbackId } : {}),
    };
    const kind = d.condKind ?? "always";
    if (kind !== "always") {
      const ref = d.condLeg ?? 0;
      if (!(ref >= 1 && ref <= i)) return { legs: null, message: `Step ${i + 1}: choose which earlier step the condition looks at.` };
      if (kind !== "dep_failed" && !(d.condValue ?? "").trim()) return { legs: null, message: `Step ${i + 1}: say which text the condition looks for.` };
      leg.condition = { leg: ref, op: kind, ...(kind === "dep_failed" ? {} : { value: (d.condValue ?? "").trim() }) };
    }
    legs.push(leg);
  }
  return { legs, message: "" };
}

export type DecisionView = {
  why?: string;
  conflicts?: string[];
  guard?: string[];
  plan?: { kind?: string; reason?: string; basis?: string[] } | null;
  /** Short readable lines: what was decided, by which rule, what earlier human decisions say, risk, confidence. */
  trace?: string[];
  risk?: { level?: string } | null;
  confidence?: { level?: string } | null;
};

/**
 * The reasoning behind one step, as short lines. Newer steps carry a trace (decision, deciding rule, what it
 * overrode, risk, confidence); older ones only have a single reason. Then what it was based on and what happens next.
 */
export function describeDecision(d: DecisionView | null | undefined): string[] {
  if (!d) return [];
  const lines: string[] = [];
  if (d.trace?.length) lines.push(...d.trace.map((l) => (l.length > 240 ? `${l.slice(0, 239)}…` : l)));
  else if (d.why) lines.push(`Why: ${d.why.length > 280 ? `${d.why.slice(0, 279)}…` : d.why}`);
  for (const b of d.plan?.basis ?? []) lines.push(`Based on: ${b}`);
  if (d.plan?.reason) lines.push(`Next: ${d.plan.reason}`);
  return lines;
}

const LEVEL_STYLE: Record<string, string> = {
  low: "border-emerald-500/30 text-emerald-300", medium: "border-amber-500/40 text-amber-300", high: "border-rose-500/40 text-rose-300",
};

/** "Risk high · Confidence low" for the step row, or null for steps stored before these existed. */
export function riskConfidenceBadges(d: DecisionView | null | undefined): { label: string; className: string }[] {
  const out: { label: string; className: string }[] = [];
  if (d?.risk?.level && LEVEL_STYLE[d.risk.level]) out.push({ label: `Risk ${d.risk.level}`, className: LEVEL_STYLE[d.risk.level] });
  if (d?.confidence?.level && LEVEL_STYLE[d.confidence.level]) {
    // For confidence the colours run the other way: low is the one to look at.
    const inverse = { high: LEVEL_STYLE.low, medium: LEVEL_STYLE.medium, low: LEVEL_STYLE.high } as Record<string, string>;
    out.push({ label: `Confidence ${d.confidence.level}`, className: inverse[d.confidence.level] });
  }
  return out;
}
