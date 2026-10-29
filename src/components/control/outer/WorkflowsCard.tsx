// Outer Control (active): run several tools as one workflow. Steps with nothing to wait for
// start together; a step that waits receives the results of the steps it depends on.
import { useCallback, useEffect, useState } from "react";
import { Workflow, Plus, X } from "lucide-react";
import { toast } from "sonner";
import FinalArtifactView from "./FinalArtifactView";
import GoalProgress from "./GoalProgress";
import GoalTaskForm from "./GoalTaskForm";
import { HonestStatusBadge, StatusReason } from "./HonestStatusBadge";
import { honestStatus } from "@/lib/outer-control-status";
import { supabase } from "@/integrations/supabase/client";
import { callDrive } from "@/lib/outer-control-drive";
import { DEFAULT_HISTORY, visibleItems } from "@/lib/outer-control-ui";
import { isGoalTask, type CriterionView } from "@/lib/outer-control-goal-ui";
import { legsPayload, type CondKind, type DraftLeg, type SessionStatus, type WorkflowStatus } from "@/lib/outer-control-sessions";
import { ocRead } from "@/lib/outer-control-read"; // encrypted content is read through the server (data encryption, front 3)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // the tables are new and not in the generated types

type ToolOpt = { id: string; name: string; endpoint_url?: string; agent_id?: string | null; model?: string | null; approved_at?: string | null; last_ok_at?: string | null; last_error?: string | null; last_checked_at?: string | null };
type WorkflowRow = {
  id: string; objective: string; status: WorkflowStatus; summary: string | null; started_at: string;
  // The Task fields: where it is, what it produced, why it stopped.
  kind?: "single" | "chain"; current_leg?: number | null; steps_total?: number; steps_done?: number;
  final_output?: string | null; final_leg?: number | null; failed_leg?: number | null; stop_reason?: string | null; final_artifact?: unknown;
  origin?: { kind: string; source_model?: string } | null;
  // Goal Tasks: the done criteria and where they stand, the rounds, and why it is blocked.
  mode?: string | null; criteria_state?: CriterionView[] | null; max_rounds?: number | null; rounds_used?: number | null; blocked_reason?: string | null;
};
type HandoffRow = { id: string; task_id: string; from_leg: number | null; from_label: string; to_leg: number; outcome: "passed" | "modified" | "blocked"; rules: string[]; note: string };
type AgentOpt = { id: string; name: string };
type LegRow = { id: string; workflow_id: string; leg_no: number; tool_id: string; objective: string; status: SessionStatus; stop_reason: string | null; final_output: string | null; depends_on: number[]; final_artifact?: unknown };

const MAX_LEGS = 6;
const emptyLeg = (): DraftLeg => ({ toolId: "", instruction: "", deps: [], fallbackId: "", condKind: "always", condLeg: 1, condValue: "" });
const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";

