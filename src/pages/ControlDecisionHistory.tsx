import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History as HistoryIcon, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { toast } from "@/hooks/use-toast";
import { filterBySearch } from "@/lib/search-filter";
import { classifyDecisionOutcome, type DecisionOutcome } from "@/lib/roi-report";
import { GateTraceList, type TraceEntry } from "@/components/control/GateTraceList";

// action_type/provider (2026-08-23) and gate_trace (2026-08-18) aren't in
// the generated Supabase types yet.
const anyDb = supabase as any;

const PAGE_SIZE = 100;

type DecisionRow = {
  id: string;
  decision: string;
  reasoning: string;
  confidence_score: number;
  escalated: boolean;
  source: string;
  agent_id: string | null;
  action_type: string | null;
  provider: string | null;
  created_at: string;
  gate_trace: TraceEntry[] | null;
};

type AgentOption = { id: string; name: string };

const OUTCOME_STYLE: Record<DecisionOutcome, string> = {
  block: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  modify: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  allow: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  deferred: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  approval_required: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  other: "text-zinc-400 border-white/15 bg-white/5",
};

// Kept in sync by hand with control-gate.ts's AGENT_DECISION_SOURCES --
// this is a filter dropdown, not a validator, so drift here only means a
// missing option, never a broken query.
const SOURCES = [
  "model", "human_override", "kill_switch", "ai_spend_cap",
  "agent_kill_switch", "agent_ai_spend_cap", "hard_rule", "circuit_breaker",
  "circuit_breaker_trip", "safety_scanner", "anomaly_detector", "gate_error",
  "external_api",
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * DECISION HISTORY — a searchable, filterable table across ALL decisions,
 * not just pending ones (ControlPendingDecisions) or the live stream
 * (ControlLiveFeed, realtime-only, no history). Reuses filterBySearch and
 * classifyDecisionOutcome as-is; source/escalated/agent_id/date-range
 * filter server-side via direct .eq()/.gte()/.lte() calls, since they're
 * already real columns.
 */
export default function ControlDecisionHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [escalatedFilter, setEscalatedFilter] = useState<"all" | "escalated">("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "Unknown agent" : "Chat");

  const toggleTrace = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
    let query = anyDb
      .from("agent_decisions")
      .select("id, decision, reasoning, confidence_score, escalated, source, agent_id, action_type, provider, created_at, gate_trace")
      .eq("user_id", accountId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (sourceFilter !== "all") query = query.eq("source", sourceFilter);
    if (escalatedFilter === "escalated") query = query.eq("escalated", true);
    if (agentFilter === "chat") query = query.is("agent_id", null);
    else if (agentFilter !== "all") query = query.eq("agent_id", agentFilter);

    const [{ data, error }, { data: agentRows }] = await Promise.all([
      query,
      supabase.from("agents").select("id, name").eq("user_id", accountId),
    ]);
    setLoading(false);
    if (error) {
      toast({ title: "Couldn't load decision history", description: error.message, variant: "destructive" });
      return;
    }
    const fetched = (data ?? []) as DecisionRow[];
    setHasMore(fetched.length > limit);
    setRows(fetched.slice(0, limit));
    setAgents((agentRows ?? []) as AgentOption[]);
  }, [accountId, sourceFilter, escalatedFilter, agentFilter, from, to, limit]);

  useEffect(() => { load(); }, [load]);
  // Any filter change (other than "load more" itself) starts back at one page.
  useEffect(() => { setLimit(PAGE_SIZE); }, [sourceFilter, escalatedFilter, agentFilter, from, to]);

  const visibleRows = filterBySearch(rows, search, ["decision", "reasoning", "source", "action_type", "provider"]);

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

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <HistoryIcon className="h-5 w-5 text-cyan-300" /> Decision history
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every decision in range, searchable and filterable — not just what's pending or live right now.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            To
            <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Source
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200">
              <option value="all">All sources</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Agent
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200">
              <option value="all">All agents</option>
              <option value="chat">Chat (no agent)</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Escalated
            <select value={escalatedFilter} onChange={(e) => setEscalatedFilter(e.target.value as "all" | "escalated")}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200">
              <option value="all">All</option>
              <option value="escalated">Escalated only</option>
            </select>
          </label>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search decision, reasoning, source, action type, or provider…"
          className="mt-3 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
        />

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : visibleRows.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            {rows.length === 0 ? "No decisions in range." : "No decisions match that search."}
          </p>
        ) : (
          <table className="mt-6 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Verdict</th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Reasoning</th>
                <th className="py-2 pr-3">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const outcome = classifyDecisionOutcome(row.decision);
                return (
                  <tr key={row.id} className="border-b border-white/5 align-top">
                    <td className="py-3 pr-3 font-mono text-[11px] text-zinc-500">
                      {new Date(row.created_at).toLocaleString()}
                      {row.source === "external_api" ? (
                        // Called out distinctly, same reasoning as
                        // correlated_breaker_trip in the compliance
                        // report -- this decision came from OUTSIDE the
                        // account's own agents via the public Control
                        // API, a materially different provenance than
                        // every other source in this table.
                        <div className="mt-0.5 inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
                          🌐 external api
                        </div>
                      ) : (
                        <div className="text-zinc-600">{row.source}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${OUTCOME_STYLE[outcome]}`}>
                        {outcome.replace("_", " ")}
                      </span>
                      {row.escalated && <div className="mt-1 font-mono text-[10px] uppercase text-amber-400">escalated</div>}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] text-cyan-300">{agentName(row.agent_id)}</td>
                    <td className="py-3 pr-3 text-zinc-300">
                      {row.reasoning}
                      {(row.action_type || row.provider) && (
                        <div className="mt-1 font-mono text-[10px] uppercase text-zinc-500">
                          {row.action_type}{row.action_type && row.provider ? " · " : ""}{row.provider}
                        </div>
                      )}
                      {row.gate_trace && row.gate_trace.length > 0 && (
                        <>
                          <button
                            onClick={() => toggleTrace(row.id)}
                            className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-500 hover:text-zinc-300"
                          >
                            {expanded.has(row.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            Why
                          </button>
                          {expanded.has(row.id) && <GateTraceList trace={row.gate_trace} />}
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] text-zinc-400">{row.confidence_score}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && hasMore && (
          <button
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            className="mt-4 rounded border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-300 hover:bg-white/10"
          >
            Load more
          </button>
        )}
      </main>
    </div>
  );
}
