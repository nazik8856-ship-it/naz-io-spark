import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Plug, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import GeneratedAgentDashboard, { type AgentUiSpec } from "./GeneratedAgentDashboard";
import AgentEmployeePanel from "./AgentEmployeePanel";
import AgentIntegrationsPanel from "./AgentIntegrationsPanel";

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
  run_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};


interface Props {
  agentId: string;
  manifest: AgentManifest;
  onOpenBlueprint?: () => void;
}




export default function AgentCockpit({ agentId, manifest, onOpenBlueprint }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<string>("");
  const feedRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("agent_events")
      .select("id, run_id, kind, payload, created_at")
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
  // We only flag ERROR when the latest run finished AND produced no usable output
  // (i.e. errored before any reasoning/action/finished step). Transient tool
  // errors during an otherwise-successful run no longer stick the pill on ERROR.
  useEffect(() => {
    if (!events.length) {
      setRunning(false);
      setLastRunStatus("");
      return;
    }
    let startIdx = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === "run_started") { startIdx = i; break; }
    }
    const slice = events.slice(startIdx);
    const finished = slice.some((e) => e.kind === "finished");
    const hasProgress = slice.some((e) =>
      ["reasoning", "tool_call", "tool_result", "action", "finished"].includes(e.kind),
    );
    const hardError = slice.some((e) => e.kind === "error" || e.kind === "guardrail_block");
    const last = events[events.length - 1];

    if (last.kind === "run_started" || (!finished && slice.length > 0 && last.kind !== "error")) {
      setRunning(true);
    } else {
      setRunning(false);
      if (finished && hasProgress) setLastRunStatus("completed");
      else if (hardError && !hasProgress) setLastRunStatus("error");
      else setLastRunStatus("completed");
    }
  }, [events]);

  const [needsIntegrations, setNeedsIntegrations] = useState(false);

  const checkIntegrations = useCallback(async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke("integration-connect", {
        body: { action: "list", agentId },
      });
      if (error) return false;
      const rows = ((data as { integrations?: { status: string }[] }).integrations) || [];
      return rows.some((r) => r.status === "connected");
    } catch {
      return false;
    }
  }, [agentId]);

  const runNow = async () => {
    if (running) return;
    const hasIntegrations = await checkIntegrations();
    if (!hasIntegrations) {
      setNeedsIntegrations(true);
      return;
    }
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

      {/* Digital-employee surfaces: business sync, schedule, approvals, clarifications, memory */}
      <AgentEmployeePanel agentId={agentId} events={events} />

      {/* Business Integrations & Setup — every agent ships with concrete connect-your-tools guidance */}
      <AgentIntegrationsPanel
        manifest={manifest as unknown as { name?: string; goal?: string; integrations?: import("./AgentIntegrationsPanel").IntegrationsSpec; role?: string }}
        agentId={agentId}
        accent={(manifest as unknown as { ui?: { accent?: string } })?.ui?.accent || "#34d399"}
      />

      {needsIntegrations && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
          onClick={() => setNeedsIntegrations(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl overflow-hidden p-6"
            style={{
              background: "linear-gradient(135deg, rgba(52,211,153,0.08), rgba(34,211,238,0.04)), #08090c",
              border: "1px solid rgba(52,211,153,0.35)",
              boxShadow: "0 40px 120px -40px rgba(52,211,153,0.5)",
            }}
          >
            <button
              onClick={() => setNeedsIntegrations(false)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="h-12 w-12 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "linear-gradient(135deg, #34d399, #22d3ee)", boxShadow: "0 8px 24px -8px rgba(52,211,153,0.6)" }}>
              <Plug className="h-6 w-6 text-black" />
            </div>
            <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-emerald-300 mb-1">Action required</div>
            <h3 className="text-xl font-bold text-white mb-2">Connect a business tool first</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-5">
              This agent needs at least one connected system (CRM, mailbox, store, payments, analytics…) to run against real data. Pick one below and paste your credentials — takes under a minute.
            </p>
            <button
              onClick={() => {
                setNeedsIntegrations(false);
                window.dispatchEvent(
                  new CustomEvent("nazai:open-integrations-hub", { detail: { agentId } }),
                );
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-black"
              style={{ background: "linear-gradient(135deg, #34d399, #22d3ee)", boxShadow: "0 14px 36px -12px rgba(52,211,153,0.6)" }}
            >
              <Plug className="h-4 w-4" />
              Choose tools to connect
            </button>
            <button
              onClick={() => setNeedsIntegrations(false)}
              className="w-full mt-2 px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-white"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
