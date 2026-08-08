import { Check, Pencil, Ban, Clock, ShieldCheck, Zap, ExternalLink, AlertTriangle } from "lucide-react";

export type ControlDecision = {
  decision_id: string | null;
  decision: "allow" | "modify" | "block" | "deferred";
  reason: string;
  reasoning: string;
  confidence_score: number;
  confidence_label: string;
  threshold: number;
  escalated: boolean;
  action_type: string;
  provider: string;
  risk_tier: "low" | "medium" | "high";
  intent_match: string;
  fit_assessment: string;
  alternatives: string[];
  deferred: {
    why_not_now: string;
    what_would_change_it: string;
    improvement_steps?: string[];
    reconsider_when: string;
  } | null;
  executed?: boolean;
  dry_run?: boolean;
  execution?: {
    ok: boolean;
    summary: string;
    url?: string | null;
    ref?: string | null;
    target?: string | null;
    verification?: string | null;
  } | null;
  execution_note?: string | null;
};

const STYLES = {
  allow: { label: "Allow", color: "#22c55e", Icon: Check },
  modify: { label: "Modify", color: "#f59e0b", Icon: Pencil },
  block: { label: "Block", color: "#ef4444", Icon: Ban },
  deferred: { label: "Deferred — not a fit", color: "#64748b", Icon: Clock },
} as const;

export default function DecisionCard({ d }: { d: ControlDecision }) {
  const s = STYLES[d.decision] ?? STYLES.modify;
  const { Icon } = s;

  return (
    <div
      className="not-prose rounded-xl border p-4 space-y-3"
      style={{ borderColor: `${s.color}55`, backgroundColor: `${s.color}0d` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-7 w-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${s.color}22`, color: s.color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-bold text-sm" style={{ color: s.color }}>
          {s.label}
        </span>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-zinc-400">
          {d.risk_tier} risk
        </span>
      </div>

      <p className="text-sm text-zinc-100 leading-relaxed">{d.reason}</p>

      {d.reasoning && d.reasoning !== d.reason && (
        <p className="text-xs text-zinc-400 leading-relaxed">{d.reasoning}</p>
      )}

      {d.deferred && (
        <div className="space-y-1.5 text-xs text-zinc-300 border-t border-white/10 pt-3">
          <div><span className="text-zinc-500">Why not now: </span>{d.deferred.why_not_now}</div>
          <div><span className="text-zinc-500">What would change it: </span>{d.deferred.what_would_change_it}</div>
          {!!d.deferred.improvement_steps?.length && (
            <div>
              <span className="text-zinc-500">What would make it worth doing:</span>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {d.deferred.improvement_steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          <div><span className="text-zinc-500">Reconsider when: </span>{d.deferred.reconsider_when}</div>
        </div>
      )}

      {d.alternatives.length > 0 && (
        <div className="text-xs text-zinc-400">
          <span className="text-zinc-500">Other options weighed: </span>
          {d.alternatives.join(" · ")}
        </div>
      )}

      {(d.execution || d.execution_note) && (
        <div
          className="rounded-lg border p-3 space-y-1.5 text-xs"
          style={{
            borderColor: d.executed ? "#22c55e55" : "#ffffff1a",
            backgroundColor: d.executed ? "#22c55e0d" : "#ffffff08",
          }}
        >
          <div className="flex items-center gap-1.5 font-semibold" style={{ color: d.executed ? "#22c55e" : "#a1a1aa" }}>
            {d.executed ? <Zap className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {d.executed ? "Action carried out" : "Not carried out — assessment only"}
          </div>
          {d.execution?.summary && <p className="text-zinc-300 leading-relaxed">{d.execution.summary}</p>}
          {d.execution_note && <p className="text-zinc-400 leading-relaxed">{d.execution_note}</p>}
          {d.execution?.verification && (
            <p className="text-[11px] text-zinc-500">Verified by: {d.execution.verification}</p>
          )}
          {d.execution?.url && (
            <a
              href={d.execution.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Open result
            </a>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3 text-[11px] font-mono text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          confidence {d.confidence_score}% / bar {d.threshold}%
        </span>
        <span>action: {d.action_type}</span>
        <span>via {d.provider}</span>
        <span>intent: {d.intent_match}</span>
        {d.escalated && <span className="text-amber-400">escalated</span>}
      </div>
    </div>
  );
}
