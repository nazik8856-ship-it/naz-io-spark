import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Loader2, Play, ShieldCheck, Wrench, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { functionUrl, functionHeaders } from "@/constants";
import { toast } from "sonner";

export type AgentManifest = {
  name: string;
  goal: string;
  systemPrompt: string;
  decisionPolicy: string;
  tools: { name: string; description: string; kind: string; config: Record<string, unknown> }[];
  triggers: { kind: string; spec: string }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  kpis: { name: string; target: string }[];
};

type AgentEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

interface Props {
  agentId: string;
  manifest: AgentManifest;
  onOpenBlueprint?: () => void;
}

const EVENT_META: Record<string, { color: string; icon: string; label: string }> = {
  run_started:    { color: "text-cyan-300",    icon: "▶",  label: "Run started" },
  reason:         { color: "text-zinc-300",    icon: "🧠", label: "Reasoning" },
  tool_call:      { color: "text-purple-300",  icon: "→",  label: "Tool call" },
  tool_result:    { color: "text-emerald-300", icon: "←",  label: "Tool result" },
  tool_error:     { color: "text-amber-300",   icon: "⚠",  label: "Tool error" },
  decision:       { color: "text-cyan-200",    icon: "◆",  label: "Decision" },
  action:         { color: "text-emerald-400", icon: "✔",  label: "Action taken" },
  guardrail_block:{ color: "text-amber-300",   icon: "🛡", label: "Guardrail" },
  finished:       { color: "text-emerald-400", icon: "✓",  label: "Finished" },
  error:          { color: "text-red-300",     icon: "✖",  label: "Error" },
};

