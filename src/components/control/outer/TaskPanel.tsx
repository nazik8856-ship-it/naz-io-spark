// Outer Control: "Start task". One blank box: the person describes the task in their own words; NazAI reads it and picks one of
// the multi-tool actions (opinions, compare, fact-check, rewrite, research, draft + improve, alternatives, explain, key points,
// role answers, multi-step, decision, adaptation, delegation), with its text, background and labels. One line shows the plan, with
// Change to pick another action; when the request is unclear NazAI asks instead of guessing. Every tool reply is checked against
// the person's rules, then one clean result is written. Reading the request is free; starting uses the action's credits.
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Coins, FileEdit, Gauge, Lightbulb, ListChecks, ListOrdered, Loader2, Megaphone, Network, PenLine, Plus, Scale, Search, ShieldCheck, Sparkles, Target, UserCog, Users, Wand2, X, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callDrive } from "@/lib/outer-control-drive";
import { ACTION_INFO, MAX_STYLES, REPORT_KINDS, ROUTING_TEXT, TASK_CREDITS, TASK_LIMITS, type ReportKind } from "@/lib/outer-control-report-doc";
import { checkTaskForm, describeRecord, LABEL_PRESETS, START_LABEL, suggestTools, toolHealth, toolsHint, type ToolHealthInput, type ToolRecord } from "@/lib/outer-control-tools-ui";
import ToolPlanBox, { useToolPlan } from "./ToolPlanBox";

const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";
const sectionTitle = "font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500";

/** One icon per action, for the plan card. */
const KIND_ICON: Record<ReportKind, LucideIcon> = {
  opinions: Users, compare: Scale, factcheck: ShieldCheck, rewrite: PenLine, research: Search, draft: FileEdit, alternatives: Lightbulb,
  explain: BookOpen, keypoints: ListChecks, roles: UserCog, multistep: ListOrdered, decision: Target, adapt: Megaphone, delegate: Network,
};

/** Ready-made requests under the empty box: one press fills it in. */
export const EXAMPLES = [
  "Should we launch a free plan? Get opinions from my tools.",
  "Fact-check: The Eiffel Tower was finished in 1889 and is in Berlin.",
  "Give me 4 names for a budgeting app",
  "We have 8 months of runway. Should we hire an engineer or buy ads?",
  "Adapt this for LinkedIn and X: Our app is live today.",
  "Explain simply: how does a vaccine train the immune system?",
];
/** How long NazAI waits after the last keystroke before reading the request. */
export const READ_DELAY_MS = 1000;

export type TaskTool = ToolHealthInput & { id: string; name: string; model?: string | null; endpoint_url?: string | null };
export type TaskRequest = { kind: ReportKind; text: string; background: string; styles: string[]; count: number; toolIds: string[]; keepChoice: boolean };
/** NazAI's reading of the request (outer-control-drive route_task). */
export type TaskRoute = { kind: ReportKind | "unclear"; text: string; background: string; labels: string[]; count: number; question: string; source: "ai" | "rules" };

/** What NazAI already read in this page, so the same request (ignoring case, spacing and a final full stop) is not read twice. */
const readings = new Map<string, TaskRoute>();
const MAX_READINGS = 50;
const readKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.!?\s]+$/, "").trim();
/** Forgets what was read (tests). */
export const forgetReadings = () => readings.clear();

const clipLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The imported project a task works with: its checked text goes to every tool. */
export type TaskProject = { id: string; name: string; mode: "snapshot" | "linked" };

