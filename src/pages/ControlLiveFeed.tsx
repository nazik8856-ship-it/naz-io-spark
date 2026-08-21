import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Radio, Pause, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { classifyDecisionOutcome, type DecisionOutcome } from "@/lib/roi-report";

const MAX_ROWS = 200;

type DecisionRow = {
  id: string;
  decision: string;
  reasoning: string;
  source: string;
  escalated: boolean;
  confidence_score: number;
  agent_id: string | null;
  created_at: string;
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
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "Unknown agent" : "Chat");

  const loadRecent = useCallback(async () => {
    if (!accountId) return;
    const [{ data }, { data: agentRows }] = await Promise.all([
      supabase
        .from("agent_decisions")
        .select("id, decision, reasoning, source, escalated, confidence_score, agent_id, created_at")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("agents").select("id, name").eq("user_id", accountId),
    ]);
    setRows((data ?? []) as DecisionRow[]);
    setAgents((agentRows ?? []) as AgentOption[]);
  }, [accountId]);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`live-decisions-${accountId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_decisions", filter: `user_id=eq.${accountId}` },
        (payload) => {
          if (pausedRef.current) return;
          setRows((prev) => [payload.new as DecisionRow, ...prev].slice(0, MAX_ROWS));
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => { void supabase.removeChannel(channel); };
  }, [accountId]);

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
            <Radio className={`h-5 w-5 ${connected ? "text-emerald-400" : "text-zinc-500"}`} /> Live decision feed
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
          Decisions as they happen, streamed live. {connected ? "Connected." : "Connecting…"}
          {paused && " Paused — new decisions aren't appearing until you resume."}
        </p>

        <ul className="mt-6 space-y-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
              Nothing yet.
            </p>
          ) : rows.map((r) => {
            const outcome = classifyDecisionOutcome(r.decision);
            return (
              <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${OUTCOME_STYLE[outcome]}`}>{outcome.replace("_", " ")}</span>
                  <span className="font-mono text-xs text-zinc-300">{r.decision}</span>
                  <span className="ml-auto text-[11px] text-zinc-500">{new Date(r.created_at).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{r.reasoning}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-zinc-500">
                  <span className="text-cyan-400">{agentName(r.agent_id)}</span>
                  <span>· {r.source}</span>
                  <span>· confidence {r.confidence_score}</span>
                  {r.escalated && <span className="text-amber-300">· escalated</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
