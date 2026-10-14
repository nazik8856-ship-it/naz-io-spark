// Outer Control (active): wording and small helpers for the sessions card.
export type SessionStatus = "running" | "awaiting_human" | "completed" | "rejected" | "failed" | "cancelled" | "stopped";
export type PendingKind = "first_contact" | "contact_gate" | "reply_approval" | "question";

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "Running",
  awaiting_human: "Needs you",
  completed: "Completed",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
  stopped: "Stopped",
};

export const isOpen = (s: SessionStatus) => s === "running" || s === "awaiting_human";

/** What the person must do, in one sentence. Null when nothing is needed. */
export function describeWaiting(kind: PendingKind | null, question: string | null): string | null {
  switch (kind) {
    case "first_contact": return "First contact with this tool needs your approval in the approval queue.";
    case "contact_gate": return "A rule requires your approval before Outer Control contacts this tool.";
    case "reply_approval": return "The tool's reply needs your approval in the approval queue.";
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
  fail: "the tool kept failing",
};

/** One line per exchange: what came back and what Outer Control did about it. */
export function describeStep(s: StepLike): string {
  const what = s.error ? s.error : s.verdict ? `verdict ${s.verdict}` : "no verdict";
  const next = s.next_action ? NEXT_ACTION_LABEL[s.next_action] ?? s.next_action : null;
  return `Step ${s.step_no}${s.attempt > 1 ? ` (try ${s.attempt})` : ""} — ${what}${next ? ` — ${next}` : ""}`;
}