export default function WorkflowsCard({ accountId }: { accountId: string | null | undefined }) {
  const [tools, setTools] = useState<ToolOpt[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [agentChoice, setAgentChoice] = useState("");
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [show, setShow] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [objective, setObjective] = useState("");
  const [context, setContext] = useState("");
  const [drafts, setDrafts] = useState<DraftLeg[]>([emptyLeg()]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const WF_COLS = "id, objective, status, summary, started_at, kind, current_leg, steps_total, steps_done, final_output, final_leg, failed_leg, stop_reason, final_artifact, origin";
    const GOAL_COLS = "mode, criteria_state, max_rounds, rounds_used, blocked_reason";
    // Archived Tasks are left out of the list (nothing is deleted). Before a newer column exists the older query still works.
    const wfQuery = (withArchive: boolean, withGoal: boolean) => {
      let q = ocRead("outer_control_workflows").select(`${WF_COLS}${withGoal ? `, ${GOAL_COLS}` : ""}${withArchive ? ", archived_at" : ""}`).eq("user_id", accountId).neq("kind", "single");
      if (withArchive) q = q.is("archived_at", null);
      return q.order("started_at", { ascending: false }).limit(8);
    };
    const [t, w0, a] = await Promise.all([
      anyDb.from("external_tools").select("id, name, endpoint_url, agent_id, model, approved_at, last_ok_at, last_error, last_checked_at").eq("user_id", accountId).eq("enabled", true).is("removed_at", null).order("created_at", { ascending: false }),
      // One-tool runs are Tasks too, but they are shown as sessions: this list is for several steps.
      wfQuery(true, true),
      anyDb.from("agents").select("id, name").eq("user_id", accountId).order("name"),
    ]);
    let w = w0;
    if (w?.error) w = await wfQuery(true, false);
    if (w?.error) w = await wfQuery(false, false);
    setTools((t.data ?? []) as ToolOpt[]);
    setAgents((a.data ?? []) as AgentOpt[]);
    const rows = (w.data ?? []) as WorkflowRow[];
    setWorkflows(rows);
    if (rows.length) {
      const h = await anyDb.from("outer_control_task_handoffs").select("id, task_id, from_leg, from_label, to_leg, outcome, rules, note").in("task_id", rows.map((r) => r.id)).order("created_at");
      setHandoffs((h.data ?? []) as HandoffRow[]);
      const l = await ocRead("outer_control_sessions")
        .select("id, workflow_id, leg_no, tool_id, objective, status, stop_reason, final_output, depends_on, final_artifact").in("workflow_id", rows.map((r) => r.id)).order("leg_no");
      setLegs((l.data ?? []) as LegRow[]);
    } else { setLegs([]); setHandoffs([]); }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);
  const anyOpen = workflows.some((w) => w.status === "running" || w.status === "awaiting_human");
  useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(load, 3000);
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

  const addAgent = async () => {
    if (!agentChoice) return;
    const r = await callDrive("create_agent_tool", { agent_id: agentChoice });
    if (!r.ok) { toast.error(r.message || "That did not work."); return; }
    toast.success(r.data?.created === false ? "That agent can already be chosen as a step." : "Agent added: choose it as a step's tool.");
    setAgentChoice(""); await load();
  };

  const archive = async (id: string) => {
    const r = await callDrive("archive", { kind: "workflow", id });
    if (!r.ok) toast.error(r.message || "That did not work."); else { toast.success("Archived. It is hidden from the list, not deleted."); await load(); }
  };

  const decide = async (id: string, decision: "accept" | "more" | "stop") => {
    setDeciding(id);
    const r = await callDrive("task_decide", { task_id: id, decision });
    setDeciding(null);
    if (!r.ok) toast.error(r.message || "That did not work.");
    else { toast.success(decision === "accept" ? "Accepted as done." : decision === "more" ? "Two more rounds allowed. It is asking again." : "Stopped."); await load(); }
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
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowGoal((v) => !v)} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20" data-testid="new-goal-task">
            {showGoal ? "Close" : "New goal task"}
          </button>
          <button onClick={() => setShow((v) => !v)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10">
            {show ? "Close" : "New workflow"}
          </button>
        </div>
      </div>

      {showGoal && <GoalTaskForm tools={tools.filter((t) => !(t.endpoint_url ?? "").startsWith("nazai-internal://"))} onStarted={async () => { setShowGoal(false); await load(); }} onRefresh={load} />}

      {show && (
        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
          {tools.length === 0 && <p className="text-sm text-amber-200">Connect a tool in Connected tools first.</p>}
          {agents.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <span className="text-zinc-500">A step can also be one of your NazAI agents:</span>
              <select className="rounded border border-white/10 bg-black/30 px-2 py-1" aria-label="Agent to add as a step" value={agentChoice} onChange={(e) => setAgentChoice(e.target.value)}>
                <option value="">Choose an agent</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button type="button" disabled={!agentChoice} onClick={addAgent} className="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-40">Add agent</button>
            </div>
          )}
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
        {visibleItems(workflows, DEFAULT_HISTORY, showAll).map((w) => {
          const wLegs = legs.filter((l) => l.workflow_id === w.id);
          const hs = honestStatus({
            kind: "task", status: w.status, artifact: w.final_artifact, stop_reason: w.stop_reason, current_leg: w.current_leg,
            steps_total: w.steps_total, steps_done: w.steps_done, failed_leg: w.failed_leg, waiting_for: isGoalTask(w) ? (w.blocked_reason ?? w.summary) : w.summary,
            root_status: wLegs.find((l) => l.leg_no === w.failed_leg)?.status ?? null,
          });
          return (
          <div key={w.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5" data-testid="workflow-row">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 text-sm text-zinc-200">
                <div className="truncate font-medium">{w.objective}</div>
                {w.origin?.kind === "external_agent" && <div className="text-[11px] text-zinc-500">Started by an external agent ({w.origin.source_model})</div>}
                <StatusReason status={hs} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <HonestStatusBadge status={hs} />
                {(w.status === "running" || w.status === "awaiting_human") ? (
                  <button onClick={() => cancel(w.id)} className="rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10">Cancel</button>
                ) : (
                  <button onClick={() => archive(w.id)} className="rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-500 hover:bg-white/10 hover:text-zinc-300" data-testid="archive-task">Archive</button>
                )}
              </div>
            </div>
            {wLegs.some((l) => tools.find((t) => t.id === l.tool_id)?.agent_id) && (
              <p className="mt-2 text-[11px] text-zinc-400" data-testid="task-agent-note">
                A NazAI agent took part. What it did is recorded in Inner Control, tagged with this Task. <a href="/control-system" className="text-cyan-300 underline-offset-2 hover:underline">See it in Inner Control</a>
              </p>
            )}
            {isGoalTask(w) && <GoalProgress task={w} status={hs} busy={deciding === w.id} onDecide={(d) => decide(w.id, d)} />}
            {hs.key === "completed" && <div className="mt-2"><FinalArtifactView artifact={w.final_artifact} kind="task" /></div>}
            {handoffs.some((h) => h.task_id === w.id) && (
              <details className="mt-2 rounded border border-white/10 px-2 py-1 text-xs" data-testid="task-handoffs">
                <summary className="cursor-pointer text-zinc-300">Hand-offs between steps ({handoffs.filter((h) => h.task_id === w.id).length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {handoffs.filter((h) => h.task_id === w.id).map((h) => (
                    <li key={h.id} className={h.outcome === "blocked" ? "text-rose-300" : h.outcome === "modified" ? "text-amber-300" : "text-zinc-300"}>
                      {h.from_leg === null ? h.from_label : `Step ${h.from_leg}`} → step {h.to_leg}: {h.note}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <ul className="mt-2 space-y-1 text-xs">
              {wLegs.map((l) => {
                const ls = honestStatus({
                  kind: "session", status: l.status, artifact: l.final_artifact, stop_reason: l.stop_reason,
                  waiting_for: l.status === "awaiting_human" ? "Needs you in Connected tools" : null,
                });
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 text-zinc-300">
                    <span className="text-zinc-500">Step {l.leg_no}</span>
                    <span>{toolName(l.tool_id)}</span>
                    <HonestStatusBadge status={ls} className="!px-1.5 !py-0 text-[10px]" />
                    {l.depends_on.length > 0 && <span className="text-zinc-500">after step {l.depends_on.join(", ")}</span>}
                    {ls.reason && <span className="text-zinc-500">{ls.reason}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
        {workflows.length > DEFAULT_HISTORY && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm text-cyan-300 hover:text-cyan-200">
            {showAll ? "Show fewer" : `View all (${workflows.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
