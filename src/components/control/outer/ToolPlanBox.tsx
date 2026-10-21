// Outer Control: shown under a request before it starts. Which tools will be asked and why, a named tool that is not the chosen
// one, a word that fits two tools, a named product that is not connected, and a chosen tool whose connection needs attention.
// Start waits until each of these is settled (see planBlock).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plug, Sparkles } from "lucide-react";
import { buildToolPlan, planBlock, settleKey, type PlanTool, type ToolPlan } from "@/lib/outer-control-tool-plan";

export type ToolPlanState = { plan: ToolPlan; kept: boolean; keep: () => void; acked: Set<string>; ack: (id: string) => void; block: string | null };

/** The plan for a request, and the person's decisions about it. Decisions are asked again when what needs settling changes. */
export function useToolPlan(text: string, tools: PlanTool[], chosen: string[], max: number): ToolPlanState {
  const plan = useMemo(() => buildToolPlan({ text, tools, chosen, max }), [text, tools, chosen, max]);
  const key = settleKey(plan);
  const [kept, setKept] = useState(false);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  useEffect(() => { setKept(false); }, [key]);
  return {
    plan, kept, acked,
    keep: () => setKept(true),
    ack: (id) => setAcked((a) => new Set(a).add(id)),
    block: planBlock(plan, kept, acked),
  };
}

const btn = "rounded-lg border px-3 py-1 text-xs disabled:opacity-40";
const names = (ts: { name: string }[]) => ts.map((t) => t.name).join(" and ");

export default function ToolPlanBox({
  state, mode, current, max, onUse, onFix, onConnect, fixing,
}: {
  state: ToolPlanState;
  /** session: one tool, the card's own. pick: tools ticked in the form. */
  mode: "session" | "pick";
  /** The tool the session form belongs to. */
  current?: PlanTool;
  max: number;
  /** session: [id] switches to that tool, several ids run them as one Task in that order. pick: ticks these ids in this order. */
  onUse: (ids: string[]) => void;
  onFix: (tool: PlanTool) => void;
  onConnect?: () => void;
  fixing?: string | null;
}) {
  const { plan, kept, keep, acked, ack } = state;
  const named = plan.found.mentions.map((m) => m.tool as PlanTool);
  const unsettled = (plan.missing.length > 0 || plan.ambiguous.length > 0) && !kept;
  if (!plan.summary && !unsettled && plan.notConnected.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="tool-plan">
      {unsettled && plan.missing.length > 0 && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] p-2.5 text-xs text-cyan-50" data-testid="tool-plan-named">
          <p className="flex items-start gap-1.5"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
            {mode === "session" && current
              ? named.length === 1
                ? <span>You named <b>{plan.missing[0].name}</b>, but this session is for <b>{current.name}</b>.</span>
                : <span>You named <b>{names(named)}</b>.</span>
              : plan.tooMany
                ? <span>You named {named.length} tools: {names(named)}. This form asks at most {max}. Tick the ones to use.</span>
                : <span>You named <b>{names(plan.missing)}</b>. Ask {plan.missing.length === 1 ? "it" : "them"} for this task?</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {mode === "session" && current ? (
              named.length === 1
                ? <button type="button" className={`${btn} border-cyan-500/50 bg-cyan-500/15 text-cyan-100`} onClick={() => onUse([plan.missing[0].id])}>Use {plan.missing[0].name} instead</button>
                : <button type="button" className={`${btn} border-cyan-500/50 bg-cyan-500/15 text-cyan-100`} onClick={() => onUse(named.map((t) => t.id))}>Run as one Task: {named.map((t) => t.name).join(" → ")}</button>
            ) : !plan.tooMany && (
              <button type="button" className={`${btn} border-cyan-500/50 bg-cyan-500/15 text-cyan-100`} onClick={() => onUse(named.map((t) => t.id).slice(0, max))}>Yes, use {plan.missing.length === 1 ? "it" : "them"}</button>
            )}
            {(mode === "pick" ? plan.steps.length > 0 : !!current) && (
              <button type="button" className={`${btn} border-white/20 text-zinc-200 hover:bg-white/10`} onClick={keep}>
                Keep {mode === "session" && current ? current.name : "my choice"}
              </button>
            )}
          </div>
        </div>
      )}
      {unsettled && plan.missing.length === 0 && plan.ambiguous.map((a) => (
        <div key={a.word} className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] p-2.5 text-xs text-cyan-50" data-testid="tool-plan-ambiguous">
          <p>“{a.word}” fits more than one connected tool. Which one?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {a.tools.map((t) => (
              <button key={t.id} type="button" className={`${btn} border-cyan-500/50 bg-cyan-500/15 text-cyan-100`}
                onClick={() => onUse(mode === "pick" ? [...plan.steps.map((s) => s.tool.id).filter((id) => !a.tools.some((x) => x.id === id)), t.id].slice(0, max) : [t.id])}>
                {t.name}
              </button>
            ))}
            {(mode === "pick" ? plan.steps.length > 0 : !!current) && <button type="button" className={`${btn} border-white/20 text-zinc-200 hover:bg-white/10`} onClick={keep}>Keep {mode === "session" && current ? current.name : "my choice"}</button>}
          </div>
        </div>
      ))}
      {plan.notConnected.map((n) => (
        <p key={n.brand} className="flex flex-wrap items-center gap-2 text-xs text-zinc-400" data-testid="tool-plan-not-connected">
          <Plug className="h-3.5 w-3.5 text-zinc-500" /> {n.brand} is named but not connected, so it can not be asked.
          {onConnect && <button type="button" onClick={onConnect} className="text-cyan-300 underline-offset-2 hover:underline">Connect it</button>}
        </p>
      ))}
      {plan.warnings.filter((w) => !acked.has(w.tool.id)).map((w) => (
        <div key={w.tool.id} className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-xs text-amber-50" data-testid="tool-plan-warning">
          <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span><b>{w.tool.name}</b> {w.health.key === "failed" ? "failed its last test" : "needs attention"}: {w.health.reason}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {w.fix === "test" ? (
              <>
                <button type="button" disabled={fixing === w.tool.id} className={`${btn} border-amber-500/50 bg-amber-500/15 text-amber-100`} onClick={() => onFix(w.tool)}>{fixing === w.tool.id ? "Testing…" : "Fix connection first"}</button>
                <button type="button" className={`${btn} border-white/20 text-zinc-200 hover:bg-white/10`} onClick={() => ack(w.tool.id)}>Proceed anyway</button>
              </>
            ) : (
              <button type="button" className={`${btn} border-amber-500/50 bg-amber-500/15 text-amber-100`} onClick={() => ack(w.tool.id)}>Continue: I will approve the first contact</button>
            )}
          </div>
        </div>
      ))}
      {plan.summary && <p className="text-xs text-zinc-400" data-testid="tool-plan-summary">{plan.summary}</p>}
    </div>
  );
}
