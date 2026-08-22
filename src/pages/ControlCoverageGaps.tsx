import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { findCoverageGaps, type CapabilityForCoverage, type HardRuleForCoverage } from "@/lib/coverage-gaps";
import { classifyAnomalyCoverage, topAgentlessActionTypes, type AgentlessActionType, type CoverageSeverity } from "@/lib/anomaly-coverage";

type AgentOption = { id: string; name: string };

const ANOMALY_WINDOW_DAYS = 30;

const SEVERITY_STYLE: Record<CoverageSeverity, string> = {
  none: "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-300",
  low: "border-white/15 bg-white/5 text-zinc-300",
  moderate: "border-amber-500/30 bg-amber-500/[0.04] text-amber-300",
  high: "border-rose-500/30 bg-rose-500/[0.04] text-rose-300",
};

/**
 * COVERAGE GAPS — which real, connectable action kinds currently have NO
 * live hard rule matching them at all. If something goes wrong with one of
 * these, only the safety scanner + anomaly detector + model judgement
 * stand between it and running — nothing explicit governs it specifically.
 */
export default function ControlCoverageGaps() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [gaps, setGaps] = useState<CapabilityForCoverage[]>([]);
  const [totalReal, setTotalReal] = useState(0);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [scopeAgentId, setScopeAgentId] = useState("");
  const [anomalyTotal, setAnomalyTotal] = useState(0);
  const [anomalyAgentless, setAnomalyAgentless] = useState(0);
  const [anomalyBreakdown, setAnomalyBreakdown] = useState<AgentlessActionType[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const since = new Date(Date.now() - ANOMALY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: sess } = await supabase.auth.getSession();
    const [statusRes, rulesRes, { data: agentRows }, totalRes, agentlessRes, breakdownRes] = await Promise.all([
      supabase.functions.invoke("capability-status", { body: {} }),
      anyDb.from("hard_rules").select("action_type_pattern, provider, enabled, shadow_mode, agent_id").eq("user_id", user.id),
      anyDb.from("agents").select("id, name").eq("user_id", user.id).order("name"),
      // Anomaly-detector coverage: what fraction of recent decisions had no
      // agentId at all, so the per-agent baseline check was skipped for them
      // entirely (a documented, deliberate skip in control-gate.ts, not a
      // bug -- this just answers whether it's a SIZED gap or not, live).
      anyDb.from("agent_decisions").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since),
      anyDb.from("agent_decisions").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since).is("agent_id", null),
      anyDb.from("agent_decisions").select("action_type, provider").eq("user_id", user.id).gte("created_at", since).is("agent_id", null).limit(500),
    ]);
    void sess;

    if (statusRes.error || rulesRes.error) {
      toast({
        title: "Couldn't load coverage",
        description: statusRes.error?.message || rulesRes.error?.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const capabilities = ((statusRes.data?.capabilities ?? []) as { kind: string; provider: string; status: string }[])
      .filter((c) => c.status === "real")
      .map((c) => ({ kind: c.kind, provider: c.provider }));
    const hardRules = (rulesRes.data ?? []) as HardRuleForCoverage[];

    setAgents((agentRows ?? []) as AgentOption[]);
    setTotalReal(capabilities.length);
    // Account-wide by default (scopeAgentId === "" -> agentId undefined,
    // unchanged legacy pooled-rules behavior). Picking an agent switches to
    // the stricter, agent-accurate view -- a gap that's hidden account-wide
    // because SOME agent has a rule for it can still be a real gap for a
    // DIFFERENT agent that has no rule of its own and no account-wide
    // default covering it either.
    setGaps(findCoverageGaps(capabilities, hardRules, scopeAgentId ? scopeAgentId : undefined));

    setAnomalyTotal(totalRes.count ?? 0);
    setAnomalyAgentless(agentlessRes.count ?? 0);
    setAnomalyBreakdown(topAgentlessActionTypes((breakdownRes.data ?? []) as { action_type: string | null; provider: string | null }[]));

    setLoading(false);
  }, [user, scopeAgentId]);

  useEffect(() => { load(); }, [load]);

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

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldOff className="h-5 w-5 text-amber-400" /> Coverage gaps
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Real, connected action kinds with no live hard rule covering them — a blind spot, not necessarily a
          problem. The safety scanner and anomaly detector still apply everywhere.
        </p>

        {agents.length > 0 && (
          <div className="mt-4">
            <select
              value={scopeAgentId}
              onChange={(e) => setScopeAgentId(e.target.value)}
              aria-label="Coverage scope"
              className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
            >
              <option value="">Account-wide (any rule counts)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name} (this agent's rules only)</option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : (
          <>
            <div className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Coverage</div>
              <div className="mt-1 text-2xl font-semibold">
                {totalReal - gaps.length} / {totalReal}
                <span className="ml-2 text-sm font-normal text-zinc-500">action kinds have at least one rule</span>
              </div>
            </div>

            {gaps.length === 0 ? (
              <p className="mt-6 rounded border border-emerald-500/30 bg-emerald-500/[0.04] p-4 text-sm text-emerald-300">
                No gaps — every connected, real action kind has at least one hard rule covering it.
              </p>
            ) : (
              <ul className="mt-6 space-y-2">
                {gaps.map((g) => (
                  <li key={`${g.kind}-${g.provider}`} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/[0.04] p-3 text-sm">
                    <span className="font-mono text-amber-300">{g.kind}</span>
                    <span className="text-zinc-500">· {g.provider}</span>
                    <button
                      onClick={() => navigate("/control-system")}
                      className="ml-auto rounded border border-white/15 px-2 py-1 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10"
                    >
                      Add a hard rule
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(() => {
              const { pct, severity } = classifyAnomalyCoverage(anomalyTotal, anomalyAgentless);
              return (
                <div className="mt-8">
                  <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Anomaly detector coverage</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    The behavioral-baseline anomaly detector only runs for actions tied to a specific agent —
                    a one-off, agent-less action has no history to baseline against, so it's skipped by design.
                    This shows whether that's actually a sized gap, over the last {ANOMALY_WINDOW_DAYS} days.
                  </p>
                  <div className={`mt-3 rounded border p-4 text-sm ${SEVERITY_STYLE[severity]}`}>
                    {anomalyTotal === 0 ? (
                      "No decisions in range."
                    ) : (
                      <>
                        <span className="text-lg font-semibold">{pct}%</span> of decisions ({anomalyAgentless} of{" "}
                        {anomalyTotal}) had no agent tied to them, so the anomaly detector never ran for them.
                      </>
                    )}
                  </div>
                  {severity !== "none" && anomalyBreakdown.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {anomalyBreakdown.map((b) => (
                        <li key={`${b.action_type}-${b.provider}`} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-zinc-300">
                          <span className="font-mono">{b.action_type}</span>
                          {b.provider && <span className="text-zinc-500">· {b.provider}</span>}
                          <span className="ml-auto font-mono text-zinc-500">{b.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </main>
    </div>
  );
}
