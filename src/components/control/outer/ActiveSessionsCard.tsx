// Outer Control (active): connect an external tool, start a session against it, and
// watch / answer / cancel from here. Outer Control does the contacting, rule checking
// and deciding; this card only shows it and collects the few things a person must give.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plug, Play, ChevronDown, ChevronRight, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { describeStep, describeWaiting, isOpen, STATUS_LABEL, type PendingKind, type SessionStatus, type StepLike } from "@/lib/outer-control-sessions";

// The tables are new and not in the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

type Tool = { id: string; name: string; endpoint_url: string; request_format: string; approved_at: string | null; last_ok_at: string | null; last_error: string | null; last_checked_at: string | null };
type Session = {
  id: string; tool_id: string; objective: string; status: SessionStatus; step_count: number; max_steps: number;
  final_output: string | null; stop_reason: string | null; pending_kind: PendingKind | null; pending_question: string | null; started_at: string;
};
type Step = StepLike & { id: string; reply_text: string | null };
type KeyOpt = { id: string; name: string };

const STATUS_STYLE: Record<SessionStatus, string> = {
  running: "border-cyan-500/40 text-cyan-300",
  awaiting_human: "border-amber-500/50 text-amber-300",
  completed: "border-emerald-500/40 text-emerald-300",
  rejected: "border-rose-500/40 text-rose-300",
  failed: "border-rose-500/40 text-rose-300",
  cancelled: "border-white/20 text-zinc-400",
  stopped: "border-white/20 text-zinc-300",
};

async function callDrive(action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data: any; message: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/outer-control-drive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok && data?.ok !== false, data, message: data?.message || data?.error || "" };
  } catch {
    return { ok: false, data: null, message: "Could not reach Outer Control. Try again." };
  }
}

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };
const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";

