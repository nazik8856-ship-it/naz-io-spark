// Outer Control: the Task. A Task is one request carried out as an ordered list of steps ("legs"),
// each a session against one tool (an external tool, or one of the account's own NazAI agents).
// It lives in `outer_control_workflows`; this file is the pure part: what a Task's state is, how the
// final controlled result is chosen, how one step's result is handed to the next, and how a chain is built.
//
//   request        the owner's (or the external agent's) original request, as it came in (objective + context)
//   steps          the legs, in order, each with its own status, result and history (outer_control_sessions)
//   state          status, current step, steps done / total, why it stopped, which step failed
//   final result   the controlled output of the last completed step (only when the Task completed)
//   hand-offs      every result passed from one step to the next, with what the rules did to it

import { MAX_CONTEXT_CHARS, rollupStatus, isLegOpen, type LegCondition, type LegState } from "./outer-control-workflow-plan.ts";

export type TaskKind = "single" | "chain";
export type TaskStatus = "running" | "awaiting_human" | "completed" | "failed" | "cancelled";

/** Where the request came from when it was not typed by the owner. */
export type TaskOrigin = {
  kind: "external_agent";
  source_model: string;
  /** The outer_control_evaluations row that judged what the external agent sent. */
  evaluation_id: string | null;
  /** The text handed over, after the rules cleaned it. */
  controlled_text: string;
  verdict: "allow" | "modify";
};

export type TaskLeg = LegState & {
  depends_on: number[];
  condition?: LegCondition | null;
  /** Shown in the hand-off and in the task view. */
  label?: string;
};

export type TaskState = {
  status: TaskStatus;
  summary: string;
  current_leg: number | null;
  steps_total: number;
  steps_done: number;
  /** Set only when the Task completed: the controlled output of its last completed step. */
  final_output: string | null;
  final_leg: number | null;
  /** Set when the Task failed. */
  failed_leg: number | null;
  stop_reason: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The state of a Task from its steps. The status and summary are the same rollup the workflow always used,
 * except that a Task whose only unfinished steps were cancelled by the owner is "cancelled", not "failed".
 */
export function deriveTaskState(legs: TaskLeg[]): TaskState {
  const steps_total = legs.length;
  const steps_done = legs.filter((l) => l.status === "completed").length;
  const roll = rollupStatus(legs);
  const open = legs.filter((l) => isLegOpen(l.status)).sort((a, b) => a.leg_no - b.leg_no);
  const current_leg = open.length ? (open.find((l) => l.status !== "queued") ?? open[0]).leg_no : null;

  let final_output: string | null = null;
  let final_leg: number | null = null;
  if (roll.status === "completed") {
    // The last completed step nobody else waits for; failing that, the highest completed one.
    const waitedFor = new Set(legs.flatMap((l) => l.depends_on));
    const done = legs.filter((l) => l.status === "completed" && (l.final_output ?? "").trim());
    const terminal = done.filter((l) => !waitedFor.has(l.leg_no));
    const pick = (terminal.length ? terminal : done).sort((a, b) => b.leg_no - a.leg_no)[0];
    if (pick) { final_output = pick.final_output; final_leg = pick.leg_no; }
  }

  let failed_leg: number | null = null;
  let stop_reason: string | null = null;
  if (roll.status === "failed" || roll.status === "cancelled") {
    const bad = legs.filter((l) => l.status !== "completed" && l.status !== "skipped" && !isLegOpen(l.status)).sort((a, b) => a.leg_no - b.leg_no);
    // The first step that ended badly on its own (not one cancelled only because an earlier step ended badly).
    const root = bad.find((l) => l.status === "failed" || l.status === "rejected" || l.status === "stopped") ?? bad[0];
    if (root) { failed_leg = root.leg_no; stop_reason = root.stop_reason ? clip(root.stop_reason, 400) : `Step ${root.leg_no} ${root.status}.`; }
  }
  return { status: roll.status, summary: roll.summary, current_leg, steps_total, steps_done, final_output, final_leg, failed_leg, stop_reason };
}

// ---------------------------------------------------------------------------------------
// Building a chain

export type ChainStepInput = {
  tool_id?: unknown; instruction?: unknown; fallback_tool_id?: unknown; on_failure?: unknown; handoff?: unknown;
};

/**
 * Turns an ordered list of steps into legs where each waits for the one before it (the shape `validateLegs`
 * expects). A chain stops at the first step that fails, so unless a step says otherwise it ends instead of
 * waiting for a person after repeated failures.
 */
export function chainLegs(steps: unknown): { ok: true; legs: Record<string, unknown>[] } | { ok: false; message: string } {
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, message: "Add at least one step." };
  const legs = steps.map((raw, i) => {
    const s = (raw ?? {}) as ChainStepInput;
    return {
      tool_id: s.tool_id, instruction: s.instruction, fallback_tool_id: s.fallback_tool_id,
      depends_on: i === 0 ? [] : [i], on_failure: s.on_failure ?? "reject", handoff: s.handoff,
    } as Record<string, unknown>;
  });
  return { ok: true, legs };
}

/**
 * Independent steps asked at the same time, then one last step that waits for all of them. Each independent step ends when it
 * fails (it never waits for a person after repeated failures), and the last step runs with whatever answered: it needs at least
 * one completed step. The last step is the one that writes the result.
 */
