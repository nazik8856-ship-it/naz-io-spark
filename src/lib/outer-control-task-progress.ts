// Outer Control: what a multi-tool Task (Start task) is doing right now, in one line, and the proof of a finished result at a
// glance. Pure: the Task panel and the result card render what these return.
import type { Artifact } from "@/lib/outer-control-artifact";
import { isReportDoc, KIND_NOUN, kindOf } from "@/lib/outer-control-report-doc";

export const REPORT_TOOL_PREFIX = "nazai-internal://report";

export type ProgressLeg = { leg_no: number; tool_id: string; status: string; depends_on: number[]; stop_reason?: string | null; pending_kind?: string | null };
export type ProgressTool = { id: string; name: string; endpoint_url?: string | null };

/** waiting: not started yet. asking / writing: working now. done: checked and kept. missed: ended without an answer. needs_you: waits for a person. */
export type NodeState = "waiting" | "asking" | "writing" | "done" | "missed" | "needs_you" | "cancelled";
export type ProgressNode = { leg_no: number; label: string; writer: boolean; state: NodeState; note: string | null };
export type Phase = "asking" | "writing" | "needs_you" | "ready" | "failed" | "cancelled";
export type TaskProgress = { phase: Phase; headline: string; nodes: ProgressNode[]; done: number; total: number; together: boolean };

const isWriter = (t: ProgressTool | undefined) => !!t && (t.endpoint_url ?? "").startsWith(REPORT_TOOL_PREFIX);

/** True when the Task has NazAI's writer as a step, i.e. it was started from Start task. */
export const hasWriter = (legs: ProgressLeg[], tools: ProgressTool[]) => legs.some((l) => isWriter(tools.find((t) => t.id === l.tool_id)));

const names = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const PENDING: Record<string, string> = {
  first_contact: "approve the first contact",
  contact_gate: "approve contacting it",
  reply_approval: "approve its reply",
  question: "answer its question",
  handoff: "decide what to do",
};

function nodeState(l: ProgressLeg, writer: boolean): NodeState {
  switch (l.status) {
    case "completed": return "done";
    case "running": return writer ? "writing" : "asking";
    case "awaiting_human": return "needs_you";
    case "failed": case "rejected": case "stopped": return "missed";
    case "cancelled": case "skipped": return "cancelled";
    default: return "waiting";
  }
}

export function taskProgress(task: { status: string; stop_reason?: string | null }, legs: ProgressLeg[], tools: ProgressTool[]): TaskProgress {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const sorted = [...legs].sort((a, b) => a.leg_no - b.leg_no);
  const nodes: ProgressNode[] = sorted.map((l) => {
    const t = byId.get(l.tool_id);
    const writer = isWriter(t);
    const state = nodeState(l, writer);
    const note = state === "needs_you" ? (PENDING[l.pending_kind ?? ""] ?? "needs your decision")
      : state === "missed" ? (l.stop_reason ? l.stop_reason.replace(/\s+/g, " ").slice(0, 120) : "did not answer") : null;
    return { leg_no: l.leg_no, label: writer ? "NazAI" : (t?.name ?? "Tool"), writer, state, note };
  });
  const tools_ = nodes.filter((n) => !n.writer);
  const writer = nodes.find((n) => n.writer) ?? null;
  // Tools that wait for nothing are asked at the same time.
  const together = sorted.filter((l) => !isWriter(byId.get(l.tool_id)) && l.depends_on.length === 0).length > 1;
  const done = nodes.filter((n) => n.state === "done").length;
  const total = nodes.length;
  const base = { nodes, done, total, together };

  if (task.status === "completed") {
    const missed = tools_.filter((n) => n.state === "missed").map((n) => n.label);
    return { ...base, phase: "ready", headline: missed.length ? `Result ready, written without ${names(missed)} (no answer).` : "Result ready." };
  }
  if (task.status === "failed") {
    const reason = (task.stop_reason ?? "").replace(/\s+/g, " ").trim();
    return { ...base, phase: "failed", headline: `Stopped${reason ? `: ${reason.slice(0, 200).replace(/\.$/, "")}` : ""}. The credit for this task is given back.` };
  }
  if (task.status === "cancelled") return { ...base, phase: "cancelled", headline: "Cancelled. Nothing more is sent to the tools." };

  const waiting = nodes.find((n) => n.state === "needs_you");
  if (waiting) return { ...base, phase: "needs_you", headline: `Waiting for you: ${waiting.writer ? "NazAI" : waiting.label} — ${waiting.note}. Open it in the list below.` };
  if (writer && writer.state === "writing") {
    const answered = tools_.filter((n) => n.state === "done").length;
    return { ...base, phase: "writing", headline: `NazAI is writing the result from ${answered} checked answer${answered === 1 ? "" : "s"}…` };
  }
  const asking = tools_.filter((n) => n.state === "asking");
  if (asking.length > 1) return { ...base, phase: "asking", headline: `Asking ${names(asking.map((n) => n.label))} at the same time…` };
  if (asking.length === 1 && together) {
    const answered = tools_.filter((n) => n.state === "done").length;
    return { ...base, phase: "asking", headline: `Waiting for ${asking[0].label} (${answered} of ${tools_.length} answered)…` };
  }
  if (asking.length === 1) {
    const k = tools_.indexOf(asking[0]) + 1;
    return { ...base, phase: "asking", headline: `Asking ${asking[0].label}${tools_.length > 1 ? ` (step ${k} of ${tools_.length})` : ""}…` };
  }
  return { ...base, phase: "asking", headline: "Starting…" };
}

