// Outer Control: where a goal Task stands. In progress, Blocked or Completed; which done criteria are met (with the quoted
// evidence), which round it is on, and, when it is blocked, why and the three ways out.
import { CheckCircle2, Circle } from "lucide-react";
import { blockedActions, criteriaList, criteriaProgress, goalHeadline, roundsLine, type GoalTaskView } from "@/lib/outer-control-goal-ui";
import type { HonestStatus } from "@/lib/outer-control-status";

const HEAD_CLS = {
  in_progress: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
  blocked: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
} as const;

export default function GoalProgress({
  task, status, busy, onDecide,
}: {
  task: GoalTaskView;
  status: HonestStatus;
  busy: boolean;
  onDecide: (decision: "accept" | "more" | "stop") => void;
}) {
  const head = goalHeadline(status.key);
  const criteria = criteriaList(task);
  const { met, total } = criteriaProgress(task);
  const actions = blockedActions(task);
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3" data-testid="goal-progress">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${HEAD_CLS[head.key]}`} data-testid="goal-headline" data-state={head.key}>{head.label}</span>
        <span className="text-xs text-zinc-400" data-testid="goal-rounds">{roundsLine(task)}</span>
        {total > 0 && <span className="text-xs text-zinc-400" data-testid="goal-met">{met} of {total} done criteria met</span>}
      </div>

      {criteria.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Done criteria">
          {criteria.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs" data-testid="goal-criterion" data-met={String(c.met)}>
              {c.met === true
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" aria-label="Met" />
                : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Not met yet" />}
              <div className="min-w-0">
                <div className={c.met === true ? "text-zinc-200" : "text-zinc-400"}>{c.text}</div>
                {c.met === true && c.evidence && <div className="mt-0.5 break-words text-[11px] text-zinc-500">“{c.evidence}”{c.round ? ` (round ${c.round})` : ""}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {actions.accept && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5" data-testid="goal-blocked">
          <p className="text-xs text-amber-100">{task.blocked_reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => onDecide("accept")} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40">Accept as done</button>
            <button disabled={busy || !actions.more} onClick={() => onDecide("more")} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40">Allow 2 more rounds</button>
            <button disabled={busy} onClick={() => onDecide("stop")} className="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40">Stop</button>
          </div>
        </div>
      )}
    </div>
  );
}
