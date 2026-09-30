// Blueprint task #4: a real control report -- rules checked, what fired,
// what was blocked/modified -- delivered right here at the point of run
// delivery, instead of being something an owner can only piece together by
// leaving this page for the separate Control System > Decision History
// screen. agent_decisions never logs a clean allow (every gate path's own
// comment documents this -- see control-gate.ts's runControlGateInner), so
// every row passed in here for this run IS a governance event worth
// reporting; a run with none simply ran clean against every rule that would
// have stopped it.
import { useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import { classifyDecisionOutcome, type DecisionOutcome } from "@/lib/roi-report";
import { DecisionExplanationPanel } from "@/components/control/DecisionExplanationPanel";
import type { TraceEntry } from "@/components/control/GateTraceList";
import type { PrecedentCitationRecord, DeferredDetail } from "@/lib/decision-explanation";
import type { DecisionRow } from "./AgentCockpit";

const OUTCOME_STYLE: Record<DecisionOutcome, string> = {
  block: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  modify: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  allow: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  deferred: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  approval_required: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  other: "text-zinc-400 border-white/15 bg-white/5",
};

function toDeferredDetail(raw: unknown): DeferredDetail | null {
  const d = raw as { why_not_now?: string; what_would_change_it?: string; improvement_steps?: string[]; reconsider_when?: string } | null;
  if (!d) return null;
  return {
    whyNotNow: d.why_not_now ?? "",
    whatWouldChangeIt: d.what_would_change_it ?? "",
    improvementSteps: d.improvement_steps ?? [],
    reconsiderWhen: d.reconsider_when ?? "",
  };
}

export default function RunControlReport({ decisions, actionCount }: { decisions: DecisionRow[]; actionCount: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Nothing has happened yet this run -- no actions attempted, no rule ever
  // had anything to say. Rendering an empty "all clear" card before the
  // first action would read as false confidence about something that
  // hasn't been tested yet.
  if (decisions.length === 0 && actionCount === 0) return null;

  const clean = decisions.length === 0;

  return (
    <div
      className="rounded-xl border p-4"
      style={clean ? { borderColor: "rgba(52,211,153,0.28)", background: "rgba(52,211,153,0.05)" } : { borderColor: "rgba(245,158,11,0.28)", background: "rgba(245,158,11,0.05)" }}
    >
      <div className="flex items-center gap-2">
        {clean ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <ShieldAlert className="h-4 w-4 text-amber-300" />}
        <div className="text-sm font-bold text-white">Control Report — this run</div>
      </div>
      {clean ? (
        <p className="mt-2 text-xs text-emerald-200/90">
          {actionCount} action{actionCount === 1 ? "" : "s"} ran clean — no hard rule, safety rule, kill switch, or spend cap fired.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-amber-200/90">
            {decisions.length} of {actionCount || decisions.length} action{(actionCount || decisions.length) === 1 ? "" : "s"} touched a rule this run.
          </p>
          <ul className="mt-3 space-y-2">
            {decisions.map((d) => {
              const outcome = classifyDecisionOutcome(d.decision);
              return (
                <li key={d.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${OUTCOME_STYLE[outcome]}`}>
                      {outcome.replace("_", " ")}
                    </span>
                    {d.escalated && (
                      <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                        escalated
                      </span>
                    )}
                    {d.source && <span className="font-mono text-[10px] uppercase text-zinc-500">{d.source.replace(/_/g, " ")}</span>}
                    {(d.action_type || d.provider) && (
                      <span className="font-mono text-[10px] uppercase text-zinc-600">
                        {d.action_type}{d.action_type && d.provider ? " · " : ""}{d.provider}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-300">{d.reasoning}</p>
                  <button
                    onClick={() => toggle(d.id)}
                    className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-500 hover:text-zinc-300"
                  >
                    {expanded.has(d.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Explain
                  </button>
                  {expanded.has(d.id) && (
                    <DecisionExplanationPanel
                      decision={d.decision}
                      reasoning={d.reasoning}
                      confidenceScore={d.confidence_score}
                      source={d.source}
                      escalated={!!d.escalated}
                      humanResponse={d.human_response}
                      actionType={d.action_type}
                      provider={d.provider}
                      createdAt={d.created_at}
                      gateTrace={d.gate_trace as TraceEntry[] | null}
                      precedentCitations={d.precedent_citations as PrecedentCitationRecord | null}
                      deferredDetail={toDeferredDetail(d.deferred_detail)}
                      modifiedParams={d.modified_params as Record<string, unknown> | null}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
