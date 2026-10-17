// Outer Control: the one honest status for a session or a Task. Raw database statuses are many and some are optimistic
// ("completed" was only a flag); what a person sees is one of these labels with a short reason:
//
//   Completed          the completion checklist passed AND a valid final artifact is stored (nothing else is Completed)
//   Partially completed some steps of a Task finished with a verified result, then it stopped or failed
//   Failed             it broke, or it was recorded as finished without a valid final result
//   Waiting for human  a person has to decide or answer before it can go on
//   Stopped            it ended on purpose: a rule, a limit, a cancel, a skipped step
//   Running / Queued   in progress, not final: it is working now / it has not started and waits for an earlier step
//
// Pure and dependency-free apart from the artifact check. THIS FILE EXISTS TWICE, byte for byte:
// src/lib/outer-control-status.ts and supabase/functions/_shared/outer-control-status.ts. A test fails when they differ.

import { validateArtifact } from "./outer-control-artifact.ts";

export type StatusKey = "completed" | "partial" | "failed" | "waiting" | "stopped" | "running" | "queued";

export const STATUS_LABELS: Record<StatusKey, string> = {
  completed: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  waiting: "Waiting for human",
  stopped: "Stopped",
  running: "Running",
  queued: "Queued",
};

export type HonestStatus = {
  key: StatusKey;
  label: string;
  /** One short sentence; null only for Completed. */
  reason: string | null;
  /** True while it can still change by itself (Running, Queued). A person's answer can still change Waiting for human. */
  live: boolean;
};

export type StatusInput = {
  kind: "session" | "task";
  /** The raw stored status. */
  status: string;
  /** The stored final artifact (any shape; it is validated here). */
  artifact: unknown;
  stop_reason?: string | null;
  /** The sentence from the card that says what the person must do, when waiting. */
  waiting_for?: string | null;
  step_count?: number | null;
  max_steps?: number | null;
  /** Task only. */
  current_leg?: number | null;
  steps_total?: number | null;
  steps_done?: number | null;
  failed_leg?: number | null;
  /** Task only: the raw status of the step that ended it (rejected / stopped / failed / cancelled). */
  root_status?: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const sentence = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return /[.!?…]$/.test(t) ? t : `${t}.`; };
const make = (key: StatusKey, reason: string | null): HonestStatus => ({
  key, label: STATUS_LABELS[key], reason: reason === null ? null : clip(sentence(reason), 260), live: key === "running" || key === "queued",
});

export function honestStatus(i: StatusInput): HonestStatus {
  const why = (i.stop_reason ?? "").trim();

  if (i.status === "completed") {
    const v = validateArtifact(i.artifact, i.kind);
    if (v.ok === true) return make("completed", null);
    return make("failed", `Recorded as completed, but it is not accepted: ${v.reason}`);
  }

  if (i.status === "queued") return make("queued", "Not started: waiting for an earlier step to finish");
  if (i.status === "running") {
    if (i.kind === "task") {
      const total = i.steps_total ?? null;
      return make("running", `Step ${i.current_leg ?? 1}${total ? ` of ${total}` : ""} is running; ${i.steps_done ?? 0} done`);
    }
    return make("running", i.step_count != null && i.max_steps ? `Working: step ${Math.max(1, i.step_count)} of at most ${i.max_steps}` : "Working");
  }
  if (i.status === "awaiting_human") {
    return make("waiting", (i.waiting_for ?? "").trim() || why || "A person has to decide before it can go on");
  }

  if (i.kind === "task") {
    const done = i.steps_done ?? 0;
    const total = i.steps_total ?? null;
    const ended = i.status === "failed" || i.status === "cancelled";
    // Every step finished but the Task still did not complete: its final result could not be verified. That is a failure, not a partial.
    if (ended && done > 0 && !(total !== null && total > 0 && done >= total)) {
      return make("partial", `${done}${total ? ` of ${total}` : ""} step${(total ?? done) === 1 ? "" : "s"} completed. ${why || (i.failed_leg ? `Step ${i.failed_leg} did not finish.` : "The rest did not run.")}`);
    }
    const byRule = i.root_status === "rejected" || i.root_status === "stopped" || i.root_status === "cancelled";
    if (i.status === "cancelled" || (i.status === "failed" && byRule)) return make("stopped", why || (i.status === "cancelled" ? "Cancelled before any step completed" : "Stopped before any step completed"));
    if (i.status === "failed") return make("failed", why || "A step failed and no step completed");
  }

  switch (i.status) {
    case "failed": return make("failed", why || "It failed");
    case "rejected": return make("stopped", why || "A rule rejected the result, so it was not released");
    case "stopped": return make("stopped", why || "It reached a limit and was stopped");
    case "cancelled": return make("stopped", why || "Cancelled by the owner");
    case "skipped": return make("stopped", why || "Skipped: its condition was not met");
    default: return make("failed", `Unknown status "${clip(i.status, 40)}", so it is not treated as completed`);
  }
}