export function fanOutLegs(steps: unknown): { ok: true; legs: Record<string, unknown>[] } | { ok: false; message: string } {
  if (!Array.isArray(steps) || steps.length < 2) return { ok: false, message: "Add at least one step and the step that writes the result." };
  const n = steps.length;
  const legs = steps.map((raw, i) => {
    const s = (raw ?? {}) as ChainStepInput;
    const last = i === n - 1;
    return {
      tool_id: s.tool_id, instruction: s.instruction, fallback_tool_id: s.fallback_tool_id, handoff: "none",
      depends_on: last ? Array.from({ length: n - 1 }, (_, k) => k + 1) : [], on_failure: s.on_failure ?? "reject",
      ...(last ? { condition: { leg: n - 1, op: "any_completed", value: null } } : {}),
    } as Record<string, unknown>;
  });
  return { ok: true, legs };
}

// ---------------------------------------------------------------------------------------
// Hand-off between steps

export type HandoffOutcome = "passed" | "modified" | "blocked";

export type HandoffRecord = {
  from_leg: number | null;
  from_label: string;
  to_leg: number;
  outcome: HandoffOutcome;
  /** What the next step receives (empty when blocked). */
  text: string;
  /** Names of the rules that changed or stopped it. */
  rules: string[];
  note: string;
};

/** A rule check on text about to be handed over: the caller supplies it (it needs the account's rules). */
export type HandoffCheck = { blocked: string[]; cleaned: string; changed: string[] };

const HEADER = (leg: number | null, label: string) =>
  leg === null ? `Handed over by ${label}, checked by Outer Control:` : `Step ${leg} (${label}), checked by Outer Control:`;

/**
 * One step's controlled result becomes the next step's input. The text is the stored final output (already
 * cleaned and checked when its own step finished); `check` is the same rules applied again for the receiver,
 * so a rule that applies to the receiving step but not the sending one is still kept. A blocking rule stops
 * the hand-off; text a rule can remove is handed over without it.
 */
export function makeHandoff(i: {
  from_leg: number | null; from_label: string; to_leg: number; text: string; check: HandoffCheck; maxChars: number;
}): HandoffRecord {
  if (i.check.blocked.length) {
    return {
      from_leg: i.from_leg, from_label: i.from_label, to_leg: i.to_leg, outcome: "blocked", text: "", rules: i.check.blocked,
      note: `The result of ${i.from_leg === null ? i.from_label : `step ${i.from_leg}`} breaks ${i.check.blocked.join("; ")}, so it was not passed to step ${i.to_leg}.`,
    };
  }
  const modified = i.check.changed.length > 0;
  const body = clip((modified ? i.check.cleaned : i.text).trim(), i.maxChars);
  return {
    from_leg: i.from_leg, from_label: i.from_label, to_leg: i.to_leg, outcome: modified ? "modified" : "passed",
    text: `${HEADER(i.from_leg, i.from_label)}\n${body}`, rules: i.check.changed,
    note: modified ? `Removed text matching ${i.check.changed.join("; ")} before passing it to step ${i.to_leg}.` : `Passed to step ${i.to_leg} unchanged.`,
  };
}

/** What a step starts with: the task's own context, plus each hand-off that reached it. */
export function contextFromHandoffs(taskContext: string | null, handoffs: HandoffRecord[]): string | null {
  const parts: string[] = [];
  if (taskContext && taskContext.trim()) parts.push(taskContext.trim());
  const passed = handoffs.filter((h) => h.outcome !== "blocked" && h.text);
  if (passed.length) {
    const each = Math.max(400, Math.floor((MAX_CONTEXT_CHARS - (parts[0]?.length ?? 0) - 200) / passed.length));
    parts.push(passed.map((h) => clip(h.text, each)).join("\n\n"));
  }
  const joined = parts.join("\n\n");
  return joined ? clip(joined, MAX_CONTEXT_CHARS) : null;
}

/** The text of a step's request as it is stored, e.g. for a Task created from an external agent's output. */
export function originContext(o: TaskOrigin): string {
  return `${HEADER(null, o.source_model)}\n${o.controlled_text}`;
}

// ---------------------------------------------------------------------------------------
// A NazAI agent as a step

/** What one run of an agent (agent-runtime) answers with. */
export type AgentRunReply = {
  runId?: string; summary?: string | null; outcome?: string | null; goal_met?: boolean | null;
  paused?: boolean; hitStepLimit?: boolean; creditsExhausted?: boolean; skipped?: boolean; reason?: string; error?: string;
};

export const AGENT_FAILURE_TEXT: Record<string, string> = {
  agent_skipped: "The agent did not run (it is already running or reached its daily limit)",
  agent_paused: "The agent paused and is waiting for input on its own page",
  agent_credits_exhausted: "The agent could not run because AI credits are exhausted",
  agent_no_result: "The agent finished without producing a result",
  agent_error: "The agent run failed",
};

/** The result of an agent run as text, or why there is none. Only the agent's own summary is the result. */
export function readAgentRun(payload: unknown): { ok: true; text: string; runId: string | null } | { ok: false; code: keyof typeof AGENT_FAILURE_TEXT } {
  const r = (payload && typeof payload === "object" ? payload : {}) as AgentRunReply;
  if (r.error) return { ok: false, code: "agent_error" };
  if (r.skipped) return { ok: false, code: "agent_skipped" };
  if (r.creditsExhausted) return { ok: false, code: "agent_credits_exhausted" };
  if (r.paused) return { ok: false, code: "agent_paused" };
  const text = typeof r.summary === "string" ? r.summary.trim() : "";
  if (!text) return { ok: false, code: "agent_no_result" };
  return { ok: true, text, runId: typeof r.runId === "string" ? r.runId : null };
}
