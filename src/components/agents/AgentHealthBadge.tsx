import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { computeAgentHealth, type RiskLabel } from "@/lib/agent-health";

const WINDOW_DAYS = 30;

const RISK_STYLE: Record<RiskLabel, string> = {
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  high: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  insufficient_data: "border-white/15 bg-white/5 text-zinc-400",
};

const RISK_LABEL: Record<RiskLabel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
  insufficient_data: "No history yet",
};

/**
 * Per-agent health/risk score — rolling anomaly hits + breaker trips +
 * approval-rejection rate over the last 30 days, computed from the same
 * agent_decisions / pending_approvals rows the control gate already writes.
 */
export default function AgentHealthBadge({ agentId }: { agentId: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<{ score: number; risk: RiskLabel } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    (async () => {
      const [{ data: decisions }, { data: approvals }] = await Promise.all([
        supabase
          .from("agent_decisions")
          .select("source")
          .eq("user_id", user.id)
          .eq("agent_id", agentId)
          .gte("created_at", since)
          .in("source", ["anomaly_detector", "circuit_breaker_trip"]),
        supabase
          .from("pending_approvals")
          .select("status")
          .eq("user_id", user.id)
          .eq("agent_id", agentId)
          .gte("created_at", since)
          .in("status", ["approved", "rejected"]),
      ]);
      if (cancelled) return;

      const decisionRows = (decisions ?? []) as { source: string }[];
      const approvalRows = (approvals ?? []) as { status: string }[];
      const health = computeAgentHealth({
        anomalyHits: decisionRows.filter((d) => d.source === "anomaly_detector").length,
        breakerTrips: decisionRows.filter((d) => d.source === "circuit_breaker_trip").length,
        totalApprovals: approvalRows.length,
        rejectedApprovals: approvalRows.filter((a) => a.status === "rejected").length,
      });
      setState(health);
    })();

    return () => { cancelled = true; };
  }, [agentId, user]);

  if (!state) return null;

  return (
    <div
      title={`Health score over the last ${WINDOW_DAYS} days`}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold ${RISK_STYLE[state.risk]}`}
    >
      <Activity className="h-3.5 w-3.5" />
      {state.risk === "insufficient_data" ? RISK_LABEL.insufficient_data : `${state.score} · ${RISK_LABEL[state.risk]}`}
    </div>
  );
}
