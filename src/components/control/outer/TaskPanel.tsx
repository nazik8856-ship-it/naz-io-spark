// Outer Control: "Start task". One blank box: the person describes the task in their own words; NazAI reads it and picks one of
// the multi-tool actions (opinions, compare, fact-check, rewrite, research, draft + improve, alternatives, explain, key points,
// role answers, multi-step, decision, adaptation, delegation), with its text, background and labels. One line shows the plan, with
// Change to pick another action; when the request is unclear NazAI asks instead of guessing. Every tool reply is checked against
// the person's rules, then one clean result is written. Reading the request is free; starting uses the action's credits.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callDrive } from "@/lib/outer-control-drive";
import { ACTION_INFO, MAX_STYLES, REPORT_KINDS, ROUTING_TEXT, TASK_CREDITS, TASK_LIMITS, type ReportKind } from "@/lib/outer-control-report-doc";
import { checkTaskForm, LABEL_PRESETS, START_LABEL, toolHealth, toolsHint, type ToolHealthInput } from "@/lib/outer-control-tools-ui";
import ToolPlanBox, { useToolPlan } from "./ToolPlanBox";

const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";
/** How long NazAI waits after the last keystroke before reading the request. */
export const READ_DELAY_MS = 1000;

export type TaskTool = ToolHealthInput & { id: string; name: string; model?: string | null; endpoint_url?: string | null };
export type TaskRequest = { kind: ReportKind; text: string; background: string; styles: string[]; count: number; toolIds: string[]; keepChoice: boolean };
/** NazAI's reading of the request (outer-control-drive route_task). */
export type TaskRoute = { kind: ReportKind | "unclear"; text: string; background: string; labels: string[]; count: number; question: string; source: "ai" | "rules" };

const clipLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export default function TaskPanel({ open, onOpenChange, tools, busy, onStart, onFix, fixing, onConnect }: {
  open: boolean; onOpenChange: (o: boolean) => void; tools: TaskTool[]; busy: boolean;
  /** Starts the task; resolves true when it was started. */
  onStart: (r: TaskRequest) => Promise<boolean>;
  /** Runs the connection test of a tool that needs attention. */
  onFix?: (tool: TaskTool) => void;
  fixing?: string | null;
  onConnect?: () => void;
}) {
  const [request, setRequest] = useState("");
  const [route, setRoute] = useState<TaskRoute | null>(null);
  const [reading, setReading] = useState(false);
  const [chosenKind, setChosenKind] = useState<ReportKind | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [count, setCount] = useState(3);
  const [customLabel, setCustomLabel] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const readId = useRef(0);

  // NazAI reads the request a moment after the person stops typing. An older reading that arrives late is ignored.
  useEffect(() => {
    const req = request.trim();
    if (req.length < 5) { setRoute(null); setReading(false); return; }
    const id = ++readId.current;
    setReading(true);
    const t = setTimeout(async () => {
      const r = await callDrive("route_task", { request: req });
      if (id !== readId.current) return;
      setReading(false);
      const d = r.data as TaskRoute | null;
      setRoute(r.ok && d && typeof d.kind === "string" ? d : { kind: "unclear", text: req, background: "", labels: [], count: 3, question: "NazAI could not read the request right now. Which of these should it do?", source: "rules" });
    }, READ_DELAY_MS);
    return () => clearTimeout(t);
  }, [request]);

  // What NazAI read fills the lists the person has not filled themselves.
  useEffect(() => {
    if (!route) return;
    if (route.labels.length) setLabels((l) => (l.length ? l : route.labels.slice(0, MAX_STYLES)));
    if (route.count) setCount(route.count);
  }, [route]);

  const kind: ReportKind | null = chosenKind ?? (route && route.kind !== "unclear" ? route.kind : null);
  const lim = kind ? TASK_LIMITS[kind] : null;
  const text = route?.text?.trim() ? route.text : request.trim();
  const background = route?.background ?? "";
  // Tool names choose the tools only where the text is a request; in a text to check, rewrite, explain or adapt they are content.
  const routingText = !kind ? "" : ROUTING_TEXT.includes(kind) ? request : request.replace(text, "");
  const plan = useToolPlan(routingText, tools, picked, lim?.maxTools ?? 1);
  const problem = !kind ? null : checkTaskForm(kind, text, picked, labels, background) ?? plan.block;

  // A different action may take fewer tools: keep the first ones, in order.
  useEffect(() => { if (lim) setPicked((p) => p.slice(0, lim.maxTools)); }, [lim]);
  // Styles, roles and audiences are different lists: a switch to another kind of list starts from what NazAI read for it, if anything.
  const listKind = lim?.labels ?? null;
  useEffect(() => {
    setLabels(route && route.kind !== "unclear" && TASK_LIMITS[route.kind].labels === listKind ? route.labels.slice(0, MAX_STYLES) : []);
  }, [listKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : lim && p.length >= lim.maxTools ? p : [...p, id]));
  const toggleLabel = (l: string) => setLabels((s) => (s.includes(l) ? s.filter((x) => x !== l) : s.length >= MAX_STYLES ? s : [...s, l]));
  const addCustom = () => {
    const l = customLabel.replace(/[;()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (l && !labels.some((x) => x.toLowerCase() === l.toLowerCase()) && labels.length < MAX_STYLES) setLabels([...labels, l]);
    setCustomLabel("");
  };
  const toolsLine = useMemo(() => picked.map((id) => tools.find((t) => t.id === id)?.name ?? "tool").join(" → "), [picked, tools]);

  const reset = () => { setRequest(""); setRoute(null); setChosenKind(null); setLabels([]); setCount(3); setPicked([]); };
  const start = async () => {
    if (busy || !kind || problem || reading) return;
    const ok = await onStart({ kind, text, background, styles: lim?.labels ? labels : [], count, toolIds: picked, keepChoice: plan.kept });
    if (ok) { reset(); onOpenChange(false); }
  };

  const presets = lim?.labels ? LABEL_PRESETS[lim.labels] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-2xl" data-testid="task-panel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><FileText className="h-4 w-4 text-cyan-300" /> Start a task</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Every tool reply is checked against your rules, and you get one clean result.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <textarea className={inputCls} rows={6} aria-label="Describe the task" value={request} onChange={(e) => setRequest(e.target.value)} data-testid="task-request" />

          {(reading || route) && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="task-plan">
              {reading && !route ? (
                <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> NazAI is reading your request…</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {kind ? (
                      <span data-testid="task-plan-line">
                        <span className="text-zinc-400">NazAI will: </span>
                        <span className="font-medium text-cyan-100">{ACTION_INFO[kind].title}</span>
                        {toolsLine && <span className="text-zinc-400"> · {toolsLine}</span>}
                      </span>
                    ) : (
                      <span className="text-amber-100" data-testid="task-question">{route?.question || "Which of these should NazAI do?"}</span>
                    )}
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
                      {kind ? "Change" : "Choose"}
                      <select aria-label="Change the action" className="rounded border border-white/15 bg-black/40 px-2 py-1 text-xs text-zinc-100" value={kind ?? ""}
                        onChange={(e) => setChosenKind((e.target.value || null) as ReportKind | null)}>
                        {!kind && <option value="">Choose an action…</option>}
                        {REPORT_KINDS.map((k) => <option key={k} value={k}>{ACTION_INFO[k].title}</option>)}
                      </select>
                    </label>
                    {reading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" aria-label="Reading again" />}
                  </div>
                  {kind && <p className="mt-1 text-xs text-zinc-500">{ACTION_INFO[kind].blurb.charAt(0).toUpperCase() + ACTION_INFO[kind].blurb.slice(1)}. Uses {TASK_CREDITS[kind]} credit{TASK_CREDITS[kind] === 1 ? "" : "s"}.</p>}
                  {kind && text !== request.trim() && <p className="mt-2 text-xs text-zinc-400" data-testid="task-text"><span className="text-zinc-500">Works on: </span>{clipLine(text, 200)}</p>}
                  {background && <p className="mt-1 text-xs text-zinc-400" data-testid="task-background"><span className="text-zinc-500">Background sent to every tool: </span>{clipLine(background, 200)}</p>}
                </>
              )}
            </div>
          )}

          {kind && presets && (
            <fieldset data-testid="task-labels">
              <legend className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{presets.name} ({labels.length} of up to {MAX_STYLES})</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...presets.presets, ...labels.filter((l) => !presets.presets.includes(l))].map((l) => {
                  const on = labels.includes(l);
                  return (
                    <button key={l} type="button" aria-pressed={on} onClick={() => toggleLabel(l)} disabled={!on && labels.length >= MAX_STYLES}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${on ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100" : "border-white/15 text-zinc-300 hover:bg-white/10"}`}>
                      {l}{on && !presets.presets.includes(l) && <X className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <input className={inputCls} aria-label={`Another ${lim!.labels === "styles" ? "style" : lim!.labels === "roles" ? "role" : "audience"}`} placeholder={presets.placeholder} value={customLabel} maxLength={40}
                  onChange={(e) => setCustomLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
                <button type="button" onClick={addCustom} disabled={!customLabel.trim() || labels.length >= MAX_STYLES} className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 px-3 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
            </fieldset>
          )}

          {kind && lim?.options && (
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              Options to ask for
              <select aria-label="Options to ask for" className="rounded border border-white/15 bg-black/40 px-2 py-1 text-xs" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: lim.options.max - lim.options.min + 1 }, (_, i) => lim.options!.min + i).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}

          {kind && (
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
                            <input type="checkbox" checked={idx >= 0} disabled={idx < 0 && picked.length >= lim!.maxTools} onChange={() => toggle(t.id)} aria-label={`Ask ${t.name}`} />
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
              {lim!.minTools > tools.length && tools.length > 0 && <p className="mt-2 text-xs text-amber-200/90">{ACTION_INFO[kind].title} needs at least {lim!.minTools} connected tools.</p>}
            </fieldset>
          )}

          {kind && <ToolPlanBox state={plan} mode="pick" max={lim!.maxTools} busy={busy} onUse={setPicked} onFix={(t) => onFix?.(t as TaskTool)} fixing={fixing} onConnect={onConnect} />}
          {kind && problem && <p className="text-xs text-zinc-400" data-testid="task-problem">{problem}</p>}
          <button type="button" disabled={busy || !kind || !!problem || reading} onClick={start} data-testid="task-start"
            className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">
            {busy ? "Starting…" : kind ? START_LABEL[kind] : "Start"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
