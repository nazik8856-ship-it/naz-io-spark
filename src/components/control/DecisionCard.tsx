import { useState } from "react";
import { Check, Pencil, Ban, Clock, ShieldCheck, Zap, ExternalLink, AlertTriangle, Undo2, Lock, Loader2 } from "lucide-react";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";

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
  reversibility?: {
    reversible: boolean;
    undo_kind: string;
    undo_effect?: string | null;
    irreversible_reason?: string | null;
    reversal_id?: string | null;
    undoable_now?: boolean;
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
  const rev = d.reversibility ?? null;
  const [undoState, setUndoState] = useState<"idle" | "running" | "undone" | "failed">("idle");
  const [undoMsg, setUndoMsg] = useState<string | null>(null);

  const handleUndo = async () => {
    if (!d.decision_id) return;
    setUndoState("running");
    setUndoMsg(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-engine/undo/${d.decision_id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${sess?.session?.access_token ?? SUPABASE_ANON}`,
        },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body?.ok === true;
      setUndoState(ok ? "undone" : "failed");
      setUndoMsg(String(body?.summary || body?.message || (ok ? "Reversed." : "The undo did not complete.")));
    } catch (e) {
      setUndoState("failed");
      setUndoMsg(e instanceof Error ? e.message : "The undo request failed.");
    }
  };


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
            borderColor: d.dry_run ? "#f59e0b55" : d.executed ? "#22c55e55" : "#ffffff1a",
            backgroundColor: d.dry_run ? "#f59e0b0d" : d.executed ? "#22c55e0d" : "#ffffff08",
          }}
        >
          <div
            className="flex items-center gap-1.5 font-semibold"
            style={{ color: d.dry_run ? "#f59e0b" : d.executed ? "#22c55e" : "#a1a1aa" }}
          >
            {d.executed && !d.dry_run ? <Zap className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {d.dry_run
              ? "Dry run — nothing was carried out"
              : d.executed ? "Action carried out" : "Not carried out — assessment only"}
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

          {rev && d.executed && !d.dry_run && (
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              {rev.reversible ? (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={undoState === "running" || undoState === "undone" || !rev.undoable_now}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                    >
                      {undoState === "running"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Undo2 className="h-3 w-3" />}
                      {undoState === "undone" ? "Undone" : undoState === "running" ? "Undoing…" : "Undo this action"}
                    </button>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400/80">reversible</span>
                  </div>
                  {rev.undo_effect && undoState === "idle" && (
                    <p className="text-[11px] text-zinc-500">Undo {rev.undo_effect}.</p>
                  )}
                </>
              ) : (
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-red-300">
                    <Lock className="h-3 w-3" /> irreversible
                  </span>
                  {rev.irreversible_reason && (
                    <p className="text-[11px] text-zinc-500">{rev.irreversible_reason}</p>
                  )}
                </div>
              )}
              {undoMsg && (
                <p className={`text-[11px] ${undoState === "undone" ? "text-emerald-400" : "text-red-400"}`}>{undoMsg}</p>
              )}
            </div>
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
