import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Plug, X, Package, FileText, Sheet, Mail, Calendar, ExternalLink, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import GeneratedAgentDashboard, { type AgentUiSpec } from "./GeneratedAgentDashboard";
import AgentEmployeePanel from "./AgentEmployeePanel";
import AgentIntegrationsPanel from "./AgentIntegrationsPanel";

type OutputItem = {
  id: string;
  type: string;
  label: string;
  url: string | null;
  ref: string | null;
  created_at: string;
};

const OUTPUT_TYPES = new Set([
  "create_doc", "edit_doc", "create_sheet", "edit_sheet",
  "create_calendar_event", "send_email", "reply_email", "generate_report",
]);

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  create_doc: { icon: FileText, label: "Google Doc", color: "text-blue-300" },
  edit_doc: { icon: FileEdit, label: "Doc edit", color: "text-blue-300" },
  create_sheet: { icon: Sheet, label: "Google Sheet", color: "text-emerald-300" },
  edit_sheet: { icon: FileEdit, label: "Sheet edit", color: "text-emerald-300" },
  create_calendar_event: { icon: Calendar, label: "Calendar event", color: "text-purple-300" },
  send_email: { icon: Mail, label: "Email sent", color: "text-amber-300" },
  reply_email: { icon: Mail, label: "Email reply", color: "text-amber-300" },
  generate_report: { icon: FileText, label: "Report", color: "text-cyan-300" },
};

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
  const [gmailAcct, setGmailAcct] = useState<{ email: string | null; verified: string | null; status: string } | null>(null);
  const [gmailVerifying, setGmailVerifying] = useState(false);
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

  const loadGmail = useCallback(async () => {
    const { data } = await supabase
      .from("agent_integrations")
      .select("provider, status, metadata, last_verified_at")
      .eq("agent_id", agentId)
      .eq("provider", "Gmail")
      .maybeSingle();
    if (!data) { setGmailAcct(null); return; }
    const meta = (data.metadata as Record<string, unknown>) || {};
    setGmailAcct({
      email: (meta.account_email as string) || null,
      verified: (data.last_verified_at as string) || null,
      status: (data.status as string) || "connected",
    });
  }, [agentId]);

  const verifyGmail = useCallback(async () => {
    setGmailVerifying(true);
    try {
      await supabase.functions.invoke("integration-connect", {
        body: { action: "fetch", provider: "Gmail", agentId },
      });
      await loadGmail();
      toast.success("Gmail account confirmed");
    } catch {
      toast.error("Couldn't verify Gmail");
    } finally {
      setGmailVerifying(false);
    }
  }, [agentId, loadGmail]);


  // Initial load + realtime subscription on this agent's events.
  useEffect(() => {
    loadEvents();
    loadGmail();
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
    ? { bg: "bg-amber-400/15", text: "text-amber-300", border: "border-amber-400/40", label: "NEEDS SETUP", pulse: false }
    : { bg: "bg-emerald-400/15", text: "text-emerald-300", border: "border-emerald-400/40", label: "ACTIVE", pulse: false };

  const [outputsOpen, setOutputsOpen] = useState(false);
  const outputs = useMemo<OutputItem[]>(() => {
    const out: OutputItem[] = [];
    for (const e of events) {
      if (e.kind !== "action") continue;
      const p = (e.payload || {}) as Record<string, unknown>;
      const type = String(p.type || "");
      if (!OUTPUT_TYPES.has(type)) continue;
      if (p.ok !== true) continue;
      const url = (p.url as string) || null;
      const ref = (p.result_ref as string) || null;
      if (!url && !ref) continue;
      out.push({
        id: e.id,
        type,
        label: String(p.target || p.summary || type),
        url,
        ref,
        created_at: e.created_at,
      });
    }
    const seen = new Set<string>();
    return out.reverse().filter((o) => {
      const k = `${o.type}:${o.url || o.ref}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [events]);

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
        <button
          onClick={() => { loadEvents(); setOutputsOpen(true); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-400/40 bg-emerald-400/10 text-xs text-emerald-200 font-semibold hover:bg-emerald-400/20"
        >
          <Package className="h-3.5 w-3.5" />
          Outputs
          <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-100 text-[10px] font-mono">
            {outputs.length}
          </span>
        </button>
        {onOpenBlueprint && (
          <button
            onClick={onOpenBlueprint}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            Blueprint
          </button>
        )}
        <button
          onClick={() => lastRunStatus === "error" && setLastRunStatus("")}
          className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-bold border ${statusPill.bg} ${statusPill.text} ${statusPill.border} ${lastRunStatus === "error" ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
          title={lastRunStatus === "error" ? "Click to dismiss. Connect a business tool, then Run Now." : undefined}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${statusPill.text.replace("text-", "bg-")} ${statusPill.pulse ? "animate-pulse" : ""}`} />
          {statusPill.label}
        </button>
      </div>

      {outputsOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
          style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
          onClick={() => setOutputsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden mt-16"
            style={{ background: "#0a0b0f", border: "1px solid rgba(52,211,153,0.28)", boxShadow: "0 40px 120px -40px rgba(52,211,153,0.4)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-emerald-300" />
                <div>
                  <div className="text-sm font-bold text-white">Outputs</div>
                  <div className="text-[11px] text-zinc-500">Verified artifacts this agent created</div>
                </div>
              </div>
              <button onClick={() => setOutputsOpen(false)} className="text-zinc-400 hover:text-white p-1 rounded hover:bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {outputs.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-zinc-500">
                  No completed actions yet.
                  <div className="text-[11px] text-zinc-600 mt-1">Run the agent — verified outputs (docs, sheets, emails, events) will appear here.</div>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {outputs.map((o) => {
                    const meta = TYPE_META[o.type] || { icon: Package, label: o.type, color: "text-zinc-300" };
                    const Icon = meta.icon;
                    const when = new Date(o.created_at);
                    return (
                      <li key={o.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                        <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-white truncate">{o.label}</div>
                          <div className="text-[11px] text-zinc-500">
                            {meta.label} · {when.toLocaleString()}
                          </div>
                        </div>
                        {o.url ? (
                          <a
                            href={o.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-[11px] text-emerald-200 hover:bg-emerald-400/20"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[10px] font-mono text-zinc-600 truncate max-w-[140px]">{o.ref}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bespoke per-agent generated dashboard */}
      <div ref={feedRef}>
        <GeneratedAgentDashboard manifest={manifest} events={events} agentId={agentId} />
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
