// The full gate checklist for one decision -- every layer it passed
// through, not just the one that stopped it. Originally lived only inside
// ControlPendingDecisions.tsx; extracted here ("15 more items" plan, item
// 6) so ControlDecisionHistory.tsx and ControlLiveFeed.tsx can show the
// same drill-down instead of leaving historical/live decisions stuck with
// only a one-line reasoning string, while a single, real copy of this
// rendering stays the source of truth for what "why" looks like anywhere
// in the Control System.
export type TraceStatus = "ok" | "stopped" | "skipped" | "not_reached";
export type TraceEntry = { layer: string; label: string; status: TraceStatus; detail: string | null };

const TRACE_STATUS_STYLE: Record<TraceStatus, string> = {
  ok: "text-emerald-400",
  stopped: "text-rose-400",
  skipped: "text-zinc-500",
  not_reached: "text-zinc-600",
};

const TRACE_STATUS_LABEL: Record<TraceStatus, string> = {
  ok: "ok",
  stopped: "stopped here",
  skipped: "skipped",
  not_reached: "not reached",
};

export function GateTraceList({ trace }: { trace: TraceEntry[] }) {
  return (
    <ul className="mt-2 space-y-1 rounded border border-white/10 bg-black/20 p-2 font-mono text-[10px]">
      {trace.map((e) => (
        <li key={e.layer} className="flex flex-wrap items-baseline gap-x-2">
          <span className={TRACE_STATUS_STYLE[e.status]}>{e.status === "ok" ? "✓" : e.status === "stopped" ? "✕" : "·"}</span>
          <span className="text-zinc-300">{e.label}:</span>
          <span className={TRACE_STATUS_STYLE[e.status]}>{TRACE_STATUS_LABEL[e.status]}</span>
          {e.detail && <span className="text-zinc-500">— {e.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
