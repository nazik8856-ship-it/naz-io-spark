import { useNavigate } from "react-router-dom";
import { Gauge, Power } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { useAgentSpendSafetyStatus } from "@/hooks/useAgentSpendSafetyStatus";

/**
 * Pillar 1 ("Your AI can't bankrupt you"), surfaced right on the agent's
 * own dashboard next to AgentHealthBadge -- previously this agent's spend/
 * breaker/kill-switch state only existed on the separate Control System
 * pages, so an owner looking at THEIR agent had no way to see it was near
 * its limit, or already stopped, without leaving this page.
 */
export default function AgentSpendSafetyBadge({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const status = useAgentSpendSafetyStatus(accountId, agentId);

  if (status.loading) return null;

  const stopped = status.agentKillSwitchOn || status.accountKillSwitchOn || status.trippedBreakerCount > 0;
  const near = !stopped && status.pct >= 80;

  const style = stopped
    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
    : near
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  const label = status.accountKillSwitchOn
    ? "Account kill switch is on"
    : status.agentKillSwitchOn
    ? "This agent's kill switch is on"
    : status.trippedBreakerCount > 0
    ? `${status.trippedBreakerCount} breaker${status.trippedBreakerCount === 1 ? "" : "s"} tripped`
    : `$${status.spentToday.toFixed(2)} / $${status.cap.toFixed(2)} today`;

  return (
    <button
      onClick={() => navigate("/control-system/spend-safety")}
      title="Spend cap, circuit breakers and kill switch for this agent — click to manage"
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80 ${style}`}
    >
      {stopped ? <Power className="h-3.5 w-3.5" /> : <Gauge className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
