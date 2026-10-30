import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Play, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FIRST_VALUE_TASKS } from "@/lib/first-value";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // outer_control_workflows is not in the generated types

/** First-value onboarding: where the person is (about to start, a task running, a result ready) and the way to the full NazAI. */
export type FirstValueProgress = { done: number; running: boolean };

export function firstValueStage(p: FirstValueProgress): "start" | "running" | "ready" | "finished" {
  if (p.done >= FIRST_VALUE_TASKS) return "finished";
  if (p.done >= 1) return "ready";
  return p.running ? "running" : "start";
}

const OPEN = new Set(["queued", "running", "awaiting_human"]);

export default function FirstValueBanner({ accountId, onStartTask, onOpenFull, onFinished }: {
  accountId: string | null | undefined;
  /** "first": who runs it is still to be chosen; "again": Start task with the tools already there. */
  onStartTask: (which: "first" | "again") => void;
  onOpenFull: () => void;
  /** Called once when the last first task is done: the full interface opens from then on. */
  onFinished?: () => void;
}) {
  const [progress, setProgress] = useState<FirstValueProgress>({ done: 0, running: false });
  useEffect(() => {
    if (!accountId) return;
    let stop = false;
    const read = async () => {
      try {
        const { data } = await anyDb.from("outer_control_workflows").select("status").eq("user_id", accountId);
        const rows = (Array.isArray(data) ? data : []) as { status: string }[];
        if (!stop) setProgress({ done: rows.filter((r) => r.status === "completed").length, running: rows.some((r) => OPEN.has(r.status)) });
      } catch { /* keep what is shown */ }
    };
    void read();
    const id = setInterval(read, 4000);
    return () => { stop = true; clearInterval(id); };
  }, [accountId]);

  const stage = firstValueStage(progress);
  const [announced, setAnnounced] = useState(false);
  useEffect(() => { if (stage === "finished" && !announced) { setAnnounced(true); onFinished?.(); } }, [stage, announced, onFinished]);
  const dots = Array.from({ length: FIRST_VALUE_TASKS }, (_, i) => i < progress.done);

  return (
    <div className="oc-in relative overflow-hidden rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/[0.10] via-[#061226] to-emerald-400/[0.06] px-5 py-4 shadow-[0_0_40px_-16px_rgba(34,211,238,0.6)]" data-testid="first-value-banner" data-stage={stage}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-400/15 blur-[70px] oc-glow" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-400/15">
            {stage === "running" ? <Loader2 className="h-4 w-4 animate-spin text-cyan-100" /> : stage === "start" ? <ShieldCheck className="h-4 w-4 text-cyan-100" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200/80">
              Your first controlled tasks
              <span className="flex gap-1" aria-label={`${progress.done} of ${FIRST_VALUE_TASKS} done`}>
                {dots.map((on, i) => <i key={i} className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-300 shadow-[0_0_6px_#6ee7b7]" : "bg-white/20"}`} />)}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-100" data-testid="first-value-message">
              {stage === "start" && "Describe what you need. NazAI asks the AI, checks every reply against your rules and gives you one clean result."}
              {stage === "running" && "NazAI is asking the AI and checking every reply. Your result appears below, in Your tasks."}
              {stage === "ready" && "Your first clean, rule-checked result is ready: open it below, in Your tasks."}
              {stage === "finished" && `You have run ${FIRST_VALUE_TASKS} controlled tasks. The full NazAI is ready for you.`}
            </p>
            {stage === "running" && <div className="mt-2 h-1 w-48 overflow-hidden rounded-full bg-white/10"><div className="oc-flow h-full w-full" /></div>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(stage === "start" || stage === "ready") && (
            <button type="button" onClick={() => onStartTask(stage === "start" ? "first" : "again")} className="flex items-center gap-1.5 rounded-lg border border-cyan-300/60 bg-cyan-400 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_18px_rgba(34,211,238,0.3)] hover:bg-cyan-300" data-testid="first-value-task">
              <Play className="h-3.5 w-3.5" /> {stage === "start" ? "Start a task" : "Run another task"}
            </button>
          )}
          {(stage === "ready" || stage === "finished") && (
            <button type="button" onClick={onOpenFull} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${stage === "finished" ? "border border-emerald-300/60 bg-emerald-400 text-black hover:bg-emerald-300" : "border border-white/20 text-zinc-100 hover:bg-white/10"}`} data-testid="first-value-open-full">
              Open full NazAI <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
