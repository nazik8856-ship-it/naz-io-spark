// Outer Control page, section 2 (the main focus): the connected tools, with Test and Start
// session on every row, the sessions that are running or need you, and a short history.
// Update key / Remove sit behind "More"; step logs open only for the session you click. Outer Control does the contacting, rule checking
// and deciding; this card only shows it and collects the few things a person must give.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Plus, Play, ChevronDown, ChevronRight, Send, Square } from "lucide-react";
import { toast } from "sonner";
import FinalArtifactView from "./FinalArtifactView";
import { HonestStatusBadge, StatusReason } from "./HonestStatusBadge";
import { honestStatus } from "@/lib/outer-control-status";
import { supabase } from "@/integrations/supabase/client";
import { callDrive } from "@/lib/outer-control-drive";
import { DEFAULT_HISTORY, splitSessions, TONE_BORDER, TONE_DOT, TONE_TEXT, visibleItems, type Tone } from "@/lib/outer-control-ui";
import { describeClosure, describeUsage, healthSummary, isInternalTool, toolHealth, type ActivityStep, type ToolUsage } from "@/lib/outer-control-tools-ui";
import TaskTracker from "./TaskTracker";
import TaskPanel, { type TaskRequest } from "./TaskPanel";
import { ACTION_INFO } from "@/lib/outer-control-report-doc";
import ConnectToolPanel, { type ConnectPayload } from "./ConnectToolPanel";
import SessionActivity from "./SessionActivity";
import FollowUpBox from "./FollowUpBox";
import ToolPlanBox, { useToolPlan } from "./ToolPlanBox";
import { stepInstruction } from "@/lib/outer-control-tool-plan";
import { saveTextFile, sessionsToCsv, type ExportSession } from "@/lib/outer-control-export";
import { describeCompletion, describeDecision, riskConfidenceBadges, describeStep, describeWaiting, isOpen, waitingReason, type CompletionView, type HandoffView, type PendingKind, type SessionStatus, type StepLike } from "@/lib/outer-control-sessions";

// The tables are new and not in the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

type Tool = { id: string; name: string; endpoint_url: string; request_format: string; model?: string | null; approved_at: string | null; last_ok_at: string | null; last_error: string | null; last_checked_at: string | null };
type Session = {
  id: string; tool_id: string; objective: string; status: SessionStatus; step_count: number; max_steps: number;
  final_output: string | null; stop_reason: string | null; pending_kind: PendingKind | null; pending_question: string | null; started_at: string;
  handoff: HandoffView | null; workflow_id: string | null; leg_no: number | null; completion?: CompletionView | null; final_artifact?: unknown; finished_at?: string | null; archived_at?: string | null;
};
type MemoryRow = { id: string; kind: string; summary: string };
type Step = StepLike & { id: string; reply_text: string | null; decision?: import("@/lib/outer-control-sessions").DecisionView | null };
type KeyOpt = { id: string; name: string };


const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };
const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";

