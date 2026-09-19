// Derives a plain-English run outcome from an agent run's event log.
// This is the frontend twin of supabase/functions/_shared/agent-outcome.ts --
// agent-runtime is a Deno edge function and can't be imported by the
// Vite/browser bundle, so the same logic is kept here by hand. Keep both in
// sync when either changes.
export type AgentEvent = { kind: string; payload?: Record<string, unknown> };
export type Outcome = { label: string; tone: "green" | "amber" | "red" | "zinc" };

export function computeRunOutcome(events: AgentEvent[]): Outcome {
  let hasPendingApproval = false;
  let hasClarification = false;
  let sawAction = false;
  const lastActionOkByType = new Map<string, boolean>();

  for (const e of events) {
    const kind = e.kind;
    const p = e.payload ?? {};
    if (kind === "pending_approval") { hasPendingApproval = true; continue; }
    // A control-gate hold (require_approval/modify/deferred) queues an
    // approval_id for a human just like pending_approval does -- only a
    // hard "block" verdict is a true rejection. Without this, a run the
    // control gate correctly held for review fell through to "Failed"
    // even though it did exactly what it should. Kept in sync with the
    // matching fast-path derivation in agent-runtime/index.ts.
    if (kind === "control_gate_blocked" && String(p.verdict) !== "block") { hasPendingApproval = true; continue; }
    if (kind === "approval_resolved" || kind === "approved" || kind === "rejected") { hasPendingApproval = false; continue; }
    if (kind === "ask_user" || kind === "clarification" || kind === "needs_input") { hasClarification = true; continue; }
    if (kind === "clarification_resolved" || kind === "user_reply") { hasClarification = false; continue; }
    if (kind === "action") {
      sawAction = true;
      const type = String(p.type ?? "action");
      const ok = p.ok === true;
      lastActionOkByType.set(type, ok);
    }
  }

  if (hasPendingApproval) return { label: "Needs approval", tone: "amber" };
  if (hasClarification) return { label: "Blocked", tone: "amber" };
  if (sawAction && Array.from(lastActionOkByType.values()).some((v) => v === false)) return { label: "Failed", tone: "red" };
  if (sawAction) return { label: "Done", tone: "green" };
  return { label: "Running", tone: "zinc" };
}
