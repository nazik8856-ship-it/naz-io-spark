// Derives a plain-English run outcome from an agent run's event log.
// Extracted from agent-runtime/index.ts for real test coverage. This exact
// logic has a duplicate, independently-maintained copy in the frontend
// (src/lib/agent-outcome.ts, used by GeneratorHome) since agent-runtime is a
// Deno edge function and can't be imported by the Vite/browser bundle --
// keep both in sync by hand when this file changes.
export type AgentEvent = { kind: string; payload?: Record<string, unknown> };
export type OutcomeLabel = "Paused" | "Needs approval" | "Blocked" | "Step limit" | "Failed" | "Done";

export function deriveRunOutcome(
  events: AgentEvent[],
  opts: { paused?: boolean; hitStepLimit?: boolean } = {},
): OutcomeLabel {
  let hasPendingApproval = false;
  let hasClarification = false;
  let sawAction = false;
  const lastOkByType = new Map<string, boolean>();

  for (const e of events) {
    const k = e.kind;
    const p = e.payload ?? {};
    if (k === "pending_approval") { hasPendingApproval = true; continue; }
    // A control-gate hold with verdict "require_approval"/"modify"/"deferred" is
    // the same "waiting on a human" state as pending_approval -- it queues an
    // approval_id for later resolution. Only a hard "block" verdict is a
    // genuine rejection with no recourse. Without this, a run correctly held
    // by the control gate fell through to the default "Failed" branch below
    // even though it did exactly what it should (proven by a real production
    // run: verdict "modify", a real approval_id issued, misreported as Failed).
    if (k === "control_gate_blocked" && String(p.verdict) !== "block") { hasPendingApproval = true; continue; }
    if (k === "approval_resolved" || k === "approved" || k === "rejected") { hasPendingApproval = false; continue; }
    if (k === "clarification_request" || k === "ask_user" || k === "needs_input") { hasClarification = true; continue; }
    if (k === "clarification_resolved" || k === "user_reply" || k === "clarification_answer") { hasClarification = false; continue; }
    if (k === "action") {
      sawAction = true;
      const type = String(p.type ?? "action");
      const ok = p.ok === true;
      lastOkByType.set(type, ok);
    }
  }

  if (opts.paused) return "Paused";
  if (hasPendingApproval) return "Needs approval";
  if (hasClarification) return "Blocked";
  if (opts.hitStepLimit) return "Step limit";
  if (sawAction && Array.from(lastOkByType.values()).some((v) => v === false)) return "Failed";
  if (sawAction) return "Done";
  return "Failed"; // finished with no delivered action = failed
}
