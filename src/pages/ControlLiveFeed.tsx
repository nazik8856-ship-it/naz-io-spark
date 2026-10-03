import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Radio, Pause, Play, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { classifyDecisionOutcome, type DecisionOutcome } from "@/lib/roi-report";
import { type TraceEntry } from "@/components/control/GateTraceList";
import { DecisionExplanationPanel } from "@/components/control/DecisionExplanationPanel";
import type { PrecedentCitationRecord, DeferredDetail } from "@/lib/decision-explanation";

const MAX_ROWS = 200;

type DecisionRow = {
  id: string;
  decision: string;
  reasoning: string;
  source: string;
  escalated: boolean;
  confidence_score: number;
  agent_id: string | null;
  api_key_id: string | null;
  created_at: string;
  gate_trace: TraceEntry[] | null;
  human_response: string | null;
  action_type: string | null;
  provider: string | null;
  precedent_citations: PrecedentCitationRecord | null;
  deferred_detail: { why_not_now?: string; what_would_change_it?: string; improvement_steps?: string[]; reconsider_when?: string } | null;
  modified_params: Record<string, unknown> | null;
};

function toDeferredDetail(raw: DecisionRow["deferred_detail"]): DeferredDetail | null {
  if (!raw) return null;
  return {
    whyNotNow: raw.why_not_now ?? "",
    whatWouldChangeIt: raw.what_would_change_it ?? "",
    improvementSteps: raw.improvement_steps ?? [],
    reconsiderWhen: raw.reconsider_when ?? "",
  };
}

type AgentOption = { id: string; name: string };
type ApiKeyOption = { id: string; name: string };

const OUTCOME_STYLE: Record<DecisionOutcome, string> = {
  block: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  modify: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  allow: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  deferred: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  approval_required: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  other: "text-zinc-400 border-white/15 bg-white/5",
};

// Task #51: Inner Control (NazAI's own agents, agent_decisions) and Outer
// Control (external AI responses/actions, outer_control_evaluations) were
// two completely separate feeds, on two separate pages with two separate
// visual languages -- the product's own stated vision is "clients must feel
// these three parts working together as one controlled machine, not three
// separate tools." An owner who wanted to see everything happening across
// their account had to check two places and mentally interleave them.
type OuterVerdict = "allow" | "modify" | "block" | "escalate";
type OuterEvalRow = {
  id: string;
  source_model: string;
  verdict: OuterVerdict;
  trust_score: number;
  summary: string | null;
  created_at: string;
  content_kind: "text" | "action";
  action_type: string | null;
  executed: boolean;
};
const OUTER_VERDICT_STYLE: Record<OuterVerdict, string> = {
  allow: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  modify: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10",
  escalate: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  block: "text-rose-300 border-rose-500/40 bg-rose-500/10",
};

type FeedItem =
  | { kind: "inner"; id: string; created_at: string; row: DecisionRow }
  | { kind: "outer"; id: string; created_at: string; row: OuterEvalRow };

const byNewest = (a: FeedItem, b: FeedItem) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

/**
 * LIVE DECISION FEED — decisions as they happen, via Supabase Realtime on
 * agent_decisions (already publication-enabled since this table's
 * creation), distinct from the paginated historical views (approvals,
 * incidents, decisions list) everywhere else in the product. Read-only
 * monitoring, no action taken from here.
 */
