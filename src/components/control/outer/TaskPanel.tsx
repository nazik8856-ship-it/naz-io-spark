// Outer Control: "Start task". The first set of multi-tool actions with external AIs: get multiple opinions, compare answers,
// fact-check / challenge, rewrite in different styles. Each tool is asked on its own, every reply is checked against your rules,
// then one clean result is written and attached as the Task's final result. Uses one credit.
import { useEffect, useMemo, useState } from "react";
import { FileText, GitCompare, Plus, ShieldQuestion, Users, Wand2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_STYLES, TASK_LIMITS, type ReportKind } from "@/lib/outer-control-report-doc";
import { checkTaskForm, STYLE_PRESETS, TASK_ACTIONS, toolHealth, toolsHint, type ToolHealthInput } from "@/lib/outer-control-tools-ui";
import ToolPlanBox, { useToolPlan } from "./ToolPlanBox";

const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";
const ICON: Record<ReportKind, typeof Users> = { opinions: Users, compare: GitCompare, factcheck: ShieldQuestion, rewrite: Wand2 };

export type TaskTool = ToolHealthInput & { id: string; name: string; model?: string | null; endpoint_url?: string | null };
export type TaskRequest = { kind: ReportKind; text: string; styles: string[]; toolIds: string[]; keepChoice: boolean };

export default function TaskPanel({ open, onOpenChange, tools, busy, onStart, onFix, fixing, onConnect }: {
  open: boolean; onOpenChange: (o: boolean) => void; tools: TaskTool[]; busy: boolean;
  /** Starts the task; resolves true when it was started. */
  onStart: (r: TaskRequest) => Promise<boolean>;
  /** Runs the connection test of a tool that needs attention. */
  onFix?: (tool: TaskTool) => void;
  fixing?: string | null;
  onConnect?: () => void;
}) {
  const [kind, setKind] = useState<ReportKind>("opinions");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [customStyle, setCustomStyle] = useState("");
  const action = TASK_ACTIONS.find((a) => a.kind === kind)!;
  const lim = TASK_LIMITS[kind];
  // A question or prompt may name the tools to ask; a claim or a text to rewrite is content, so it is not read for tool names.
  const routingText = kind === "opinions" || kind === "compare" ? text : "";
  const plan = useToolPlan(routingText, tools, picked, lim.maxTools);
  const problem = checkTaskForm(kind, text, picked, styles) ?? (text.trim() ? plan.block : null);

  // A different action may take fewer tools: keep the first ones, in order.
  useEffect(() => { setPicked((p) => p.slice(0, TASK_LIMITS[kind].maxTools)); }, [kind]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= lim.maxTools ? p : [...p, id]));
  const toggleStyle = (st: string) => setStyles((s) => (s.includes(st) ? s.filter((x) => x !== st) : s.length >= MAX_STYLES ? s : [...s, st]));
  const addCustom = () => {
    const st = customStyle.replace(/[;()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (st && !styles.some((x) => x.toLowerCase() === st.toLowerCase()) && styles.length < MAX_STYLES) setStyles([...styles, st]);
    setCustomStyle("");
  };
  const count = useMemo(() => text.trim().length, [text]);

  const start = async () => {
    if (busy || problem) return;
    const ok = await onStart({ kind, text: kind === "factcheck" || kind === "rewrite" ? text.trim() : text.replace(/\s+/g, " ").trim(), styles, toolIds: picked, keepChoice: plan.kept });
    if (ok) { setText(""); setPicked([]); setStyles([]); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-2xl" data-testid="task-panel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><FileText className="h-4 w-4 text-cyan-300" /> Start a task</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Pick what to do. Each tool is asked on its own, every reply is checked against your rules, and you get one clean result. It uses one credit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div role="radiogroup" aria-label="What to do" className="grid gap-2 sm:grid-cols-2">
            {TASK_ACTIONS.map((a) => {
              const Icon = ICON[a.kind];
              const on = a.kind === kind;
              return (
                <button key={a.kind} type="button" role="radio" aria-checked={on} onClick={() => setKind(a.kind)} data-testid={`task-kind-${a.kind}`}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${on ? "border-cyan-400/60 bg-cyan-500/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}>
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-cyan-300" : "text-zinc-400"}`} />
                  <span>
                    <span className={`block text-sm font-medium ${on ? "text-cyan-100" : "text-zinc-100"}`}>{a.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-zinc-400">{a.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            <label htmlFor="task-text" className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span>{action.field}</span><span className={count > lim.maxText ? "text-rose-300" : ""}>{count}/{lim.maxText}</span>
            </label>
            <textarea id="task-text" className={inputCls} rows={kind === "factcheck" || kind === "rewrite" ? 5 : 3} aria-label={action.field} placeholder={action.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          {kind === "rewrite" && (
            <fieldset data-testid="task-styles">
              <legend className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Styles ({styles.length} of up to {MAX_STYLES})</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...STYLE_PRESETS, ...styles.filter((s) => !STYLE_PRESETS.includes(s))].map((st) => {
                  const on = styles.includes(st);
                  return (
                    <button key={st} type="button" aria-pressed={on} onClick={() => toggleStyle(st)} disabled={!on && styles.length >= MAX_STYLES}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${on ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100" : "border-white/15 text-zinc-300 hover:bg-white/10"}`}>
                      {st}{on && !STYLE_PRESETS.includes(st) && <X className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <input className={inputCls} aria-label="Another style" placeholder="Another style, e.g. for a 10-year-old" value={customStyle} maxLength={40}
                  onChange={(e) => setCustomStyle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
                <button type="button" onClick={addCustom} disabled={!customStyle.trim() || styles.length >= MAX_STYLES} className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 px-3 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{toolsHint(kind)}, in this order ({picked.length} chosen)</legend>
            {tools.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Connect a tool first.</p> : (
              <ul className="mt-2 space-y-1.5">
                {tools.map((t) => {
                  const h = toolHealth(t);
                  const idx = picked.indexOf(t.id);
                  return (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]">
                        <span className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" checked={idx >= 0} disabled={idx < 0 && picked.length >= lim.maxTools} onChange={() => toggle(t.id)} aria-label={`Ask ${t.name}`} />
                          <span className="truncate text-zinc-100">{t.name}</span>
                          {idx >= 0 && <span className="rounded-full border border-cyan-500/40 px-1.5 text-[10px] text-cyan-300">#{idx + 1}</span>}
                        </span>
                        <span className={`shrink-0 text-xs ${h.key === "working" ? "text-emerald-300" : h.key === "failed" ? "text-rose-300" : "text-amber-300"}`}>{h.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {kind === "compare" && tools.length === 1 && <p className="mt-2 text-xs text-amber-200/90">Comparing needs at least two connected tools.</p>}
          </fieldset>

          <ToolPlanBox state={plan} mode="pick" max={lim.maxTools} busy={busy} onUse={setPicked} onFix={(t) => onFix?.(t as TaskTool)} fixing={fixing} onConnect={onConnect} />
          {problem && (text || picked.length > 0) && <p className="text-xs text-zinc-400" data-testid="task-problem">{problem}</p>}
          <button type="button" disabled={busy || !!problem} onClick={start} data-testid="task-start"
            className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">
            {busy ? "Starting…" : action.start}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
