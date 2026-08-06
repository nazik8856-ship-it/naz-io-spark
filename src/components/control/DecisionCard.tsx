import { Check, Pencil, Ban, Clock, ShieldCheck } from "lucide-react";

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
    reconsider_when: string;
  } | null;
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
          <div><span className="text-zinc-500">Reconsider when: </span>{d.deferred.reconsider_when}</div>
        </div>
      )}

      {d.alternatives.length > 0 && (
        <div className="text-xs text-zinc-400">
          <span className="text-zinc-500">Other options weighed: </span>
          {d.alternatives.join(" · ")}
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
