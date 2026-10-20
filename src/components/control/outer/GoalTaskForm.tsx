// Outer Control: start a Task from a goal. The person says what they want, which tools may be asked (up to three) and, if they
// like, what must be true of the result. Outer Control keeps asking, checking each controlled answer against those criteria,
// until they are met, a limit is reached, or it needs a decision.
import { useState } from "react";
import { toast } from "sonner";
import { callDrive } from "@/lib/outer-control-drive";
import { MAX_CRITERIA, MAX_GOAL_TOOLS, parseCriteriaLines } from "@/lib/outer-control-goal-ui";

type ToolOpt = { id: string; name: string };
const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";

export default function GoalTaskForm({ tools, onStarted }: { tools: ToolOpt[]; onStarted: () => void | Promise<void> }) {
  const [goal, setGoal] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [rounds, setRounds] = useState(4);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_GOAL_TOOLS ? c : [...c, id]));

  const start = async () => {
    if (!goal.trim()) { toast.error("Describe the goal."); return; }
    if (chosen.length === 0) { toast.error("Choose at least one tool to ask."); return; }
    const parsed = parseCriteriaLines(criteriaText);
    if (parsed.ok === false) { toast.error(parsed.message); return; }
    setBusy(true);
    const r = await callDrive("start_goal", { goal, criteria: parsed.criteria.length ? parsed.criteria : undefined, tool_ids: chosen, max_rounds: rounds });
    setBusy(false);
    if (!r.ok) { toast.error(r.message || "That did not work."); return; }
    toast.success("Started. It keeps going until the done criteria are met or it needs you.");
    setGoal(""); setCriteriaText(""); setChosen([]); setRounds(4);
    await onStarted();
  };

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-3" data-testid="goal-form">
      {tools.length === 0 && <p className="text-sm text-amber-200">Connect a tool in Connected tools first.</p>}
      <input className={inputCls} aria-label="Goal" placeholder="What do you want done? e.g. Find the return rules for premium customers" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <textarea
        className={inputCls} rows={3} aria-label="Done criteria"
        placeholder={`Done when… (optional, one per line, up to ${MAX_CRITERIA}). e.g. States the return window. Leave empty to check only that the answer addresses the goal.`}
        value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)}
      />
      <fieldset>
        <legend className="mb-1 text-xs text-zinc-400">Tools it may ask (up to {MAX_GOAL_TOOLS}; the first is asked first)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {tools.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5 text-sm text-zinc-200">
              <input type="checkbox" checked={chosen.includes(t.id)} disabled={!chosen.includes(t.id) && chosen.length >= MAX_GOAL_TOOLS} onChange={() => toggle(t.id)} aria-label={`Ask ${t.name}`} />
              {t.name}{chosen.includes(t.id) && chosen.length > 1 ? <span className="text-[11px] text-zinc-500">#{chosen.indexOf(t.id) + 1}</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300">
        <label className="flex items-center gap-2">
          Most rounds
          <select className="rounded border border-white/10 bg-black/30 px-2 py-1" aria-label="Most rounds" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="text-zinc-500">Uses 1 credit. It is given back if the Task ends without a result.</span>
        <button disabled={busy || tools.length === 0} onClick={start} className="ml-auto rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-1.5 text-xs font-mono uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40">
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
    </div>
  );
}