export default function ActiveSessionsCard({ accountId }: { accountId: string | null | undefined }) {
  const navigate = useNavigate();
  const [tools, setTools] = useState<Tool[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyOpt[]>([]);
  const [steps, setSteps] = useState<Record<string, Step[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [startFor, setStartFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [conn, setConn] = useState({ name: "", url: "", format: "generic_json", model: "", token: "" });
  const [job, setJob] = useState({ objective: "", context: "", keyId: "", maxSteps: "5" });

  const load = useCallback(async () => {
    if (!accountId) return;
    const [t, s, k] = await Promise.all([
      anyDb.from("external_tools").select("id, name, endpoint_url, request_format, approved_at, last_ok_at, last_error, last_checked_at").eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("outer_control_sessions").select("id, tool_id, objective, status, step_count, max_steps, final_output, stop_reason, pending_kind, pending_question, started_at").eq("user_id", accountId).order("started_at", { ascending: false }).limit(10),
      anyDb.from("api_keys").select("id, name").eq("user_id", accountId).is("revoked_at", null),
    ]);
    setTools((t.data ?? []) as Tool[]);
    setSessions((s.data ?? []) as Session[]);
    setKeys((k.data ?? []) as KeyOpt[]);
  }, [accountId]);

  const loadSteps = useCallback(async (sessionId: string) => {
    const { data } = await anyDb.from("outer_control_session_steps")
      .select("id, step_no, attempt, verdict, next_action, error, note, reply_text").eq("session_id", sessionId).order("step_no").order("attempt");
    setSteps((p) => ({ ...p, [sessionId]: (data ?? []) as Step[] }));
  }, []);

  useEffect(() => { load(); }, [load]);
  // Poll while anything is open, so a running session visibly moves and an approval resumes it on screen.
  const anyOpen = sessions.some((s) => isOpen(s.status));
  useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(() => { load(); if (expanded) loadSteps(expanded); }, 4000);
    return () => clearInterval(id);
  }, [anyOpen, expanded, load, loadSteps]);
  useEffect(() => { if (expanded) loadSteps(expanded); }, [expanded, loadSteps]);

  const act = async (key: string, action: string, payload: Record<string, unknown>, okMsg?: string) => {
    setBusy(key);
    const r = await callDrive(action, payload);
    setBusy(null);
    if (!r.ok) { toast.error(r.message || "That did not work."); return r; }
    if (okMsg) toast.success(okMsg);
    await load();
    return r;
  };

  const connect = async () => {
    const r = await act("connect", "create_tool", {
      name: conn.name, endpoint_url: conn.url, request_format: conn.format, model: conn.model || undefined, token: conn.token || undefined,
    }, "Tool connected. Test it, then start a session.");
    if (r.ok) { setConn({ name: "", url: "", format: "generic_json", model: "", token: "" }); setShowConnect(false); }
  };

  const start = async (toolId: string) => {
    const r = await act(`start-${toolId}`, "start_session", {
      tool_id: toolId, objective: job.objective, context: job.context || undefined, api_key_id: job.keyId || undefined, max_steps: Number(job.maxSteps) || 5,
    }, "Session started.");
    if (r.ok) { setJob({ objective: "", context: "", keyId: "", maxSteps: "5" }); setStartFor(null); setExpanded(r.data?.session_id ?? null); }
  };

  const toolName = (id: string) => tools.find((t) => t.id === id)?.name ?? "Tool";

  return (
    <div className="hud-glass mt-6 rounded-2xl px-5 py-5" data-testid="active-sessions-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
          <Plug className="h-3.5 w-3.5 text-cyan-300" /> Active sessions — Outer Control contacts a tool for you
        </div>
        <button onClick={() => setShowConnect((v) => !v)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10">
          {showConnect ? "Close" : "Connect a tool"}
        </button>
      </div>

      {showConnect && (
        <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="Name, e.g. Support bot" aria-label="Tool name" value={conn.name} onChange={(e) => setConn({ ...conn, name: e.target.value })} />
          <input className={inputCls} placeholder="https://… (the tool's endpoint)" aria-label="Tool address" value={conn.url} onChange={(e) => setConn({ ...conn, url: e.target.value })} />
          <select className={inputCls} aria-label="Request format" value={conn.format} onChange={(e) => setConn({ ...conn, format: e.target.value })}>
            <option value="generic_json">Plain JSON</option>
            <option value="openai_chat">OpenAI-style chat</option>
            <option value="anthropic_messages">Anthropic messages</option>
          </select>
          <input className={inputCls} placeholder="Model (optional)" aria-label="Model" value={conn.model} onChange={(e) => setConn({ ...conn, model: e.target.value })} />
          <input className={`${inputCls} sm:col-span-2`} type="password" placeholder="API key or token for that tool (stored encrypted, never shown again)" aria-label="Tool credential" value={conn.token} onChange={(e) => setConn({ ...conn, token: e.target.value })} />
          <button disabled={busy === "connect" || !conn.name || !conn.url} onClick={connect} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-mono uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 sm:col-span-2">
            {busy === "connect" ? "Connecting…" : "Connect"}
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {tools.length === 0 && <p className="text-sm text-zinc-500">No tool connected yet. Connect one to let Outer Control start a session with it.</p>}
        {tools.map((t) => (
          <div key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm text-zinc-200">
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 text-xs text-zinc-500">{hostOf(t.endpoint_url)}</span>
                <span className={`ml-2 text-[10px] font-mono uppercase ${t.approved_at ? "text-emerald-300" : "text-amber-300"}`}>{t.approved_at ? "approved" : "needs first-contact approval"}</span>
                {t.last_checked_at && (
                  <span className={`ml-2 text-[10px] font-mono uppercase ${t.last_error ? "text-rose-300" : "text-emerald-300"}`}>{t.last_error ? "test failed" : "test ok"}</span>
                )}
              </div>
              <div className="flex gap-2">
                <button disabled={busy === `test-${t.id}`} onClick={() => act(`test-${t.id}`, "test_tool", { tool_id: t.id }, "Connection works.")} className="rounded border border-white/15 px-2.5 py-1 text-[11px] font-mono uppercase text-zinc-300 hover:bg-white/10 disabled:opacity-40">
                  {busy === `test-${t.id}` ? "Testing…" : "Test"}
                </button>
                <button onClick={() => setStartFor(startFor === t.id ? null : t.id)} className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-mono uppercase text-cyan-200 hover:bg-cyan-500/20">
                  <Play className="h-3 w-3" /> Start session
                </button>
              </div>
            </div>
            {t.last_error && <p className="mt-1 text-xs text-rose-300/90">{t.last_error}</p>}
            {startFor === t.id && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Objective — what should the tool do?" aria-label="Objective" value={job.objective} onChange={(e) => setJob({ ...job, objective: e.target.value })} />
                <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Context (optional) — secrets are masked before anything is sent" aria-label="Context" value={job.context} onChange={(e) => setJob({ ...job, context: e.target.value })} />
                <select className={inputCls} aria-label="Rules to apply" value={job.keyId} onChange={(e) => setJob({ ...job, keyId: e.target.value })}>
                  <option value="">Account-wide rules</option>
                  {keys.map((k) => <option key={k.id} value={k.id}>Rules for API key: {k.name}</option>)}
                </select>
                <input className={inputCls} type="number" min={1} max={20} aria-label="Maximum steps" value={job.maxSteps} onChange={(e) => setJob({ ...job, maxSteps: e.target.value })} />
                <button disabled={busy === `start-${t.id}` || !job.objective.trim()} onClick={() => start(t.id)} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-mono uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 sm:col-span-2">
                  {busy === `start-${t.id}` ? "Starting…" : "Start"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {sessions.length > 0 && (
        <div className="mt-5 space-y-2">
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Recent sessions</div>
          {sessions.map((s) => {
            const open = expanded === s.id;
            const waiting = s.status === "awaiting_human" ? describeWaiting(s.pending_kind, s.pending_question) : null;
            return (
              <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5" data-testid="session-row">
                <button type="button" onClick={() => setExpanded(open ? null : s.id)} className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-200">
                    {open ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />}
                    <span className="truncate">{s.objective}</span>
                    <span className="shrink-0 text-xs text-zinc-500">· {toolName(s.tool_id)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                </button>
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
                {open && (
                  <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2.5 text-[11px]">
                    <ul className="space-y-0.5">
                      {(steps[s.id] ?? []).map((st) => <li key={st.id} className="text-zinc-300">{describeStep(st)}</li>)}
                      {(steps[s.id] ?? []).length === 0 && <li className="text-zinc-500">Nothing has been exchanged yet.</li>}
                    </ul>
                    {s.final_output && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-zinc-500">Result</div>
                        <p className="mt-0.5 whitespace-pre-wrap text-zinc-100">{s.final_output}</p>
                      </div>
                    )}
                    {s.stop_reason && !isOpen(s.status) && <p className="text-zinc-400">{s.stop_reason}</p>}
                    {isOpen(s.status) && (
                      <button disabled={busy === `cancel-${s.id}`} onClick={() => act(`cancel-${s.id}`, "cancel", { session_id: s.id }, "Session cancelled.")} className="flex items-center gap-1 rounded border border-white/15 px-2.5 py-1 font-mono uppercase text-zinc-300 hover:bg-white/10">
                        <X className="h-3 w-3" /> Cancel session
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
