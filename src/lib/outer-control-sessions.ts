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

/** The short reason next to "Waiting for human"; the long instructions stay in the panel below. */
export function waitingReason(kind: PendingKind | null): string {
  switch (kind) {
    case "first_contact": return "Waiting for your approval to contact this tool";
    case "contact_gate": return "Waiting for your approval under a contact rule";
    case "reply_approval": return "Waiting for your approval of the tool's reply";
    case "question": return "Waiting for your answer to the tool's question";
    case "handoff": return "Waiting for your decision on how to continue";
    default: return "Waiting for a person to decide";
  }
}

export type StepLike = { step_no: number; attempt: number; verdict: string | null; next_action: string | null; error: string | null; note: string | null };

export const NEXT_ACTION_LABEL: Record<string, string> = {
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

/** The stored completion checklist of a session (see supabase/functions/_shared/outer-control-completion.ts). */
export type CompletionView = {
  passed: boolean;
  outcome: "completed" | "blocked" | "retry" | "needs_attention" | "failed";
  summary: string;
  criteria: { id: string; label: string; ok: boolean | null; detail: string }[];
};

/** "8/8 criteria met" or what was not met, plus one line per criterion with a mark. Null when no check was stored (older sessions). */
export function describeCompletion(c: CompletionView | null | undefined): { headline: string; ok: boolean; lines: { mark: string; text: string; ok: boolean | null }[] } | null {
  if (!c || !Array.isArray(c.criteria)) return null;
  const met = c.criteria.filter((x) => x.ok === true).length;
  return {
    ok: c.passed,
    headline: c.passed ? `Completion check passed (${met}/${c.criteria.length})` : `Completion check not passed (${met}/${c.criteria.length}): ${c.summary.replace(/^Completion check failed: /, "")}`,
    lines: c.criteria.map((x) => ({ mark: x.ok === true ? "✓" : x.ok === false ? "✗" : "–", text: `${x.label} — ${x.detail}`, ok: x.ok })),
  };
}

export type HandoffView = {
  kind: "rule_exhausted" | "tool_failed" | "goal_unmet" | "no_result";
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
  /** Names of the rules that matched this reply, and what they removed from it. */
  applied?: string[];
  changes?: { name: string; count: number }[];
  /** Control Diff: the tool's reply as segments; removed spans carry only a label and the rule's name. */
  diff?: { segments: DiffSegment[]; removed: number; flagged: number; truncated: boolean } | null;
  /** Meaning rules: what the AI judge found, each with the quoted evidence (a removed passage is never kept). */
  meaning?: { checked: number; unavailable: boolean; discarded: number; findings: { rule: string; action: string; why: string; quote: string | null }[] } | null;
};
export type DiffSegment = { t: string } | { removed: string; rule: string } | { flagged: string; rule: string; effect: "block" | "approval" };

/** "1 removed · 1 flagged": what the rules did to one reply. */
export function diffSummary(d: DecisionView["diff"]): string | null {
  if (!d || (!d.removed && !d.flagged)) return null;
  return [d.removed ? `${d.removed} removed` : "", d.flagged ? `${d.flagged} flagged` : ""].filter(Boolean).join(" · ");
}

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
  lines.push(...meaningLines(d.meaning));
  return lines;
}

const MEANING_DID: Record<string, string> = { block: "blocked it", approval: "sent it for approval", remove: "removed the passage" };
/** The AI judge's work on one reply, with its quoted evidence. */
export function meaningLines(m: DecisionView["meaning"]): string[] {
  if (!m || !m.checked) return [];
  if (m.unavailable) return [`Meaning rules: the AI judge was not available, so a person decides (${m.checked} rule${m.checked === 1 ? "" : "s"} not checked).`];
  if (!m.findings.length) return [`Meaning rules: ${m.checked} checked by the AI judge, none broken${m.discarded ? ` (${m.discarded} finding${m.discarded === 1 ? "" : "s"} without a real quote thrown away)` : ""}.`];
  return m.findings.map((f) => `Meaning rule "${f.rule}" ${MEANING_DID[f.action] ?? f.action}: ${f.quote ? `“${f.quote}”` : "(the passage is not kept)"}${f.why ? ` — ${f.why}` : ""}`);
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
