import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Gauge, ZapOff, Power } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { useSpendSafetyStatus } from "@/hooks/useSpendSafetyStatus";
import SpendCapPanel from "@/components/control/SpendCapPanel";
import CircuitBreakerPanel from "@/components/control/CircuitBreakerPanel";
import KillSwitchPanel from "@/components/control/KillSwitchPanel";

type Stat = { icon: typeof Gauge; label: string; value: string; sub?: string; tone: "ok" | "warn" | "bad" };

function StatCard({ stat }: { stat: Stat }) {
  const Icon = stat.icon;
  const toneClass =
    stat.tone === "bad" ? "border-rose-500/40 bg-rose-500/[0.06]" :
    stat.tone === "warn" ? "border-amber-500/40 bg-amber-500/[0.06]" :
    "border-emerald-500/30 bg-emerald-500/[0.04]";
  const iconTone = stat.tone === "bad" ? "text-rose-400" : stat.tone === "warn" ? "text-amber-400" : "text-emerald-400";
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <Icon className={`h-3.5 w-3.5 ${iconTone}`} />
        {stat.label}
      </div>
      <div className="mt-1.5 text-xl font-semibold text-white">{stat.value}</div>
      {stat.sub && <div className="mt-1 text-xs text-zinc-500">{stat.sub}</div>}
    </div>
  );
}

/**
 * PILLAR 1 — "Your AI can't bankrupt you."
 * Consolidates the daily spend cap, circuit breakers and kill switch --
 * previously three unlabeled panels stacked above the Control System's
 * chat with no explanation of why any of them exist -- into one page with
 * a plain-language purpose and a live at-a-glance status tile.
 */
export default function ControlSpendSafety() {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const status = useSpendSafetyStatus(accountId);

  const spendTone: Stat["tone"] = status.pct >= 100 ? "bad" : status.pct >= 80 ? "warn" : "ok";

  const stats: Stat[] = [
    {
      icon: Gauge,
      label: "Today's AI spend",
      value: `$${status.spentToday.toFixed(2)} / $${status.cap.toFixed(2)}`,
      sub: status.capIsCustom ? `${Math.round(status.pct)}% of your daily cap` : "Using the built-in $5/day default — not set on purpose",
      tone: spendTone,
    },
    {
      icon: ZapOff,
      label: "Circuit breakers",
      value: status.trippedBreakerCount === 0 ? "All clear" : `${status.trippedBreakerCount} tripped`,
      sub: status.trippedBreakerCount === 0 ? "No action type is currently paused" : "One or more action types are paused until reset",
      tone: status.trippedBreakerCount === 0 ? "ok" : "bad",
    },
    {
      icon: Power,
      label: "Kill switch",
      value: status.killSwitchOn ? "ACTIVE" : "Off",
      sub: status.killSwitchOn ? "Every AI action on this account is blocked right now" : "AI actions run normally",
      tone: status.killSwitchOn ? "bad" : "ok",
    },
  ];

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Back to AI Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-mono uppercase tracking-wider">Back</span>
        </button>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            Your AI can't bankrupt you
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            A daily spend limit bounds how much your AI can cost you before it stops on its own. Circuit breakers pause
            a specific action type automatically when it starts failing. The kill switch is a manual, instant stop for
            everything, whenever you need it. Together, this is the ceiling on how bad a mistake can get.
          </p>
        </div>

        {!status.loading && !status.capIsCustom && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3">
            <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="text-sm text-amber-100">
              <p className="font-medium">You haven't set a spend limit yet.</p>
              <p className="mt-0.5 text-amber-200/80">
                A silent $5.00/day default is applying right now. Most businesses want a number they actually chose —
                set one below.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map((s) => <StatCard key={s.label} stat={s} />)}
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Daily spend limit</h2>
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <SpendCapPanel />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Circuit breakers</h2>
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <CircuitBreakerPanel />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Kill switch</h2>
            <KillSwitchPanel />
          </section>
        </div>
      </main>
    </div>
  );
}
