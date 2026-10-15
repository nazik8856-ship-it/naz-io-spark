// Outer Control (active): run several tools as one workflow. Steps with nothing to wait for
// start together; a step that waits receives the results of the steps it depends on.
import { useCallback, useEffect, useState } from "react";
import { Workflow, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callDrive } from "@/lib/outer-control-drive";
import { DEFAULT_HISTORY, visibleItems } from "@/lib/outer-control-ui";
import { legsPayload, STATUS_LABEL, WORKFLOW_LABEL, type CondKind, type DraftLeg, type SessionStatus, type WorkflowStatus } from "@/lib/outer-control-sessions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // the tables are new and not in the generated types

type ToolOpt = { id: string; name: string };
type WorkflowRow = { id: string; objective: string; status: WorkflowStatus; summary: string | null; started_at: string };
type LegRow = { id: string; workflow_id: string; leg_no: number; tool_id: string; objective: string; status: SessionStatus; stop_reason: string | null; final_output: string | null; depends_on: number[] };

const MAX_LEGS = 6;
const emptyLeg = (): DraftLeg => ({ toolId: "", instruction: "", deps: [], fallbackId: "", condKind: "always", condLeg: 1, condValue: "" });
const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";
const chip = (s: string) =>
  s === "completed" ? "border-emerald-500/40 text-emerald-300" : s === "failed" || s === "rejected" ? "border-rose-500/40 text-rose-300"
    : s === "awaiting_human" ? "border-amber-500/50 text-amber-300" : s === "running" ? "border-cyan-500/40 text-cyan-300" : s === "skipped" ? "border-white/20 text-zinc-500" : "border-white/20 text-zinc-400";