// ---------------------------------------------------------------------------------------
// The proof of a finished result, at a glance

export type ProofTile = { key: "done" | "tools" | "rules" | "checks"; title: string; text: string; tone: "ok" | "warn" };

export function proofTiles(a: Artifact): ProofTile[] {
  const report = isReportDoc(a.report) ? a.report : null;
  const tiles: ProofTile[] = [];

  // What was done
  const did = report
    ? `NazAI wrote this ${KIND_NOUN[kindOf(report)]} from ${report.opinions.length} checked answer${report.opinions.length === 1 ? "" : "s"}.`
    : (a.what_done ?? (a.kind === "task" ? `${a.proof.steps_done} of ${a.proof.steps_total} steps finished.` : `Got a checked answer from ${a.tool}.`));
  tiles.push({ key: "done", title: "What was done", text: did, tone: "ok" });

  // Which tools
  if (a.kind === "task") {
    const steps = a.proof.steps.filter((s) => s.tool !== "NazAI report writer");
    const ok = steps.filter((s) => s.status === "completed").map((s) => s.tool);
    const missed = steps.filter((s) => s.status !== "completed").map((s) => s.tool);
    const when = report?.parallel ? "at the same time" : steps.length > 1 ? "one after another" : "";
    tiles.push({
      key: "tools", title: "Tools used",
      text: `${ok.length ? `Answered: ${names([...new Set(ok)])}` : "No tool answered"}${when && ok.length > 1 ? ` (${when})` : ""}.${missed.length ? ` Did not answer: ${names([...new Set(missed)])}.` : ""}`,
      tone: missed.length ? "warn" : "ok",
    });
  } else {
    tiles.push({ key: "tools", title: "Tool used", text: `${a.tool}.`, tone: "ok" });
  }

  // What the rules did
  const inForce = a.rules.in_force.length;
  const fired = a.rules.triggered.length;
  // A rejected reply is listed as a change too ("… was rejected and the tool was asked again"); it is counted once, as blocked.
  const changed = a.changes.filter((c) => !/was rejected/.test(c.what)).length;
  const blocked = a.changes.filter((c) => /was rejected/.test(c.what)).length;
  const ruleText = fired === 0 && a.changes.length === 0
    ? `${inForce} rule${inForce === 1 ? "" : "s"} checked every answer; none had to change anything.`
    : `${inForce} rule${inForce === 1 ? "" : "s"} checked every answer. ${changed ? `Text was removed ${changed} time${changed === 1 ? "" : "s"}` : "No text was removed"}${blocked ? `; ${blocked} repl${blocked === 1 ? "y was" : "ies were"} blocked and asked again` : ""}.`;
  tiles.push({ key: "rules", title: "What was controlled", text: ruleText, tone: fired || a.changes.length ? "warn" : "ok" });

  // The checks
  tiles.push({
    key: "checks", title: "Checks",
    text: a.kind === "task"
      ? `Every kept answer passed its completion check. Fingerprint ${a.output_sha256.slice(0, 12)}.`
      : `${a.proof.summary} Fingerprint ${a.output_sha256.slice(0, 12)}.`,
    tone: "ok",
  });
  return tiles;
}
