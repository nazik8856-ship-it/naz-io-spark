import { useNavigate } from "react-router-dom";
import { Gauge, Power, Clock } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { useAgentSpendSafetyStatus } from "@/hooks/useAgentSpendSafetyStatus";

/**
 * Pillar 1 ("Your AI can't bankrupt you"), surfaced right on the agent's
 * own dashboard next to AgentHealthBadge -- previously this agent's spend/
 * breaker/kill-switch state only existed on the separate Control System
 * pages, so an owner looking at THEIR agent had no way to see it was near
 * its limit, or already stopped, without leaving this page.
 *
 * Task #46: this IS the "live Control-status widget" the agent's page was
 * missing -- extended (not duplicated) with the two live signals it didn't
 * carry yet: a platform-wide operator pause (checked first, same precedence
 * runControlGateInner itself holds to) and a real pending_approvals row
 * waiting on a human for this specific agent.
 */
export default function AgentSpendSafetyBadge({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const status = useAgentSpendSafetyStatus(accountId, agentId);

  if (status.loading) return null;

  const stopped = status.platformKillSwitchOn || status.agentKillSwitchOn || status.accountKillSwitchOn || status.trippedBreakerCount > 0;
  const near = !stopped && status.pct >= 80;

  const style = stopped
    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
    : near
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  const label = status.platformKillSwitchOn
    ? "Platform-wide pause is on"
    : status.accountKillSwitchOn
    ? "Account kill switch is on"
    : status.agentKillSwitchOn
    ? "This agent's kill switch is on"
    : status.trippedBreakerCount > 0
    ? `${status.trippedBreakerCount} breaker${status.trippedBreakerCount === 1 ? "" : "s"} tripped`
    : `$${status.spentToday.toFixed(2)} / $${status.cap.toFixed(2)} today`;

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={() => navigate("/control-system/spend-safety")}
        title="Spend cap, circuit breakers and kill switch for this agent — click to manage"
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:opacity-80 ${style}`}
      >
        {stopped ? <Power className="h-3.5 w-3.5" /> : <Gauge className="h-3.5 w-3.5" />}
        {label}
      </button>
      {status.pendingApprovalCount > 0 && (
        <button
          onClick={() => navigate("/control-system/approvals")}
          title="Actions from this agent waiting on a human approval — click to review"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs font-semibold text-amber-300 transition-colors hover:opacity-80"
        >
          <Clock className="h-3.5 w-3.5" />
          {status.pendingApprovalCount} awaiting approval
        </button>
      )}
    </div>
  );
}