export default function ActiveSessionsCard({ accountId }: { accountId: string | null | undefined }) {
  const navigate = useNavigate();
  const [tools, setTools] = useState<Tool[]>([]);
  const [singles, setSingles] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyOpt[]>([]);
  const [steps, setSteps] = useState<Record<string, Step[]>>({});
  const [memory, setMemory] = useState<Record<string, MemoryRow[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [startFor, setStartFor] = useState<string | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [showAllPast, setShowAllPast] = useState(false);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const [usage, setUsage] = useState<Map<string, ToolUsage>>(new Map());
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [job, setJob] = useState({ objective: "", context: "", keyId: "", maxSteps: "5" });
  /** Counts the Tasks started here, so Your tasks loads the new one at once. */
  const [taskStarts, setTaskStarts] = useState(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    const SESSION_COLS = "id, tool_id, objective, status, step_count, max_steps, final_output, stop_reason, pending_kind, pending_question, started_at, handoff, workflow_id, leg_no, completion, final_artifact, finished_at";
    // Archived items are left out unless asked for. Before the archive column exists the plain query still works.
    const sessionsQuery = (withArchive: boolean) => {
      let q = anyDb.from("outer_control_sessions").select(withArchive ? `${SESSION_COLS}, archived_at` : SESSION_COLS).eq("user_id", accountId);
      if (withArchive && !showArchived) q = q.is("archived_at", null);
      return q.order("started_at", { ascending: false }).limit(10);
    };
    const [t, s0, k, u] = await Promise.all([
      anyDb.from("external_tools").select("id, name, endpoint_url, request_format, model, approved_at, last_ok_at, last_error, last_checked_at").eq("user_id", accountId).is("removed_at", null).order("created_at", { ascending: false }),
      sessionsQuery(true),
      anyDb.from("api_keys").select("id, name").eq("user_id", accountId).is("revoked_at", null),
      anyDb.from("outer_control_tool_usage").select("tool_id, requests_30d, failed_30d, requests_today").eq("user_id", accountId),
    ]);
    setUsage(new Map((Array.isArray(u?.data) ? (u.data as ToolUsage[]) : []).filter((x) => x && typeof x.tool_id === "string").map((x) => [x.tool_id, x])));
    const s = s0?.error ? await sessionsQuery(false) : s0;
    try {
      const c = await anyDb.from("outer_control_sessions").select("id", { count: "exact", head: true }).eq("user_id", accountId).not("archived_at", "is", null);
      setArchivedCount(Number(c?.count ?? 0) || 0);
    } catch { setArchivedCount(0); }
    setTools((t.data ?? []) as Tool[]);
    const rows = (s.data ?? []) as Session[];
    setSessions(rows);
    setKeys((k.data ?? []) as KeyOpt[]);
    // A one-tool run is a Task of one step: it is not "step 1 of a workflow".
    const wfIds = [...new Set(rows.map((r) => r.workflow_id).filter((x): x is string => !!x))];
    if (wfIds.length) {
      const w = await anyDb.from("outer_control_workflows").select("id, kind").in("id", wfIds);
      setSingles(new Set(((Array.isArray(w.data) ? w.data : []) as { id: string; kind?: string }[]).filter((x) => x?.kind === "single").map((x) => x.id)));
    } else setSingles(new Set());
  }, [accountId, showArchived]);

  const loadSteps = useCallback(async (sessionId: string) => {
    const { data } = await anyDb.from("outer_control_session_steps")
      .select("id, step_no, attempt, verdict, next_action, error, note, reply_text, decision").eq("session_id", sessionId).order("step_no").order("attempt");
    setSteps((p) => ({ ...p, [sessionId]: (data ?? []) as Step[] }));
    const { data: mem } = await anyDb.from("outer_control_memory").select("id, kind, summary").eq("session_id", sessionId).order("created_at");
    setMemory((p) => ({ ...p, [sessionId]: (mem ?? []) as MemoryRow[] }));
  }, []);

  useEffect(() => { load(); }, [load]);
  // Poll while anything is open, so a running session visibly moves and an approval resumes it on screen.
  const anyOpen = sessions.some((s) => isOpen(s.status));
  useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(() => { load(); if (expanded) loadSteps(expanded); }, 3000);
    return () => clearInterval(id);
  }, [anyOpen, expanded, load, loadSteps]);
  useEffect(() => { if (expanded) loadSteps(expanded); }, [expanded, loadSteps]);
  // A session that is running opens by itself once, so the person sees which tool is used and what Outer Control does.
  const autoOpened = useRef<Set<string>>(new Set());
  useEffect(() => {
    const open = sessions.find((x) => isOpen(x.status) && !autoOpened.current.has(x.id));
    if (!open) return;
    autoOpened.current.add(open.id);
    setExpanded(open.id);
  }, [sessions]);

  const act = async (key: string, action: string, payload: Record<string, unknown>, okMsg?: string) => {
    setBusy(key);
    const r = await callDrive(action, payload);
    setBusy(null);
    if (!r.ok) { toast.error(r.message || "That did not work."); return r; }
    if (okMsg) toast.success(okMsg);
    await load();
    return r;
  };

  /** The whole history as a CSV: every session (archived ones too), with the honest status and reason beside each. */
  const exportHistory = async () => {
    setBusy("export");
    const cols = "id, tool_id, objective, status, step_count, max_steps, stop_reason, started_at, finished_at, workflow_id, leg_no, final_artifact";
    const q = (withArchive: boolean) => anyDb.from("outer_control_sessions").select(withArchive ? `${cols}, archived_at` : cols).eq("user_id", accountId).order("started_at", { ascending: false }).limit(1000);
    let r = await q(true);
    if (r?.error) r = await q(false);
    setBusy(null);
    const rows = (Array.isArray(r?.data) ? r.data : []) as ExportSession[];
    if (!rows.length) { toast.info("There is no history to export yet."); return; }
    const name = (id: string) => tools.find((x) => x.id === id)?.name ?? "Removed tool";
    const stamp = new Date().toISOString().slice(0, 10);
    if (saveTextFile(`outer-control-history-${stamp}.csv`, sessionsToCsv(rows, name), "text/csv")) toast.success(`Exported ${rows.length} session${rows.length === 1 ? "" : "s"}.`);
    else toast.error("Could not download the file.");
  };

  /** Saves the tool, then tests it, so the status shown right after connecting is a real result. */
  const connectTool = async (p: ConnectPayload): Promise<boolean> => {
    const r = await act("connect", "create_tool", { ...p });
    if (!r.ok) return false;
    const id = (r.data as { tool?: { id?: string } } | undefined)?.tool?.id;
    if (id) await runTest(id, p.name);
    else toast.success("Tool connected. Press Test to check it.");
    return true;
  };

  /** Start task: one of the multi-tool actions. Each tool is asked (on its own or in a chain), then one controlled result is written. */
  const startTask = async (t: TaskRequest): Promise<boolean> => {
    const label = t.toolIds.map((id) => tools.find((x) => x.id === id)?.name ?? "tool").join(" → ");
    const r = await act("report", "start_report", {
      task: t.kind, topic: t.text, background: t.background || undefined, styles: t.styles.length ? t.styles : undefined,
      count: t.kind === "alternatives" ? t.count : undefined, tool_ids: t.toolIds, confirm_override: t.keepChoice || undefined,
    }, `${ACTION_INFO[t.kind].title} started: asking ${label}. Follow it in Your tasks below; the result appears there when it is done.`);
    if (r.ok) setTaskStarts((n) => n + 1);
    return r.ok;
  };

  /** The connection test: a real request to the tool. The result (or the reason it failed) is shown at once. */
  const runTest = async (toolId: string, name: string) => {
    setBusy(`test-${toolId}`);
    const r = await callDrive("test_tool", { tool_id: toolId });
    setBusy(null);
    const d = (r.data ?? {}) as { ok?: boolean; error?: string | null; ms?: number | null; sample?: string | null };
    if (r.ok && d.ok) toast.success(`${name} works${d.ms ? ` (${d.ms} ms)` : ""}${d.sample ? `. It replied: "${d.sample}"` : "."}`);
    else toast.error(`${name} failed the test: ${d.error || r.message || "no reason given"}`);
    await load();
  };

  const start = async (toolId: string, keepChoice: boolean) => {
    const name = tools.find((x) => x.id === toolId)?.name ?? "the tool";
    const r = await act(`start-${toolId}`, "start_session", {
      tool_id: toolId, objective: job.objective, context: job.context || undefined, api_key_id: job.keyId || undefined, max_steps: Number(job.maxSteps) || 5,
      confirm_override: keepChoice || undefined,
    }, `Session started with ${name}.`);
    if (r.ok) { setJob({ objective: "", context: "", keyId: "", maxSteps: "5" }); setStartFor(null); setExpanded(r.data?.session_id ?? null); }
  };

  /** Several tools named in one request: they are asked in that order as one Task, each step getting the previous answer. */
  const startAsTask = async (ids: string[]) => {
    if (busy) return;
    const names = ids.map((id) => tools.find((x) => x.id === id)?.name ?? "tool");
    const label = names.join(" → ");
    const r = await act("start-task", "start_task", {
      request: job.objective, context: job.context || undefined, api_key_id: job.keyId || undefined, max_steps: Number(job.maxSteps) || 5,
      steps: ids.map((id, i) => ({ tool_id: id, instruction: stepInstruction(job.objective, names, i) })),
    }, `Task started: ${label}. Follow it under Tasks.`);
    if (r.ok) { setJob({ objective: "", context: "", keyId: "", maxSteps: "5" }); setStartFor(null); }
  };

  const saveKey = async (toolId: string) => {
    const r = await act(`key-${toolId}`, "update_key", { tool_id: toolId, token: newKey }, "New key saved. Press Test to check it.");
    if (r.ok) { setNewKey(""); setKeyFor(null); }
  };

  const remove = async (t: Tool) => {
    if (!window.confirm(`Remove "${t.name}"? Its stored key is deleted and any session still using it is cancelled. Past sessions stay in the history.`)) return;
    const r = await act(`remove-${t.id}`, "remove_tool", { tool_id: t.id }, `"${t.name}" removed.`);
    if (r.ok) { if (startFor === t.id) setStartFor(null); if (keyFor === t.id) setKeyFor(null); }
  };

  const renderSession = (s: Session) => {
    const open = expanded === s.id;
            const waiting = s.status === "awaiting_human" && s.pending_kind !== "handoff" ? describeWaiting(s.pending_kind, s.pending_question) : null;
            // The one honest status: Completed only with a valid final artifact; every other status says why.
            const hs = honestStatus({
              kind: "session", status: s.status, artifact: s.final_artifact, stop_reason: s.stop_reason,
              waiting_for: s.status === "awaiting_human" ? waitingReason(s.pending_kind) : null, step_count: s.step_count, max_steps: s.max_steps,
            });
            return (
              <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5" data-testid="session-row">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setExpanded(open ? null : s.id)} aria-expanded={open} className="flex min-w-0 flex-1 basis-56 items-center justify-between gap-2 text-left">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-200">
                      {open ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />}
                      <span className="truncate">{s.objective}</span>
                      <span className="shrink-0 text-xs text-zinc-500">· {toolName(s.tool_id)}{s.workflow_id && s.leg_no && !singles.has(s.workflow_id) ? ` · workflow step ${s.leg_no}` : ""}</span>
                    </span>
                    <HonestStatusBadge status={hs} />
                  </button>
                  {isOpen(s.status) && (
                    <button disabled={busy === `cancel-${s.id}`} onClick={() => act(`cancel-${s.id}`, "cancel", { session_id: s.id }, "Session stopped.")} className="flex shrink-0 items-center gap-1 rounded border border-white/15 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40">
                      <Square className="h-3 w-3" /> Stop session
                    </button>
                  )}
                </div>
                <div className="mt-1 pl-4"><StatusReason status={hs} /></div>
                {waiting && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-100">
                    <p>{waiting}</p>
                    {s.pending_kind === "question" ? (
                      <div className="mt-2 flex gap-2">
                        <input className={inputCls} placeholder="Your answer" aria-label="Your answer" value={answers[s.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [s.id]: e.target.value })} />
                        <button disabled={!(answers[s.id] ?? "").trim() || busy === `ans-${s.id}`} onClick={() => act(`ans-${s.id}`, "answer", { session_id: s.id, answer: answers[s.id] }, "Answer sent.")} className="flex shrink-0 items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 text-[11px] font-mono uppercase text-cyan-200 disabled:opacity-40">
                          <Send className="h-3 w-3" /> Send
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => navigate("/control-system/approvals")} className="mt-1 text-cyan-300 underline-offset-2 hover:underline">Open the approval queue</button>
                    )}
                  </div>
                )}
                {s.status === "awaiting_human" && s.pending_kind === "handoff" && s.handoff && (
                  <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5 text-xs text-amber-50" data-testid="handoff-panel">
                    <p className="font-medium">{s.handoff.title}</p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-amber-100/90">
                      {s.handoff.summary.map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                    <textarea className={`${inputCls} mt-2`} rows={2} aria-label="Note to the tool" placeholder="Optional note for the tool (added to the next request)" value={notes[s.id] ?? ""} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
                    {writing[s.id] != null && (
                      <div className="mt-2">
                        <textarea className={inputCls} rows={5} aria-label="Your reply" placeholder="Write the reply for this step" value={writing[s.id] ?? ""} onChange={(e) => setWriting({ ...writing, [s.id]: e.target.value })} />
                        <p className="mt-1 text-[11px] text-amber-100/70">It is checked against the same rules. If it breaks one you will be told and can fix it; if a rule needs approval it waits for it.</p>
                        <div className="mt-1.5 flex gap-2">
                          <button disabled={!(writing[s.id] ?? "").trim() || busy === `decide-${s.id}`}
                            onClick={async () => { const r = await act(`decide-${s.id}`, "decide", { session_id: s.id, option: "edit", text: writing[s.id] });
                              if (r.ok) {
                                toast.success(r.data?.status === "awaiting_human" ? "Your reply is waiting for approval before it is used." : "Your reply was used.");
                                setWriting({ ...writing, [s.id]: null });
                              } }}
                            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-mono uppercase text-cyan-100 disabled:opacity-40">Use this reply</button>
                          <button onClick={() => setWriting({ ...writing, [s.id]: null })} className="rounded border border-white/20 px-3 py-1.5 text-[11px] font-mono uppercase text-zinc-200 hover:bg-white/10">Back</button>
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.handoff.options.map((o) => (
                        <button key={o.id} title={o.description} disabled={busy === `decide-${s.id}` || (o.id === "edit" && writing[s.id] != null)}
                          onClick={() => o.id === "edit"
                            ? setWriting({ ...writing, [s.id]: s.handoff?.draft ?? "" })
                            : act(`decide-${s.id}`, "decide", { session_id: s.id, option: o.id, note: o.id === "retry" ? notes[s.id] || undefined : undefined }, o.id === "stop" ? "Session stopped." : "Asking the tool again.")}
                          className={`rounded border px-3 py-1.5 text-[11px] font-mono uppercase disabled:opacity-40 ${o.id === s.handoff!.recommended ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-100" : "border-white/20 text-zinc-200 hover:bg-white/10"}`}>
                          {o.label}{o.id === s.handoff!.recommended ? " · recommended" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {open && (
                  <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2.5 text-[11px]">
                    {hs.key === "completed" && <FinalArtifactView artifact={s.final_artifact} kind="session" />}
                    <SessionActivity toolName={toolName(s.tool_id)} status={s.status} steps={(steps[s.id] ?? []) as ActivityStep[]} completion={s.completion} pendingKind={s.pending_kind} stepCount={s.step_count} maxSteps={s.max_steps} />
                    {hs.key === "completed" && (
                      <FollowUpBox
                        toolName={toolName(s.tool_id)} busy={busy === `followup-${s.id}`}
                        onSend={async (instruction) => (await act(`followup-${s.id}`, "follow_up", { session_id: s.id, instruction }, "Follow-up started. It appears under Recent sessions.")).ok}
                      />
                    )}
                    <ul className="space-y-0.5">
                      {(steps[s.id] ?? []).map((st) => (
                        <li key={st.id} className="text-zinc-300">
                          {describeStep(st)}
                          {riskConfidenceBadges(st.decision).map((b) => (
                            <span key={b.label} className={`ml-2 rounded-full border px-1.5 py-0 text-[10px] ${b.className}`}>{b.label}</span>
                          ))}
                          {describeDecision(st.decision).map((line, i) => <div key={i} className="ml-3 text-[10px] leading-snug text-zinc-500">{line}</div>)}
                        </li>
                      ))}
                      {(steps[s.id] ?? []).length === 0 && <li className="text-zinc-500">Nothing has been exchanged yet.</li>}
                    </ul>
                    {(memory[s.id] ?? []).length > 0 && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-zinc-500">Decisions remembered for later steps</div>
                        <ul className="mt-0.5 space-y-0.5 text-zinc-300">
                          {(memory[s.id] ?? []).map((m) => <li key={m.id}>{m.summary}</li>)}
                        </ul>
                      </div>
                    )}
                    {hs.key !== "completed" && s.final_output && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-zinc-500">Last reply (not an accepted result)</div>
                        <p className="mt-0.5 whitespace-pre-wrap text-zinc-400">{s.final_output}</p>
                      </div>
                    )}
                    {s.stop_reason && !isOpen(s.status) && hs.key !== "completed" && <p className="text-zinc-400">{s.stop_reason}</p>}
                    {(() => {
                      const cc = describeCompletion(s.completion);
                      if (!cc) return null;
                      return (
                        <details className="rounded border border-white/10 px-2 py-1" data-testid="completion-check">
                          <summary className={`cursor-pointer ${cc.ok ? "text-emerald-300" : "text-amber-300"}`}>{cc.headline}</summary>
                          <ul className="mt-1 space-y-0.5">
                            {cc.lines.map((l, i) => (
                              <li key={i} className={l.ok === true ? "text-zinc-300" : l.ok === false ? "text-rose-300" : "text-zinc-500"}>{l.mark} {l.text}</li>
                            ))}
                          </ul>
                        </details>
                      );
                    })()}
                    {!isOpen(s.status) && (
                      <button type="button" disabled={busy === `archive-${s.id}`}
                        onClick={() => void act(`archive-${s.id}`, "archive", { kind: "session", id: s.id, archived: !s.archived_at }, s.archived_at ? "Restored to the list." : "Archived. It is hidden from the list, not deleted.")}
                        className="rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-400 hover:bg-white/10 hover:text-zinc-200 disabled:opacity-50" data-testid="archive-session">
                        {s.archived_at ? "Restore" : "Archive"}
                      </button>
                    )}
                    {(() => {
                      const end = describeClosure({ status: s.status, finished_at: s.finished_at ?? null, step_count: s.step_count, stop_reason: s.stop_reason, toolName: toolName(s.tool_id) });
                      return end ? <p className={`border-t border-white/10 pt-2 ${end.tone === "ok" ? "text-zinc-400" : "text-zinc-500"}`} data-testid="session-closure">{end.text}</p> : null;
                    })()}
                  </div>
                )}
              </div>
            );
  };

  const toolName = (id: string) => tools.find((t) => t.id === id)?.name ?? "Removed tool";

  // The report writer is part of NazAI, not a connection the person manages: it is not listed as a tool.
  const shownTools = tools.filter((t) => !isInternalTool(t.endpoint_url));
  const { open: openSessions, past: pastSessions } = splitSessions(sessions);
  const pastShown = visibleItems(pastSessions, DEFAULT_HISTORY, showAllPast);

  return (
    <section className="hud-glass rounded-2xl px-6 py-5" aria-label="Connected tools" data-testid="active-sessions-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Connected tools</h2>
          <p className="mt-0.5 text-xs text-zinc-500" data-testid="tools-summary">{healthSummary(shownTools, now)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowReport(true)} disabled={shownTools.length < 1} title={shownTools.length < 1 ? "Connect a tool first" : "Describe a task; NazAI picks how to do it with your tools"} className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3.5 py-2 text-sm text-zinc-100 hover:bg-white/10 disabled:opacity-40" data-testid="start-task-button">
          <Play className="h-4 w-4" /> Start task
        </button>
        <button onClick={() => setShowConnect(true)} className="flex items-center gap-1.5 rounded-lg border border-cyan-300/60 bg-cyan-400 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_18px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300" data-testid="connect-tool-button">
          <Plus className="h-4 w-4" /> Connect a tool
        </button>
        </div>
      </div>
      <ConnectToolPanel open={showConnect} onOpenChange={setShowConnect} tools={shownTools} busy={busy === "connect"} onConnect={connectTool} onTest={(t) => runTest(t.id, t.name)} testingId={busy?.startsWith("test-") ? busy.slice(5) : null} />
      <TaskPanel open={showReport} onOpenChange={setShowReport} tools={shownTools} busy={busy === "report"} onStart={startTask} onFix={(x) => runTest(x.id, x.name)} fixing={busy?.startsWith("test-") ? busy.slice(5) : null} onConnect={() => { setShowReport(false); setShowConnect(true); }} />

      <div className="mt-4 space-y-2">
        {shownTools.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center">
            <p className="text-sm text-zinc-300">No tools connected yet.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
              Press Connect a tool to add ChatGPT, Claude, Gemini or Grok with an API key, or any tool with an HTTPS address. The connection is tested right away.
            </p>
          </div>
        )}
        {shownTools.map((t) => {
          const st = toolHealth(t, now);
          const tone: Tone = st.key === "working" ? "ok" : st.key === "failed" ? "bad" : "warn";
          const more = moreFor === t.id || keyFor === t.id;
          return (
            <div key={t.id} className={`rounded-xl border bg-white/[0.03] px-4 py-3 ${TONE_BORDER[tone]}`} data-testid="tool-row">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-sm font-medium text-zinc-100">{t.name}</span>
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${TONE_TEXT[tone]}`} data-testid="tool-status" data-status={st.key}>
                      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden /> {st.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">{t.endpoint_url.startsWith("nazai-agent://") ? "Your NazAI agent" : hostOf(t.endpoint_url)}</div>
                  {describeUsage(usage.get(t.id)) && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-300" data-testid="tool-usage"><Activity className="h-3 w-3 text-cyan-300/80" aria-hidden />{describeUsage(usage.get(t.id))}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={busy === `test-${t.id}`} onClick={() => runTest(t.id, t.name)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-40">
                    {busy === `test-${t.id}` ? "Testing…" : "Test"}
                  </button>
                  <button onClick={() => setStartFor(startFor === t.id ? null : t.id)} className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25">
                    <Play className="h-3 w-3" /> Start session
                  </button>
                  <button onClick={() => { setMoreFor(more ? null : t.id); if (more) { setKeyFor(null); setNewKey(""); } }} aria-expanded={more} className="rounded-lg px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-200">
                    More
                  </button>
                </div>
              </div>
              <p className={`mt-2 text-xs ${st.key === "failed" ? "text-rose-300/90" : "text-zinc-500"}`} data-testid="tool-reason">{st.reason}</p>
              {more && (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => { setKeyFor(keyFor === t.id ? null : t.id); setNewKey(""); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10">
                      Update key
                    </button>
                    <button disabled={busy === `remove-${t.id}`} onClick={() => remove(t)} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-40">
                      {busy === `remove-${t.id}` ? "Removing…" : "Remove"}
                    </button>
                  </div>
                  {keyFor === t.id && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input className={`${inputCls} flex-1`} type="password" autoComplete="off" placeholder="New API key or token (stored encrypted, never shown again)" aria-label="New tool credential" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
                      <button disabled={busy === `key-${t.id}` || !newKey.trim()} onClick={() => saveKey(t.id)} className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">
                        {busy === `key-${t.id}` ? "Saving…" : "Save key"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {startFor === t.id && (
                <StartSessionForm
                  tool={t} tools={shownTools} job={job} setJob={setJob} keys={keys} busy={busy}
                  onStart={(keep) => start(t.id, keep)} onSwitch={(id) => setStartFor(id)} onRunTask={startAsTask}
                  onFix={(x) => runTest(x.id, x.name)} onConnect={() => setShowConnect(true)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Tasks started from Start task: after the connected tools, before the sessions. */}
      <TaskTracker accountId={accountId} refreshKey={taskStarts} />

      {openSessions.length > 0 && (
        <div className="mt-5 space-y-2" data-testid="open-sessions">
          <h3 className="text-sm font-medium text-zinc-300">Running now</h3>
          {openSessions.map(renderSession)}
        </div>
      )}

      {pastSessions.length > 0 && (
        <div className="mt-5 space-y-2" data-testid="past-sessions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-400">Recent sessions</h3>
            <div className="flex items-center gap-3 text-xs">
              {archivedCount > 0 && (
                <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-zinc-400 hover:text-zinc-200" data-testid="toggle-archived">
                  {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
                </button>
              )}
              <button type="button" disabled={busy === "export"} onClick={exportHistory} className="text-cyan-300 hover:text-cyan-200 disabled:opacity-50" data-testid="export-history">
                {busy === "export" ? "Preparing…" : "Export history (CSV)"}
              </button>
            </div>
          </div>
          {pastShown.map(renderSession)}
          {pastSessions.length > DEFAULT_HISTORY && (
            <button type="button" onClick={() => setShowAllPast((v) => !v)} className="text-sm text-cyan-300 hover:text-cyan-200">
              {showAllPast ? "Show fewer" : `View all (${pastSessions.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

type Job = { objective: string; context: string; keyId: string; maxSteps: string };

/** The Start session form of one tool. The request is read for tool names first (see ToolPlanBox), so a named tool is never ignored. */
function StartSessionForm({ tool, tools, job, setJob, keys, busy, onStart, onSwitch, onRunTask, onFix, onConnect }: {
  tool: Tool; tools: Tool[]; job: Job; setJob: (j: Job) => void; keys: KeyOpt[]; busy: string | null;
  onStart: (keepChoice: boolean) => void; onSwitch: (id: string) => void; onRunTask: (ids: string[]) => void;
  onFix: (t: Tool) => void; onConnect: () => void;
}) {
  const chosen = useMemo(() => [tool.id], [tool.id]);
  const plan = useToolPlan(job.objective, tools, chosen, 1);
  const fixing = busy?.startsWith("test-") ? busy.slice(5) : null;
  return (
    <div className="mt-3 grid gap-2 border-t border-white/5 pt-3 sm:grid-cols-2">
      <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Objective — what should the tool do?" aria-label="Objective" value={job.objective} onChange={(e) => setJob({ ...job, objective: e.target.value })} />
      <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Context (optional) — secrets are masked before anything is sent" aria-label="Context" value={job.context} onChange={(e) => setJob({ ...job, context: e.target.value })} />
      <select className={inputCls} aria-label="Rules to apply" value={job.keyId} onChange={(e) => setJob({ ...job, keyId: e.target.value })}>
        <option value="">Account-wide rules</option>
        {keys.map((k) => <option key={k.id} value={k.id}>Rules for API key: {k.name}</option>)}
      </select>
      <input className={inputCls} type="number" min={1} max={20} aria-label="Maximum steps" value={job.maxSteps} onChange={(e) => setJob({ ...job, maxSteps: e.target.value })} />
      <div className="sm:col-span-2">
        <ToolPlanBox
          state={plan} mode="session" current={tool} max={1} fixing={fixing} busy={busy === "start-task" || busy === `start-${tool.id}`}
          onUse={(ids) => (ids.length === 1 ? onSwitch(ids[0]) : onRunTask(ids))}
          onFix={(x) => onFix(x as Tool)} onConnect={onConnect}
        />
      </div>
      {plan.block && job.objective.trim() && <p className="text-xs text-zinc-500 sm:col-span-2" data-testid="start-blocked">{plan.block}</p>}
      <button disabled={busy === `start-${tool.id}` || busy === "start-task" || !job.objective.trim() || !!plan.block} onClick={() => onStart(plan.kept)} className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 sm:col-span-2">
        {busy === `start-${tool.id}` ? "Starting…" : "Start"}
      </button>
    </div>
  );
}