export default function WorkflowsCard({ accountId }: { accountId: string | null | undefined }) {
  const [tools, setTools] = useState<ToolOpt[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [show, setShow] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [objective, setObjective] = useState("");
  const [context, setContext] = useState("");
  const [drafts, setDrafts] = useState<DraftLeg[]>([emptyLeg()]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [t, w] = await Promise.all([
      anyDb.from("external_tools").select("id, name").eq("user_id", accountId).eq("enabled", true).is("removed_at", null).order("created_at", { ascending: false }),
      anyDb.from("outer_control_workflows").select("id, objective, status, summary, started_at").eq("user_id", accountId).order("started_at", { ascending: false }).limit(8),
    ]);
    setTools((t.data ?? []) as ToolOpt[]);
    const rows = (w.data ?? []) as WorkflowRow[];
    setWorkflows(rows);
    if (rows.length) {
      const l = await anyDb.from("outer_control_sessions")
        .select("id, workflow_id, leg_no, tool_id, objective, status, stop_reason, final_output, depends_on").in("workflow_id", rows.map((r) => r.id)).order("leg_no");
      setLegs((l.data ?? []) as LegRow[]);
    } else setLegs([]);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);
  const anyOpen = workflows.some((w) => w.status === "running" || w.status === "awaiting_human");
  useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [anyOpen, load]);

  const setLeg = (i: number, patch: Partial<DraftLeg>) => setDrafts((d) => d.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const toolName = (id: string) => tools.find((t) => t.id === id)?.name ?? "Tool";

  const start = async () => {
    const checked = legsPayload(drafts);
    if (!checked.legs) { toast.error(checked.message); return; }
    if (!objective.trim()) { toast.error("Describe the overall goal."); return; }
    setBusy(true);
    const r = await callDrive("start_workflow", { objective, context: context || undefined, legs: checked.legs });
    setBusy(false);
    if (!r.ok) { toast.error(r.message || "That did not work."); return; }
    toast.success("Workflow started.");
    setObjective(""); setContext(""); setDrafts([emptyLeg()]); setShow(false);
    await load();
  };

  const cancel = async (id: string) => {
    const r = await callDrive("cancel_workflow", { workflow_id: id });
    if (!r.ok) toast.error(r.message || "That did not work."); else { toast.success("Workflow cancelled."); await load(); }
  };

  return (
    <div className="hud-glass rounded-2xl px-6 py-5" data-testid="workflows-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Workflow className="h-4 w-4 text-cyan-300" /> Workflows — several tools, one goal
        </h3>
        <button onClick={() => setShow((v) => !v)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10">
          {show ? "Close" : "New workflow"}
        </button>
      </div>

      {show && (
        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
          {tools.length === 0 && <p className="text-sm text-amber-200">Connect a tool in Connected tools first.</p>}
          <input className={inputCls} aria-label="Workflow goal" placeholder="Overall goal" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <textarea className={inputCls} rows={2} aria-label="Workflow context" placeholder="Shared context (optional) — secrets are masked before anything is sent" value={context} onChange={(e) => setContext(e.target.value)} />
          {drafts.map((d, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-white/10 p-2.5 sm:grid-cols-2" data-testid="draft-leg">
              <div className="flex items-center justify-between sm:col-span-2">
                <span className="text-[11px] font-mono uppercase text-zinc-400">Step {i + 1}</span>
                {drafts.length > 1 && (
                  <button aria-label={`Remove step ${i + 1}`} onClick={() => setDrafts((all) => all.filter((_, k) => k !== i).map((l) => ({ ...l, deps: l.deps.filter((n) => n !== i + 1).map((n) => (n > i + 1 ? n - 1 : n)) })))} className="text-zinc-500 hover:text-zinc-200"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
              <select className={inputCls} aria-label={`Tool for step ${i + 1}`} value={d.toolId} onChange={(e) => setLeg(i, { toolId: e.target.value })}>
                <option value="">Choose a tool</option>
                {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className={inputCls} aria-label={`Fallback tool for step ${i + 1}`} value={d.fallbackId} onChange={(e) => setLeg(i, { fallbackId: e.target.value })}>
                <option value="">No fallback tool</option>
                {tools.filter((t) => t.id !== d.toolId).map((t) => <option key={t.id} value={t.id}>Fallback: {t.name}</option>)}
              </select>
              <textarea className={`${inputCls} sm:col-span-2`} rows={2} aria-label={`Instruction for step ${i + 1}`} placeholder="What should this tool do?" value={d.instruction} onChange={(e) => setLeg(i, { instruction: e.target.value })} />
              {i > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300 sm:col-span-2">
                  <span className="text-zinc-500">Runs:</span>
                  <select className="rounded border border-white/10 bg-black/30 px-2 py-1" aria-label={`When step ${i + 1} runs`} value={d.condKind ?? "always"} onChange={(e) => setLeg(i, { condKind: e.target.value as CondKind })}>
                    <option value="always">always (after the steps below)</option>
                    <option value="contains">only if an earlier result contains…</option>
                    <option value="not_contains">only if an earlier result does not contain…</option>
                    <option value="dep_failed">only if an earlier step fails</option>
                  </select>
                  {(d.condKind ?? "always") !== "always" && (
                    <>
                      <select className="rounded border border-white/10 bg-black/30 px-2 py-1" aria-label={`Condition step for step ${i + 1}`} value={d.condLeg ?? 1} onChange={(e) => setLeg(i, { condLeg: Number(e.target.value) })}>
                        {drafts.slice(0, i).map((_, k) => <option key={k} value={k + 1}>step {k + 1}</option>)}
                      </select>
                      {d.condKind !== "dep_failed" && (
                        <input className="min-w-[10rem] flex-1 rounded border border-white/10 bg-black/30 px-2 py-1" aria-label={`Condition text for step ${i + 1}`} placeholder="text to look for" value={d.condValue ?? ""} onChange={(e) => setLeg(i, { condValue: e.target.value })} />
                      )}
                    </>
                  )}
                </div>
              )}
              {i > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300 sm:col-span-2">
                  <span className="text-zinc-500">Waits for:</span>
                  {drafts.slice(0, i).map((_, k) => (
                    <label key={k} className="flex items-center gap-1">
                      <input type="checkbox" checked={d.deps.includes(k + 1)} onChange={(e) => setLeg(i, { deps: e.target.checked ? [...d.deps, k + 1] : d.deps.filter((n) => n !== k + 1) })} /> step {k + 1}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button disabled={drafts.length >= MAX_LEGS} onClick={() => setDrafts((d) => [...d, emptyLeg()])} className="flex items-center gap-1 rounded border border-white/15 px-3 py-1.5 text-[11px] font-mono uppercase text-zinc-300 hover:bg-white/10 disabled:opacity-40">
              <Plus className="h-3 w-3" /> Add step
            </button>
            <button disabled={busy} onClick={start} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-1.5 text-xs font-mono uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40">
              {busy ? "Starting…" : "Start workflow"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {workflows.length === 0 && <p className="text-sm text-zinc-500">No workflows yet. A workflow runs several tools toward one goal; steps that don't wait for each other run at the same time. Press New workflow to build one.</p>}
        {visibleItems(workflows, DEFAULT_HISTORY, showAll).map((w) => (
          <div key={w.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5" data-testid="workflow-row">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 text-sm text-zinc-200">
                <div className="truncate font-medium">{w.objective}</div>
                {w.summary && <div className="text-xs text-zinc-400">{w.summary}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${chip(w.status)}`}>{WORKFLOW_LABEL[w.status]}</span>
                {(w.status === "running" || w.status === "awaiting_human") && (
                  <button onClick={() => cancel(w.id)} className="rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10">Cancel</button>
                )}
              </div>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {legs.filter((l) => l.workflow_id === w.id).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 text-zinc-300">
                  <span className="text-zinc-500">Step {l.leg_no}</span>
                  <span>{toolName(l.tool_id)}</span>
                  <span className={`rounded-full border px-1.5 py-0 text-[10px] font-mono uppercase ${chip(l.status)}`}>{STATUS_LABEL[l.status]}</span>
                  {l.depends_on.length > 0 && <span className="text-zinc-500">after step {l.depends_on.join(", ")}</span>}
                  {l.status === "awaiting_human" && <span className="text-amber-300">needs you in Connected tools</span>}
                  {l.stop_reason && l.status !== "completed" && <span className="text-zinc-500">{l.stop_reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {workflows.length > DEFAULT_HISTORY && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm text-cyan-300 hover:text-cyan-200">
            {showAll ? "Show fewer" : `View all (${workflows.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
