import { useNavigate } from "react-router-dom";
import { ShieldCheck, ChevronRight } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { useSpendSafetyStatus } from "@/hooks/useSpendSafetyStatus";

/**
 * Compact entry point for Pillar 1 ("Your AI can't bankrupt you") --
 * replaces the old flat stack of always-expanded SpendCapPanel /
 * CircuitBreakerPanel / KillSwitchPanel on the main Control System page.
 * A one-line live status plus a single link to the full page, which is
 * where those three panels now live together with an explanation of why
 * they exist.
 */
export default function SpendSafetyStatusBadge() {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const status = useSpendSafetyStatus(accountId);

  const worst = status.killSwitchOn
    ? { text: "Kill switch is ON — every AI action is blocked", color: "#ef4444" }
    : status.trippedBreakerCount > 0
    ? { text: `${status.trippedBreakerCount} circuit breaker${status.trippedBreakerCount === 1 ? "" : "s"} tripped`, color: "#ef4444" }
    : status.pct >= 80
    ? { text: `${Math.round(status.pct)}% of today's spend cap used`, color: "#f59e0b" }
    : { text: `$${status.spentToday.toFixed(2)} / $${status.cap.toFixed(2)} spent today, all clear`, color: "#22c55e" };

  return (
    <button
      onClick={() => navigate("/control-system/spend-safety")}
      className="w-full flex items-center gap-3 border-b border-white/5 px-6 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
    >
      <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: worst.color }} />
      <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Your AI can't bankrupt you</span>
      <span className="text-xs" style={{ color: worst.color }}>
        {status.loading ? "Loading…" : worst.text}
      </span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 text-zinc-600" />
    </button>
  );
}