export default function AgentCockpit({ agentId, manifest, onOpenBlueprint }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<string>("");
  const feedRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("agent_events")
      .select("id, kind, payload, created_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!error && data) setEvents(data as AgentEvent[]);
  }, [agentId]);

  // Poll while running (every 1.5s), otherwise every 6s.
  useEffect(() => {
    loadEvents();
    const iv = setInterval(loadEvents, running ? 1500 : 6000);
    return () => clearInterval(iv);
  }, [loadEvents, running]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events.length]);

  // Watch for finished/error events to flip status
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    if (last.kind === "finished" || last.kind === "error") {
      setRunning(false);
      setLastRunStatus(last.kind === "finished" ? "completed" : "error");
    } else if (last.kind === "run_started") {
      setRunning(true);
    }
  }, [events]);

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setLastRunStatus("running");
    try {
      const resp = await fetch(functionUrl("agent-runtime"), {
        method: "POST",
        headers: functionHeaders(),
        body: JSON.stringify({ agentId, trigger: "manual" }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `Run failed (${resp.status})`);
      }
      const data = await resp.json();
      toast.success(`Run finished: ${data.summary || "ok"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
      loadEvents();
    }
  };

  const statusPill = running
    ? { bg: "bg-cyan-400/15", text: "text-cyan-300", border: "border-cyan-400/40", label: "RUNNING", pulse: true }
    : lastRunStatus === "error"
    ? { bg: "bg-red-400/15", text: "text-red-300", border: "border-red-400/40", label: "ERROR", pulse: false }
    : { bg: "bg-emerald-400/15", text: "text-emerald-300", border: "border-emerald-400/40", label: "ACTIVE", pulse: false };

  return (
    <div className="space-y-5">
      {/* Hero header */}
      <header className="rounded-xl border border-emerald-400/30 bg-gradient-to-br from-emerald-400/10 via-cyan-400/5 to-transparent p-5 flex items-center gap-4 shadow-[0_0_60px_-15px_rgba(16,185,129,0.4)]">
        <div className="shrink-0 h-14 w-14 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-black text-2xl font-black">
          {manifest.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.22em] text-emerald-300 font-mono mb-0.5">Live Autonomous Agent</div>
          <div className="text-lg md:text-xl font-bold text-white truncate">{manifest.name}</div>
          <div className="text-xs text-zinc-300 truncate">{manifest.goal}</div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-mono font-bold border ${statusPill.bg} ${statusPill.text} ${statusPill.border}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusPill.text.replace("text-", "bg-")} ${statusPill.pulse ? "animate-pulse" : ""}`} />
          {statusPill.label}
        </span>
        <button
          onClick={runNow}
          disabled={running}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 text-black text-sm font-bold hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : "Run Now"}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Live activity feed */}
        <section className="lg:col-span-3 rounded-xl border border-cyan-400/20 bg-black/60 flex flex-col min-h-[420px] max-h-[560px]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-300 font-mono">
              <Activity className="h-3.5 w-3.5" />
              Autonomous Activity
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">{events.length} events</span>
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 font-mono text-xs">
            {events.length === 0 ? (
              <div className="text-zinc-500 italic">No activity yet. Press Run Now to start the agent's autonomous loop.</div>
            ) : (
              events.map((e) => {
                const meta = EVENT_META[e.kind] || { color: "text-zinc-400", icon: "·", label: e.kind };
                return (
                  <div key={e.id} className="flex gap-2.5">
                    <span className={`shrink-0 ${meta.color} w-4 text-center`}>{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[10px] uppercase tracking-wider ${meta.color} opacity-80`}>
                        {meta.label} · <span className="text-zinc-500">{new Date(e.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-zinc-200 leading-relaxed break-words whitespace-pre-wrap">
                        {renderPayload(e.kind, e.payload)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Sidebar: tools, guardrails, KPIs */}
        <aside className="lg:col-span-2 space-y-4">
          <Panel title="Tools" icon={<Wrench className="h-3.5 w-3.5" />} color="text-purple-300" border="border-purple-400/20">
            <ul className="space-y-2">
              {manifest.tools.map((t) => {
                const needsSecret = t.kind === "custom" && t.config?.needsSecret;
                return (
                  <li key={t.name} className="rounded-md border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-white truncate">{t.name}</div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${needsSecret ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300"}`}>
                        {needsSecret ? "needs secret" : t.kind}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{t.description}</div>
                    {needsSecret && (
                      <div className="text-[10px] text-amber-300/80 mt-1 font-mono">
                        ⚠ Add secret <code className="bg-black/40 px-1 rounded">{String(t.config.needsSecret)}</code> to enable.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Guardrails" icon={<ShieldCheck className="h-3.5 w-3.5" />} color="text-amber-300" border="border-amber-400/20">
            <ul className="space-y-1.5">
              {manifest.guardrails.map((g, i) => (
                <li key={i} className="text-[11px] text-zinc-300 flex gap-2">
                  <span className="text-amber-400 mt-0.5">•</span>
                  <span className="flex-1">
                    {g.rule}
                    {g.requiresApproval && <span className="ml-1.5 text-[9px] uppercase font-mono bg-amber-400/20 text-amber-200 px-1 rounded">approval</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="KPIs" icon={<Zap className="h-3.5 w-3.5" />} color="text-emerald-300" border="border-emerald-400/20">
            <ul className="space-y-1.5">
              {manifest.kpis.map((k, i) => (
                <li key={i} className="text-[11px] flex items-center justify-between gap-2">
                  <span className="text-zinc-300 truncate">{k.name}</span>
                  <span className="text-emerald-300 font-mono font-bold shrink-0">{k.target}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Triggers" icon={<CheckCircle2 className="h-3.5 w-3.5" />} color="text-cyan-300" border="border-cyan-400/20">
            <ul className="space-y-1.5">
              {manifest.triggers.map((t, i) => (
                <li key={i} className="text-[11px] flex items-center justify-between gap-2">
                  <span className="text-zinc-300 uppercase tracking-wider text-[10px]">{t.kind}</span>
                  <span className="text-cyan-300 font-mono truncate">{t.spec}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {onOpenBlueprint && (
            <button
              onClick={onOpenBlueprint}
              className="w-full px-3 py-2 rounded-md border border-white/10 bg-white/[0.03] text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition"
            >
              View Original Plan & Blueprint
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Panel({ title, icon, color, border, children }: { title: string; icon: React.ReactNode; color: string; border: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border ${border} bg-black/40 p-3.5`}>
      <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-mono mb-2.5 ${color}`}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function renderPayload(kind: string, p: Record<string, unknown>): string {
  if (kind === "run_started") return `Trigger: ${p.trigger ?? "?"} · Goal: ${p.goal ?? ""}`;
  if (kind === "reason") return String(p.thought ?? "");
  if (kind === "tool_call") return `${p.tool}(${JSON.stringify(p.input ?? {})})`;
  if (kind === "tool_result") return String(p.summary ?? "");
  if (kind === "tool_error") return `${p.tool}: ${p.message ?? "error"}`;
  if (kind === "decision") return `${p.decision ?? ""}${p.rationale ? ` — ${p.rationale}` : ""}`;
  if (kind === "action") return `${p.type ?? "action"} [${p.severity ?? "info"}] ${p.message ?? ""}`;
  if (kind === "guardrail_block") return String(p.message ?? p.reason ?? "");
  if (kind === "finished") return `${p.summary ?? "done"}${p.partial ? " (partial)" : ""}`;
  if (kind === "error") return String(p.message ?? "");
  return JSON.stringify(p);
}
