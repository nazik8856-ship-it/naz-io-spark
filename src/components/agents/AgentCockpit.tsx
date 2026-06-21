import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import GeneratedAgentDashboard, { type AgentUiSpec } from "./GeneratedAgentDashboard";

export type AgentManifest = {
  name: string;
  goal: string;
  systemPrompt: string;
  decisionPolicy: string;
  tools: { name: string; description: string; kind: string; config: Record<string, unknown> }[];
  triggers: { kind: string; spec: string }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  kpis: { name: string; target: string }[];
  ui?: AgentUiSpec;
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

  // Initial load + realtime subscription on this agent's events.
  useEffect(() => {
    loadEvents();
    const channel = supabase
      .channel(`agent_events:${agentId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_events", filter: `agent_id=eq.${agentId}` },
        (payload) => {
          const row = payload.new as AgentEvent;
          setEvents((prev) => (prev.find((e) => e.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();
    // Lightweight safety-net poll (in case realtime drops a message).
    const iv = setInterval(loadEvents, 8000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(iv);
    };
  }, [agentId, loadEvents]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events.length]);

  // Derive status from the most recent run's events.
  // A run that contained ANY error/tool_error stays flagged as ERROR even after it "finishes",
  // so transient failures don't silently flip the pill back to ACTIVE.
  useEffect(() => {
    if (!events.length) return;
    // Find boundary of the latest run
    let startIdx = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === "run_started") { startIdx = i; break; }
    }
    const slice = events.slice(startIdx);
    const hasError = slice.some((e) => e.kind === "error" || e.kind === "tool_error" || e.kind === "guardrail_block");
    const finished = slice.some((e) => e.kind === "finished");
    const last = events[events.length - 1];
    if (last.kind === "run_started" || (!finished && slice.length > 0)) {
      setRunning(true);
      if (hasError) setLastRunStatus("error");
    } else if (finished) {
      setRunning(false);
      setLastRunStatus(hasError ? "error" : "completed");
    }
  }, [events]);

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setLastRunStatus("running");
    try {
      const { data, error } = await supabase.functions.invoke("agent-runtime", {
        body: { agentId, trigger: "manual" },
      });
      if (error) throw new Error(error.message || "Run failed");
      toast.success(`Run finished: ${(data as { summary?: string })?.summary || "ok"}`);
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
    <div className="space-y-4">
      {/* Status + actions bar (the generated dashboard renders its own hero) */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runNow}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 text-black text-sm font-bold hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : "Run Now"}
        </button>
        {onOpenBlueprint && (
          <button
            onClick={onOpenBlueprint}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            Blueprint
          </button>
        )}
        <span className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-bold border ${statusPill.bg} ${statusPill.text} ${statusPill.border}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusPill.text.replace("text-", "bg-")} ${statusPill.pulse ? "animate-pulse" : ""}`} />
          {statusPill.label}
        </span>
      </div>

      {/* Bespoke per-agent generated dashboard */}
      <div ref={feedRef}>
        <GeneratedAgentDashboard manifest={manifest} events={events} />
      </div>
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
