// Outer Control: the Tasks started from Start task, on the main page. Each one shows what is happening now in one line, a step for
// every tool and for NazAI's writer, and, once it is done, the one controlled result with its proof. A Task that finishes while the
// page is open says so ("Result ready") and opens its result.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Check, ChevronDown, Clock, FileCheck2, Hand, Loader2, RotateCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callDrive } from "@/lib/outer-control-drive";
import { callProjects } from "@/lib/projects";
import { ACTION_INFO, splitTaskTitle } from "@/lib/outer-control-report-doc";
import { hasWriter, projectCheckSummary, taskProgress, type NodeState, type ProgressLeg, type ProgressNode, type ProgressTool, type ProjectCheckRow, type ProjectCheckSummary, type TaskProgress } from "@/lib/outer-control-task-progress";
import FinalArtifactView from "./FinalArtifactView";
import { ocRead } from "@/lib/outer-control-read"; // encrypted content is read through the server (data encryption, front 3)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // the tables are new and not in the generated types

type TaskRow = { id: string; objective: string; status: string; started_at: string; stop_reason: string | null; final_artifact: unknown; project_id?: string | null };
type TaskProjectInfo = { id: string; name: string; source_mode: "snapshot" | "linked"; write_back: boolean };
type LegRow = ProgressLeg & { id: string; workflow_id: string; interruptions?: number | null };
const SHOWN = 3;
const isOpen = (s: string) => s === "running" || s === "awaiting_human";

const NODE_STYLE: Record<NodeState, { ring: string; text: string; word: string }> = {
  waiting: { ring: "border-white/15 bg-white/[0.03] text-zinc-500", text: "text-zinc-500", word: "waiting" },
  asking: { ring: "border-cyan-400/70 bg-cyan-500/15 text-cyan-200 oc-ring", text: "text-cyan-200", word: "asking…" },
  writing: { ring: "border-amber-300/70 bg-amber-400/15 text-amber-100 oc-ring", text: "text-amber-100", word: "writing…" },
  done: { ring: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200", text: "text-emerald-200", word: "checked" },
  missed: { ring: "border-rose-400/50 bg-rose-500/10 text-rose-200", text: "text-rose-200", word: "no answer" },
  needs_you: { ring: "border-amber-400/70 bg-amber-500/15 text-amber-200 oc-ring", text: "text-amber-200", word: "needs you" },
  cancelled: { ring: "border-white/10 bg-white/[0.02] text-zinc-600", text: "text-zinc-600", word: "not run" },
};

function NodeIcon({ n }: { n: ProgressNode }) {
  const c = "h-3.5 w-3.5";
  if (n.state === "asking" || n.state === "writing") return <Loader2 className={`${c} animate-spin`} />;
  if (n.state === "done") return n.writer ? <Sparkles className={c} /> : <Check className={c} />;
  if (n.state === "missed") return <X className={c} />;
  if (n.state === "needs_you") return <Hand className={c} />;
  if (n.state === "cancelled") return <Ban className={c} />;
  return n.writer ? <Sparkles className={c} /> : <Clock className={c} />;
}

function Node({ n }: { n: ProgressNode }) {
  const st = NODE_STYLE[n.state];
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="task-node" data-state={n.state} title={n.note ?? undefined}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${st.ring}`}><NodeIcon n={n} /></span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-xs font-medium text-zinc-100">{n.label}</span>
        <span className={`block text-[10px] font-mono uppercase tracking-wider ${st.text}`}>{n.writer && n.state === "waiting" ? "writes the result" : st.word}</span>
      </span>
    </div>
  );
}

const Arrow = () => <span aria-hidden className="h-px w-5 shrink-0 bg-gradient-to-r from-cyan-400/50 to-amber-300/40 sm:w-8" />;

export function ProgressTrack({ p }: { p: TaskProgress }) {
  const tools = p.nodes.filter((n) => !n.writer);
  const writer = p.nodes.find((n) => n.writer);
  const ready = p.phase === "ready";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="task-track">
      {p.together ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] px-2.5 py-1.5">
          <span className="w-full font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/70">At the same time</span>
          {tools.map((n) => <Node key={n.leg_no} n={n} />)}
        </div>
      ) : (
        tools.map((n, i) => <div key={n.leg_no} className="flex items-center gap-2">{i > 0 && <Arrow />}<Node n={n} /></div>)
      )}
      {/* NazAI and the result stay together when the line wraps. */}
      <div className="flex items-center gap-2">
        {writer && <><Arrow /><Node n={writer} /></>}
        <Arrow />
        <div className="flex items-center gap-2" data-testid="task-node-result" data-state={ready ? "done" : "waiting"}>
          <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${ready ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-200" : "border-white/15 text-zinc-600"}`}><FileCheck2 className="h-3.5 w-3.5" /></span>
          <span className={`text-xs ${ready ? "font-medium text-emerald-200" : "text-zinc-500"}`}>Result</span>
        </div>
      </div>
    </div>
  );
}