export default function TaskPanel({ open, onOpenChange, tools, busy, onStart, onFix, fixing, onConnect, project, onClearProject, records }: {
  open: boolean; onOpenChange: (o: boolean) => void; tools: TaskTool[]; busy: boolean;
  /** Starts the task; resolves true when it was started. */
  onStart: (r: TaskRequest) => Promise<boolean>;
  /** Runs the connection test of a tool that needs attention. */
  onFix?: (tool: TaskTool) => void;
  fixing?: string | null;
  onConnect?: () => void;
  project?: TaskProject | null;
  onClearProject?: () => void;
  /** Each tool's track record over the last 30 days (for the suggestion and the line under each tool). */
  records?: Map<string, ToolRecord>;
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
    const id = ++readId.current;
    if (req.length < 5) { setRoute(null); setReading(false); return; }
    const known = readings.get(readKey(req));
    if (known) { setRoute(known); setReading(false); return; }
    setReading(true);
    const t = setTimeout(async () => {
      const r = await callDrive("route_task", { request: req });
      if (id !== readId.current) return;
      setReading(false);
      const d = r.data as TaskRoute | null;
      if (r.ok && d && typeof d.kind === "string") {
        if (readings.size >= MAX_READINGS) readings.delete(readings.keys().next().value as string);
        readings.set(readKey(req), d);
        setRoute(d);
      } else {
        setRoute({ kind: "unclear", text: req, background: "", labels: [], count: 3, question: "NazAI could not read the request right now. Which of these should it do?", source: "rules" });
      }
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
  // NazAI's suggestion: the most reliable working tools, with the reasons.
  const suggestion = useMemo(() => !lim || !records ? [] : suggestTools(records, tools.map((t) => ({ id: t.id, name: t.name, working: toolHealth(t).key === "working" })), Math.max(lim.minTools, Math.min(lim.maxTools, 2))), [lim, records, tools]);
  const toolsLine = useMemo(() => picked.map((id) => tools.find((t) => t.id === id)?.name ?? "tool").join(" → "), [picked, tools]);

  const reset = () => { setRequest(""); setRoute(null); setChosenKind(null); setLabels([]); setCount(3); setPicked([]); };
  const start = async () => {
    if (busy || !kind || problem || reading) return;
    const ok = await onStart({ kind, text, background, styles: lim?.labels ? labels : [], count, toolIds: picked, keepChoice: plan.kept });
    if (ok) { reset(); onOpenChange(false); }
  };

  const presets = lim?.labels ? LABEL_PRESETS[lim.labels] : null;
  const KindIcon = kind ? KIND_ICON[kind] : Sparkles;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden border-cyan-400/20 bg-[#040915] text-zinc-100 shadow-[0_0_80px_-20px_rgba(34,211,238,0.35)] sm:max-w-2xl" data-testid="task-panel">
        {/* Soft NazAI glows behind the panel */}
        <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-cyan-500/15 blur-[90px] oc-glow" aria-hidden />
        <div className="pointer-events-none absolute -right-24 top-24 h-56 w-56 rounded-full bg-amber-400/10 blur-[90px] oc-glow" aria-hidden />
        <DialogHeader className="relative">
          <DialogTitle className="flex items-center gap-3 text-lg">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/25 to-amber-300/10 shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
              <Sparkles className="h-4 w-4 text-cyan-200" />
            </span>
            <span>
              <span className="block">Start a task</span>
              <span className="block font-mono text-[9px] font-normal uppercase tracking-[0.25em] text-cyan-300/70">NazAI Outer Control</span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Every tool reply is checked against your rules, and you get one clean result.
          </DialogDescription>
        </DialogHeader>
        <div className="relative space-y-4">
          {project && (
            <div className="oc-in flex items-center justify-between gap-2 rounded-xl border border-amber-300/40 bg-amber-400/[0.08] px-3 py-2 text-xs" data-testid="task-project">
              <span className="min-w-0 text-amber-50">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-200/80">Project · </span>
                <span className="font-medium">{project.name}</span> <span className="text-amber-100/70">({project.mode === "linked" ? "Linked" : "Snapshot"}) · its checked text goes to every tool, and its own rules apply</span>
              </span>
              {onClearProject && <button type="button" onClick={onClearProject} aria-label="Remove the project" className="shrink-0 text-amber-200/70 hover:text-amber-50"><X className="h-3.5 w-3.5" /></button>}
            </div>
          )}
          <div className={`oc-box rounded-2xl border bg-black/40 p-1 ${reading ? "oc-scan border-cyan-400/50" : "border-white/10"}`}>
            <textarea className="block w-full resize-none rounded-xl bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-zinc-100 outline-none" rows={5}
              aria-label="Describe the task" value={request} onChange={(e) => setRequest(e.target.value)} data-testid="task-request" />
            <div className="flex items-center justify-between gap-2 px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
              <span className={reading ? "text-cyan-300" : route ? "text-emerald-300/80" : "text-zinc-600"}>
                {reading ? "Reading…" : route ? (route.kind === "unclear" ? "Needs a choice" : "Read") : "NazAI reads as you type"}
              </span>
              <span className="text-zinc-600">{request.trim().length > 0 ? `${request.trim().length} chars` : ""}</span>
            </div>
          </div>

          {!request.trim() && (
            <div className="oc-in" data-testid="task-examples">
              <p className={sectionTitle}>Try one</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <button key={e} type="button" onClick={() => setRequest(e)} data-testid="task-example"
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-left text-xs text-zinc-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(reading || route) && (
            <div className={`oc-in relative overflow-hidden rounded-2xl border p-3.5 ${kind ? "border-cyan-400/30 bg-gradient-to-br from-cyan-500/[0.10] via-[#081226] to-amber-400/[0.05]" : "border-amber-400/30 bg-amber-400/[0.05]"}`} data-testid="task-plan">
              {reading && !route ? (
                <p className="flex items-center gap-2 text-xs text-cyan-200"><Loader2 className="h-3.5 w-3.5 animate-spin" /> NazAI is reading your request…</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${kind ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100" : "border-amber-300/40 bg-amber-400/10 text-amber-200"}`}>
                      <KindIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      {kind ? (
                        <span data-testid="task-plan-line">
                          <span className="text-zinc-400">NazAI will: </span>
                          <span className="font-semibold text-cyan-50">{ACTION_INFO[kind].title}</span>
                          {toolsLine && <span className="text-zinc-400"> · {toolsLine}</span>}
                        </span>
                      ) : (
                        <span className="text-amber-100" data-testid="task-question">{route?.question || "Which of these should NazAI do?"}</span>
                      )}
                      {kind && <p className="mt-0.5 text-xs text-zinc-400">{ACTION_INFO[kind].blurb.charAt(0).toUpperCase() + ACTION_INFO[kind].blurb.slice(1)}.</p>}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      {kind ? "Change" : "Choose"}
                      <select aria-label="Change the action" className="rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-400/60" value={kind ?? ""}
                        onChange={(e) => setChosenKind((e.target.value || null) as ReportKind | null)}>
                        {!kind && <option value="">Choose an action…</option>}
                        {REPORT_KINDS.map((k) => <option key={k} value={k}>{ACTION_INFO[k].title}</option>)}
                      </select>
                    </label>
                    {reading && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" aria-label="Reading again" />}
                  </div>
                  {kind && (text !== request.trim() || background) && (
                    <dl className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-xs">
                      {text !== request.trim() && <div className="flex gap-2" data-testid="task-text"><dt className="w-24 shrink-0 text-zinc-500">Works on: </dt><dd className="text-zinc-200">{clipLine(text, 200)}</dd></div>}
                      {background && <div className="flex gap-2" data-testid="task-background"><dt className="w-24 shrink-0 text-zinc-500">Background sent to every tool: </dt><dd className="text-zinc-200">{clipLine(background, 200)}</dd></div>}
                    </dl>
                  )}
                </>
              )}
            </div>
          )}

          {kind && presets && (
            <fieldset data-testid="task-labels" className="oc-in">
              <legend className={sectionTitle}>{presets.name} ({labels.length} of up to {MAX_STYLES})</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...presets.presets, ...labels.filter((l) => !presets.presets.includes(l))].map((l) => {
                  const on = labels.includes(l);
                  return (
                    <button key={l} type="button" aria-pressed={on} onClick={() => toggleLabel(l)} disabled={!on && labels.length >= MAX_STYLES}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition disabled:opacity-40 ${on ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100 shadow-[0_0_14px_-4px_rgba(34,211,238,0.6)]" : "border-white/15 text-zinc-300 hover:bg-white/10"}`}>
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
            <label className="oc-in flex items-center gap-2 text-xs text-zinc-300">
              <span className={sectionTitle}>Options to ask for</span>
              <select aria-label="Options to ask for" className="rounded-lg border border-white/15 bg-black/50 px-2 py-1 text-xs" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: lim.options.max - lim.options.min + 1 }, (_, i) => lim.options!.min + i).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}

          {kind && (
            <fieldset className="oc-in">
              <legend className={sectionTitle}>{toolsHint(kind)}, {kind === "draft" || kind === "multistep" ? "in this order" : "asked at the same time"} ({picked.length} chosen)</legend>
              {suggestion.length >= (lim?.minTools ?? 1) && (
                <div className="mt-2 flex flex-wrap items-start gap-2 rounded-xl border border-amber-300/30 bg-gradient-to-r from-amber-400/[0.08] to-cyan-400/[0.05] px-3 py-2 text-xs oc-in" data-testid="tool-suggestion">
                  <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
                  <span className="min-w-0 flex-1 text-zinc-200">
                    <span className="font-semibold text-amber-100">NazAI suggests {suggestion.map((x) => x.name).join(" and ")}</span>
                    {suggestion.map((x) => <span key={x.id} className="block text-zinc-400">{x.name}: {x.reasons.join(", ")}.</span>)}
                  </span>
                  <button type="button" onClick={() => setPicked(suggestion.map((x) => x.id).slice(0, lim!.maxTools))} disabled={suggestion.every((x) => picked.includes(x.id)) && picked.length === suggestion.length}
                    className="shrink-0 rounded-lg border border-amber-300/50 bg-amber-400/15 px-2.5 py-1 font-semibold text-amber-50 hover:bg-amber-400/25 disabled:opacity-40" data-testid="use-suggestion">Use these</button>
                </div>
              )}
              {tools.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Connect a tool first.</p> : (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {tools.map((t) => {
                    const h = toolHealth(t);
                    const idx = picked.indexOf(t.id);
                    const on = idx >= 0;
                    const ok = h.key === "working";
                    return (
                      <li key={t.id} className={`rounded-xl border transition ${on ? "border-cyan-400/50 bg-cyan-400/[0.08] shadow-[0_0_20px_-8px_rgba(34,211,238,0.7)]" : ok ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" : "border-amber-400/30 bg-amber-400/[0.04]"}`} data-testid="task-tool">
                        <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <input type="checkbox" className="accent-cyan-400" checked={on} disabled={!on && picked.length >= lim!.maxTools} onChange={() => toggle(t.id)} aria-label={`Ask ${t.name}`} />
                            <span className="truncate text-zinc-100">{t.name}</span>
                            {on && <span className="rounded-full border border-cyan-400/50 bg-cyan-400/10 px-1.5 text-[10px] text-cyan-200">#{idx + 1}</span>}
                          </span>
                          <span className={`flex shrink-0 items-center gap-1.5 text-xs ${ok ? "text-emerald-300" : h.key === "failed" ? "text-rose-300" : "text-amber-300"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : h.key === "failed" ? "bg-rose-400" : "bg-amber-400"}`} />{h.label}
                          </span>
                        </label>
                        {describeRecord(records?.get(t.id)) && <p className="-mt-1 px-3 pb-1.5 text-[10px] text-zinc-500" data-testid="task-tool-record">{describeRecord(records?.get(t.id))}</p>}
                        {!ok && (
                          <div className="flex items-start justify-between gap-2 border-t border-amber-400/15 px-3 py-1.5 text-[11px] text-amber-100/80" data-testid="task-tool-attention">
                            <span>{h.reason}</span>
                            {onFix && (
                              <button type="button" disabled={fixing === t.id} onClick={() => onFix(t)} data-testid="task-tool-test"
                                className="shrink-0 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-100 hover:bg-amber-400/20 disabled:opacity-50">
                                {fixing === t.id ? "Testing…" : "Test now"}
                              </button>
                            )}
                          </div>
                        )}
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
          <div className="space-y-1.5">
            {kind && (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
                <Coins className="h-3 w-3 text-amber-300/80" /> Uses {TASK_CREDITS[kind]} credit{TASK_CREDITS[kind] === 1 ? "" : "s"} · given back if no result comes
              </p>
            )}
            <button type="button" disabled={busy || !kind || !!problem || reading} onClick={start} data-testid="task-start"
              className="group relative w-full overflow-hidden rounded-xl border border-cyan-300/50 bg-gradient-to-r from-cyan-500/30 via-cyan-400/20 to-amber-300/25 px-3 py-2.5 text-sm font-semibold text-cyan-50 shadow-[0_0_28px_-8px_rgba(34,211,238,0.8)] transition hover:from-cyan-400/40 hover:to-amber-300/35 disabled:border-white/10 disabled:from-white/[0.04] disabled:via-white/[0.04] disabled:to-white/[0.04] disabled:text-zinc-500 disabled:shadow-none">
              {busy ? "Starting…" : kind ? START_LABEL[kind] : "Start"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
