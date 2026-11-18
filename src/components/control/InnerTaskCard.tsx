// Inner Control chat: a task the chat offered, then ran. Before it starts the card says what runs, with which of NazAI's built-in
// tools, and what it costs; the person runs it or says not now. Once started it shows where the Task is, then the one controlled
// result with what the person's rules did to it, and a link to the full result in Outer Control.
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, Play, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePoller } from "@/hooks/usePoller";
import { ocRead } from "@/lib/outer-control-read";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";
import { changedCount, excerpt, progressLine, rulesLine, TASK_DONE, TASK_ENDED, type InnerTaskOffer } from "@/lib/inner-chat-task";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

type Phase = "offer" | "starting" | "running" | "done" | "ended" | "declined";

export default function InnerTaskCard({ offer, accountId, rulesActive }: { offer: InnerTaskOffer; accountId: string | null | undefined; rulesActive: number }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("offer");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [line, setLine] = useState("Starting…");
  const [result, setResult] = useState<string>("");
  const [changed, setChanged] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    setPhase("starting"); setProblem(null);
    try {
      const { data, error } = await supabase.functions.invoke("control-system-decide", {
        body: { action: "run_task", kind: offer.kind, request: offer.request, account_id: accountId || undefined },
      });
      if (error) throw error;
      const d = data as { mode?: string; task_id?: string; error?: string; message?: string };
      if (d?.error || !d?.task_id) throw new Error(d?.message || d?.error || "The task could not be started.");
      setTaskId(d.task_id); setPhase("running");
    } catch (e) {
      setProblem((await extractFunctionErrorMessage(e)) ?? (e as Error)?.message ?? "The task could not be started.");
      setPhase("offer");
    }
  };

  /** One look at the Task: its legs, the verdicts on its answers, and its result once it is done. Returns true while it runs. */
  const check = useCallback(async () => {
    if (!taskId) return false;
    const [wf, legs] = await Promise.all([
      ocRead("outer_control_workflows").select("id, status, final_output, stop_reason").eq("id", taskId).maybeSingle(),
      anyDb.from("outer_control_sessions").select("id, status").eq("workflow_id", taskId),
    ]);
    const w = wf.data as { status: string; final_output: string | null; stop_reason: string | null } | null;
    const legRows = (legs.data ?? []) as { id: string; status: string }[];
    if (!w) return true;
    if (legRows.length) {
      const st = await anyDb.from("outer_control_session_steps").select("verdict").in("session_id", legRows.map((l) => l.id));
      setChanged(changedCount((st.data ?? []) as { verdict: string | null }[]));
    }
    if (TASK_DONE.has(w.status)) { setResult(w.final_output ?? ""); setPhase("done"); return false; }
    if (TASK_ENDED.has(w.status)) { setProblem(w.stop_reason || "The task ended without a result. Its credit is given back."); setPhase("ended"); return false; }
    setLine(progressLine(legRows, w.status));
    return true;
  }, [taskId]);

  usePoller(check, { active: phase === "running", fast: true });

  const shown = excerpt(result);
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.05] p-3 text-sm" data-testid="inner-task-card" data-phase={phase}>
      <div className="text-[11px] font-mono uppercase tracking-wider text-cyan-300">{offer.title}</div>
      <p className="text-zinc-100">“{offer.request}”</p>

      {(phase === "offer" || phase === "starting") && (
        <>
          <p className="text-xs text-zinc-300" data-testid="inner-task-offer-line">{offer.line}</p>
          {problem && <p className="text-xs text-rose-300" role="alert">{problem}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void run()} disabled={phase === "starting"} data-testid="inner-task-run"
              className="flex items-center gap-1.5 rounded-lg border border-cyan-300/60 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-50">
              {phase === "starting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {phase === "starting" ? "Starting…" : offer.credits === 0 ? "Run it (free)" : `Run it (${offer.credits} credit${offer.credits === 1 ? "" : "s"})`}
            </button>
            <button type="button" onClick={() => setPhase("declined")} disabled={phase === "starting"} data-testid="inner-task-decline"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">Not now</button>
          </div>
        </>
      )}

      {phase === "declined" && <p className="text-xs text-zinc-500">Not run. Nothing was charged.</p>}

      {phase === "running" && (
        <p className="flex items-center gap-2 text-xs text-cyan-100" data-testid="inner-task-progress"><Loader2 className="h-3.5 w-3.5 animate-spin" />{line}</p>
      )}

      {phase === "done" && (
        <>
          <p className="flex items-center gap-1.5 text-xs text-emerald-200" data-testid="inner-task-rules"><ShieldCheck className="h-3.5 w-3.5" />{rulesLine(rulesActive, changed)}</p>
          <div className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-2.5 text-[13px] leading-relaxed text-zinc-100" data-testid="inner-task-result">{shown.text || "The result is empty."}</div>
          <button type="button" onClick={() => navigate("/control-system/outer")} data-testid="inner-task-open"
            className="flex items-center gap-1.5 text-xs text-cyan-300 hover:underline"><CheckCircle2 className="h-3.5 w-3.5" />{shown.more ? "Read the full result in Outer Control" : "See it with its proof in Outer Control"}</button>
        </>
      )}

      {phase === "ended" && <p className="flex items-start gap-1.5 text-xs text-rose-200" data-testid="inner-task-ended"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{problem}</p>}
    </div>
  );
}
