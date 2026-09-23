// Full gate decision trace — every layer control-gate.ts checks, not just
// whichever one stopped the action. Lets a decision record show "spend cap:
// ok, kill switch: ok, hard rules: ok (0 matched), circuit breaker: ok,
// safety scanner: ok, anomaly: ok, model: allow" instead of just the final
// verdict — the trust-legibility half of "why did this get blocked/allowed."

// platform_kill_switch and agent_spend_cap were added to control-gate.ts's
// own checks (and pushed onto its `trace` array) well after this canonical
// list was written, and this list was never updated to match. Because
// finalizeTrace() below only ever emits layers it recognizes here, those two
// pushed entries were silently DISCARDED -- when either one actually
// stopped an action, the customer-facing trace showed all layers as
// "not_reached" instead of showing the one that fired, exactly backwards
// from the trace's entire purpose. Fixed by teaching this list about both.
export type TraceLayer =
  | "platform_kill_switch"
  | "spend_cap"
  | "kill_switch"
  | "agent_spend_cap"
  | "hard_rules"
  | "circuit_breaker"
  | "safety_scanner"
  | "anomaly_detector";

export type TraceStatus = "ok" | "stopped" | "skipped" | "not_reached";

export type TraceEntry = {
  layer: TraceLayer;
  label: string;
  status: TraceStatus;
  detail: string | null;
};

/** Canonical order and human labels — the same order control-gate.ts checks them in. */
export const TRACE_LAYER_ORDER: { layer: TraceLayer; label: string }[] = [
  { layer: "platform_kill_switch", label: "Platform kill switch" },
  { layer: "spend_cap", label: "Daily AI spend cap" },
  { layer: "kill_switch", label: "Account kill switch" },
  { layer: "agent_spend_cap", label: "Agent spend cap" },
  { layer: "hard_rules", label: "Hard rules" },
  { layer: "circuit_breaker", label: "Circuit breaker" },
  { layer: "safety_scanner", label: "Safety scanner" },
  { layer: "anomaly_detector", label: "Anomaly detector" },
];

/**
 * Ensures every canonical layer has an entry, in canonical order. A layer
 * the gate never got to (it stopped at an earlier layer) is filled in as
 * "not_reached" — so a decision record always shows the full six-row
 * checklist, not just whichever layers happened to run before a stop.
 * Pure — takes whatever entries were actually pushed during a run, in
 * whatever order, and returns the complete, ordered list.
 */
export function finalizeTrace(pushed: TraceEntry[]): TraceEntry[] {
  const byLayer = new Map(pushed.map((e) => [e.layer, e]));
  return TRACE_LAYER_ORDER.map(({ layer, label }) =>
    byLayer.get(layer) ?? { layer, label, status: "not_reached" as const, detail: null }
  );
}