export default function TaskTracker({ accountId, refreshKey = 0 }: { accountId: string | null | undefined; refreshKey?: number }) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [tools, setTools] = useState<ProgressTool[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const seen = useRef<Map<string, string>>(new Map());
  const [projects, setProjects] = useState<Map<string, TaskProjectInfo>>(new Map());
  const [checks, setChecks] = useState<ProjectCheckRow[]>([]);
  const [writing, setWriting] = useState<string | null>(null);
  const autoOpened = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!accountId) return;
    // A failed refresh keeps what is shown; the next one tries again.
    try { await loadTasks(accountId); } catch { /* keep the last view */ }
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTasks = async (accountId: string) => {
    const COLS = "id, objective, status, started_at, stop_reason, final_artifact";
    // Before the project column exists the older query still works.
    const q = (withArchive: boolean, withProject: boolean) => {
      let x = ocRead("outer_control_workflows").select(withProject ? `${COLS}, project_id` : COLS).eq("user_id", accountId).neq("kind", "single");
      if (withArchive) x = x.is("archived_at", null);
      return x.order("started_at", { ascending: false }).limit(8);
    };
    let w = await q(true, true);
    if (w?.error) w = await q(true, false);
    if (w?.error) w = await q(false, false);
    const rows = (Array.isArray(w?.data) ? w.data : []) as TaskRow[];
    const ids = rows.map((r) => r.id);
    const [l, t] = await Promise.all([
      ids.length ? anyDb.from("outer_control_sessions").select("id, workflow_id, leg_no, tool_id, status, depends_on, stop_reason, pending_kind, interruptions").in("workflow_id", ids).order("leg_no") : { data: [] },
      anyDb.from("external_tools").select("id, name, endpoint_url").eq("user_id", accountId),
    ]);
    const allLegs = (Array.isArray(l?.data) ? l.data : []).map((x: LegRow) => ({ ...x, depends_on: x.depends_on ?? [] })) as LegRow[];
    const allTools = (Array.isArray(t?.data) ? t.data : []) as ProgressTool[];
    // Only the Tasks started from Start task (they end with NazAI's writer); the newest few.
    const mine = rows.filter((r) => hasWriter(allLegs.filter((x) => x.workflow_id === r.id), allTools)).slice(0, SHOWN);
    const pids = [...new Set(mine.map((m) => m.project_id).filter((x): x is string => !!x))];
    if (pids.length) {
      const pr = await anyDb.from("imported_projects").select("id, name, source_mode, write_back").in("id", pids);
      setProjects(new Map(((Array.isArray(pr?.data) ? pr.data : []) as TaskProjectInfo[]).map((x) => [x.id, x])));
      // What each tool's answer showed when it was compared with the project.
      const legIds = allLegs.filter((x) => mine.some((m) => m.id === x.workflow_id && m.project_id)).map((x) => x.id);
      if (legIds.length) {
        // A step's decision is stored encrypted (data encryption, front 5): it is read through the server and the project check
        // taken out of it here.
        const st = await ocRead("outer_control_session_steps").select("session_id, decision").in("session_id", legIds).order("step_no").order("attempt");
        const stepRows = (Array.isArray(st?.data) ? st.data : []) as { session_id: string; decision?: { project_check?: unknown } | null }[];
        setChecks(st?.error ? [] : stepRows.map((r) => ({ session_id: r.session_id, project_check: r.decision?.project_check ?? null }) as ProjectCheckRow));
      }
    }
    setTools(allTools);
    setLegs(allLegs.filter((x) => mine.some((m) => m.id === x.workflow_id)));
    setTasks(mine);
  };

  useEffect(() => { load(); }, [load, refreshKey]);
  const anyOpen = tasks.some((t) => isOpen(t.status));
  // A Task started from this page is already running when the start returns, so polling while one is open is enough.
  useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [anyOpen, load]);

  // The newest Task is open by itself; a Task that finishes while the page is open opens and says so.
  useEffect(() => {
    if (!tasks.length) return;
    // Opened by itself once; folding it afterwards stays folded.
    if (!autoOpened.current.has(tasks[0].id)) { autoOpened.current.add(tasks[0].id); setOpen(tasks[0].id); }
    for (const t of tasks) {
      const before = seen.current.get(t.id);
      if (before && isOpen(before) && t.status === "completed") {
        const title = splitTaskTitle(t.objective);
        setOpen(t.id);
        toast.success(`Result ready${title ? `: ${ACTION_INFO[title.kind].title}` : ""}`, {
          action: { label: "View", onClick: () => document.getElementById(`task-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) },
        });
      }
      seen.current.set(t.id, t.status);
    }
  }, [tasks]);

  const hide = async (id: string) => {
    const r = await callDrive("archive", { kind: "workflow", id });
    if (!r.ok) toast.error(r.message || "That did not work."); else await load();
  };

  if (!tasks.length) return null;
  return (
    <section className="mt-5 space-y-2" data-testid="task-tracker">
      <h3 className="text-sm font-medium text-zinc-300">Your tasks</h3>
      {tasks.map((t) => {
        const tLegs = legs.filter((l) => l.workflow_id === t.id);
        const p = taskProgress(t, tLegs, tools);
        const title = splitTaskTitle(t.objective);
        const expanded = open === t.id;
        const tone = p.phase === "ready" ? "border-emerald-400/30" : p.phase === "failed" ? "border-rose-400/30" : p.phase === "needs_you" ? "border-amber-400/40" : "border-cyan-400/30";
        return (
          <article key={t.id} id={`task-${t.id}`} className={`oc-in overflow-hidden rounded-2xl border ${tone} bg-gradient-to-b from-[#0b1a35]/70 to-[#070f22]/70`} data-testid="task-card" data-phase={p.phase}>
            <button type="button" onClick={() => setOpen(expanded ? null : t.id)} className="flex w-full items-start gap-3 px-4 pt-3 text-left" aria-expanded={expanded}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {title && <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-200">{ACTION_INFO[title.kind].title}</span>}
                  <span className="truncate text-sm font-medium text-zinc-100">{title?.text ?? t.objective}</span>
                  {t.project_id && projects.get(t.project_id) && (
                    <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100" data-testid="task-project-chip">
                      Project: {projects.get(t.project_id)!.name} · {projects.get(t.project_id)!.source_mode === "linked" ? "Linked" : "Snapshot"}
                    </span>
                  )}
                </div>
                <p className={`mt-1 text-xs ${p.phase === "ready" ? "text-emerald-200" : p.phase === "failed" ? "text-rose-200" : p.phase === "needs_you" ? "text-amber-200" : "text-cyan-100"}`} data-testid="task-headline">{p.headline}</p>
                {tLegs.some((l) => (l.interruptions ?? 0) > 0) && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400" data-testid="task-resumed"><RotateCcw className="h-3 w-3 text-cyan-300/80" /> Resumed after an interruption: it carried on from its last saved step.</p>
                )}
              </div>
              <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {/* The bar moves while the Task works; full when it is done. */}
            <div className="mx-4 mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Progress">
              <div className={`h-full rounded-full transition-all duration-500 ${p.phase === "ready" ? "bg-emerald-400" : p.phase === "failed" ? "bg-rose-400/70" : "oc-flow"}`}
                style={{ width: `${p.phase === "ready" ? 100 : Math.max(8, Math.round((p.done / Math.max(1, p.total)) * 100))}%` }} />
            </div>
            {expanded && (
              <div className="space-y-3 px-4 pb-4 pt-3">
                <ProgressTrack p={p} />
                {p.phase === "ready" && <FinalArtifactView artifact={t.final_artifact} kind="task" />}
                {t.project_id && <ProjectCheckNote summary={projectCheckSummary(checks.filter((c) => tLegs.some((l) => l.id === c.session_id)), tLegs, tools)} />}
                {p.phase === "ready" && t.project_id && projects.get(t.project_id)?.write_back && (
                  <button type="button" disabled={writing === t.id} data-testid="task-write-back"
                    onClick={async () => {
                      const text = String((t.final_artifact as { final_output?: string } | null)?.final_output ?? "");
                      setWriting(t.id);
                      const r = await callProjects("write_back", { project_id: t.project_id, account_id: accountId, text });
                      setWriting(null);
                      if (r.ok) toast.success("Waiting for your approval in Approvals. Nothing is written to the original before that.");
                      else toast.error(r.message || "That did not work.");
                    }}
                    className="rounded-xl border border-amber-300/50 bg-amber-400/15 px-3 py-1.5 text-sm text-amber-50 hover:bg-amber-400/25 disabled:opacity-50">
                    {writing === t.id ? "Asking…" : "Write this result to the original"}
                  </button>
                )}
                {!isOpen(t.status) && (
                  <div className="flex justify-end">
                    <button type="button" onClick={() => hide(t.id)} className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-500 hover:bg-white/10 hover:text-zinc-300" data-testid="task-hide">Hide</button>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

/** What comparing each tool's answer with the Task's project found. */
function ProjectCheckNote({ summary }: { summary: ProjectCheckSummary | null }) {
  if (!summary) return null;
  if (!summary.ran) return <p className="text-xs text-zinc-500" data-testid="project-check">Not checked against the project: the AI check was not available.</p>;
  if (!summary.contradictions.length) {
    return <p className="flex items-center gap-1.5 text-xs text-emerald-200" data-testid="project-check"><ShieldCheck className="h-3.5 w-3.5" /> Checked against the project: no answer contradicts it.</p>;
  }
  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.07] p-3 text-xs oc-in" data-testid="project-check">
      <p className="flex items-center gap-1.5 font-semibold text-amber-100"><AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> {summary.contradictions.length} statement{summary.contradictions.length === 1 ? "" : "s"} contradict{summary.contradictions.length === 1 ? "s" : ""} the project</p>
      <ul className="mt-1.5 space-y-1.5 text-zinc-200">
        {summary.contradictions.map((c, i) => (
          <li key={i} data-testid="project-contradiction"><span className="text-zinc-400">{c.tool}:</span> “{c.reply_quote}” <span className="text-zinc-400">— the project says</span> “{c.project_quote}”{c.why ? <span className="text-zinc-500"> ({c.why})</span> : null}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-zinc-500">Flagged only: NazAI quoted both sides. Check which one is right before you use the result.</p>
    </div>
  );
}