export default function ControlLiveFeed() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [rows, setRows] = useState<FeedItem[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyOption[]>([]);
  const [paused, setPaused] = useState(false);
  const [innerConnected, setInnerConnected] = useState(false);
  const [outerConnected, setOuterConnected] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Blueprint: Inner/Outer Control sync -- an agent_decisions row with
  // agent_id null was always rendered as "Chat," with no distinction for
  // Outer Control's mode="full" traffic (api_key_id set instead, logged
  // into this same table via the shared gate).
  const originName = (agentId: string | null, apiKeyId: string | null) => {
    if (agentId) return agents.find((a) => a.id === agentId)?.name ?? "Unknown agent";
    if (apiKeyId) return `API: ${apiKeys.find((k) => k.id === apiKeyId)?.name ?? "Unknown key"}`;
    return "Chat";
  };

  const toggleTrace = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const loadRecent = useCallback(async () => {
    if (!accountId) return;
    // anyDb: outer_control_evaluations isn't in the generated Supabase
    // types yet -- same established workaround every other page touching
    // this table already uses (OuterControlSystem.tsx).
    const anyDb = supabase as any;
    const [{ data: inner }, { data: outer }, { data: agentRows }, { data: apiKeyRows }] = await Promise.all([
      supabase
        .from("agent_decisions")
        .select("id, decision, reasoning, source, escalated, confidence_score, agent_id, api_key_id, created_at, gate_trace, human_response, action_type, provider, precedent_citations, deferred_detail, modified_params")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50),
      anyDb
        .from("outer_control_evaluations")
        .select("id, source_model, verdict, trust_score, summary, created_at, content_kind, action_type, executed")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("agents").select("id, name").eq("user_id", accountId),
      anyDb.from("api_keys").select("id, name").eq("user_id", accountId),
    ]);
    const innerItems: FeedItem[] = ((inner ?? []) as DecisionRow[]).map((row) => ({ kind: "inner", id: row.id, created_at: row.created_at, row }));
    const outerItems: FeedItem[] = ((outer ?? []) as OuterEvalRow[]).map((row) => ({ kind: "outer", id: row.id, created_at: row.created_at, row }));
    setRows([...innerItems, ...outerItems].sort(byNewest).slice(0, MAX_ROWS));
    setAgents((agentRows ?? []) as AgentOption[]);
    setApiKeys((apiKeyRows ?? []) as ApiKeyOption[]);
  }, [accountId]);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  useEffect(() => {
    if (!accountId) return;
    const innerChannel = supabase
      .channel(`live-decisions-${accountId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_decisions", filter: `user_id=eq.${accountId}` },
        (payload) => {
          if (pausedRef.current) return;
          const row = payload.new as DecisionRow;
          setRows((prev) => [{ kind: "inner", id: row.id, created_at: row.created_at, row }, ...prev].sort(byNewest).slice(0, MAX_ROWS));
        },
      )
      .subscribe((status) => setInnerConnected(status === "SUBSCRIBED"));
    const outerChannel = supabase
      .channel(`live-outer-evaluations-${accountId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "outer_control_evaluations", filter: `user_id=eq.${accountId}` },
        (payload) => {
          if (pausedRef.current) return;
          const row = payload.new as OuterEvalRow;
          setRows((prev) => [{ kind: "outer", id: row.id, created_at: row.created_at, row }, ...prev].sort(byNewest).slice(0, MAX_ROWS));
        },
      )
      .subscribe((status) => setOuterConnected(status === "SUBSCRIBED"));
    return () => { void supabase.removeChannel(innerChannel); void supabase.removeChannel(outerChannel); };
  }, [accountId]);

  const connected = innerConnected && outerConnected;

  const resume = () => {
    setPaused(false);
    void loadRecent();
  };

  if (!user) return null;

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Radio className={`h-5 w-5 ${connected ? "text-emerald-400" : "text-zinc-500"}`} /> Live activity feed
          </h1>
          <button
            onClick={() => (paused ? resume() : setPaused(true))}
            className="flex items-center gap-1.5 rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Inner Control (your own agents) and Outer Control (connected external AI), streamed live in one place. {connected ? "Connected." : "Connecting…"}
          {paused && " Paused — new activity isn't appearing until you resume."}
        </p>

        <ul className="mt-6 space-y-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
              Nothing yet.
            </p>
          ) : rows.map((item) => {
            if (item.kind === "outer") {
              const r = item.row;
              return (
                <li key={item.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-cyan-300">Outer</span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${OUTER_VERDICT_STYLE[r.verdict]}`}>{r.verdict}</span>
                    <span className="font-mono text-xs text-zinc-300">
                      {r.content_kind === "action" && r.action_type ? r.action_type : "text review"}
                    </span>
                    <span className="ml-auto text-[11px] text-zinc-500">{new Date(r.created_at).toLocaleTimeString()}</span>
                  </div>
                  {r.summary && <p className="mt-1 text-xs text-zinc-400">{r.summary}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-zinc-500">
                    <span className="text-cyan-400">external AI: {r.source_model}</span>
                    <span>· trust {r.trust_score}</span>
                    {r.content_kind === "action" && (
                      <span className={r.executed ? "text-emerald-300" : undefined}>· {r.executed ? "executed" : "evaluated only"}</span>
                    )}
                  </div>
                </li>
              );
            }
            const r = item.row;
            const outcome = classifyDecisionOutcome(r.decision);
            return (
              <li key={item.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-zinc-400">Inner</span>
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${OUTCOME_STYLE[outcome]}`}>{outcome.replace("_", " ")}</span>
                  <span className="font-mono text-xs text-zinc-300">{r.decision}</span>
                  <span className="ml-auto text-[11px] text-zinc-500">{new Date(r.created_at).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{r.reasoning}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-zinc-500">
                  <span className="text-cyan-400">{originName(r.agent_id, r.api_key_id)}</span>
                  <span>· {r.source}</span>
                  <span>· confidence {r.confidence_score}</span>
                  {r.escalated && <span className="text-amber-300">· escalated</span>}
                </div>
                {/* Pillar 2 top-10 item 10: this button used to only appear
                    when gate_trace was non-empty -- kill-switch flips,
                    circuit-breaker trips, and break-glass overrides never
                    populate gate_trace at all (they're logged directly, not
                    through the control gate's own trace-building path), so
                    "Why" never appeared for exactly the events customers
                    most want explained. DecisionExplanationPanel composes a
                    real narrative from whatever the row actually has, gate
                    trace or not, so this is now unconditional. */}
                <button
                  onClick={() => toggleTrace(item.id)}
                  className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-500 hover:text-zinc-300"
                >
                  {expanded.has(item.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Why
                </button>
                {expanded.has(item.id) && (
                  <DecisionExplanationPanel
                    decision={r.decision}
                    reasoning={r.reasoning}
                    confidenceScore={r.confidence_score}
                    source={r.source}
                    escalated={r.escalated}
                    humanResponse={r.human_response}
                    actionType={r.action_type}
                    provider={r.provider}
                    createdAt={r.created_at}
                    gateTrace={r.gate_trace}
                    precedentCitations={r.precedent_citations}
                    deferredDetail={toDeferredDetail(r.deferred_detail)}
                    modifiedParams={r.modified_params}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
