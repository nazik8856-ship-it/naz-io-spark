import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Plus, Check, Crown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { TIER_PLANS, TIER_ORDER, formatCredits, TierId } from "@/lib/credit-tiers";
import { useToast } from "@/hooks/use-toast";

/**
 * CreditBalance — compact navbar widget that shows "used / limit credits"
 * with a "Buy Credits" affordance. Stays in sync across sessions via the
 * useCredits hook (Supabase Realtime).
 */
export default function CreditBalance({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { credits, used, monthlyLimit, plan, tier, upgradeTier } = useCredits(user?.id);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  if (!user) return null;

  const isCustom = plan.isCustom;
  const usedDisplay = used == null ? "—" : formatCredits(used);
  const limitDisplay = isCustom ? "Custom" : formatCredits(monthlyLimit);
  const remaining = credits ?? 0;
  const pct = isCustom || monthlyLimit === 0 ? 100 : Math.max(0, Math.min(100, (remaining / monthlyLimit) * 100));
  const low = !isCustom && pct < 15;

  const accent = low ? "#f97316" : "#06b6d4";

  const handleSelectTier = (next: TierId) => {
    upgradeTier(next);
    toast({
      title: `Switched to ${TIER_PLANS[next].name}`,
      description: TIER_PLANS[next].isCustom
        ? "We'll reach out about Enterprise onboarding."
        : `${formatCredits(TIER_PLANS[next].monthlyCredits)} credits / month available.`,
    });
    setOpen(false);
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="group inline-flex items-center gap-2 rounded-full border transition-all"
        style={{
          padding: compact ? "4px 10px" : "5px 12px",
          background: "rgba(255,255,255,0.04)",
          borderColor: low ? `${accent}66` : "rgba(255,255,255,0.10)",
          boxShadow: low ? `0 0 14px ${accent}33` : "none",
        }}
        title={`${usedDisplay} of ${limitDisplay} credits used this period · click to manage`}
      >
        <Zap size={compact ? 11 : 12} style={{ color: accent }} />
        <span className="text-[11px] font-mono tabular-nums text-white/80">
          {usedDisplay}
          <span className="text-white/35"> / </span>
          <span className="text-white/55">{limitDisplay}</span>
        </span>
        {!compact && (
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-white/40 group-hover:text-white/70 transition-colors">
            credits
          </span>
        )}
        <span
          className="hidden sm:inline-flex items-center gap-1 ml-1 pl-2 border-l border-white/10 text-[10px] font-mono uppercase tracking-wider"
          style={{ color: accent }}
        >
          <Plus size={9} /> Buy
        </span>
      </motion.button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl border-white/10"
          style={{
            background: "rgba(8,10,16,0.96)",
            backdropFilter: "blur(20px)",
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">
              Manage credits & plan
            </DialogTitle>
            <DialogDescription className="text-white/55">
              You're on the <span className="text-white/85 font-semibold">{plan.name}</span> tier — {usedDisplay} of {limitDisplay} credits used this period.
            </DialogDescription>
          </DialogHeader>

          {/* Usage bar */}
          {!isCustom && (
            <div className="mb-2">
              <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${100 - pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{
                    background: low
                      ? "linear-gradient(90deg, #f97316, #fb923c)"
                      : "linear-gradient(90deg, #06b6d4, #22d3ee)",
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] font-mono uppercase tracking-wider text-white/40">
                <span>{formatCredits(remaining)} remaining</span>
                <span>{plan.overageRate}</span>
              </div>
            </div>
          )}

          {/* Tier grid */}
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            {TIER_ORDER.map((id) => {
              const t = TIER_PLANS[id];
              const isCurrent = tier === id;
              return (
                <button
                  key={id}
                  onClick={() => handleSelectTier(id)}
                  disabled={isCurrent}
                  className="text-left p-3.5 rounded-xl border transition-all disabled:cursor-default"
                  style={{
                    background: isCurrent
                      ? "linear-gradient(135deg, rgba(6,182,212,0.10), rgba(6,182,212,0.02))"
                      : "rgba(255,255,255,0.025)",
                    borderColor: isCurrent ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.08)",
                    boxShadow: isCurrent ? "0 0 18px rgba(6,182,212,0.25)" : "none",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {t.id === "titan" && <Crown size={12} className="text-[#f5c451]" />}
                    <span className="text-[13px] font-bold tracking-tight">{t.name}</span>
                    {isCurrent && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#06b6d4]">
                        <Check size={9} /> Current
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-white/55 mb-2">
                    {t.isCustom
                      ? "Custom credits + dedicated support"
                      : `${formatCredits(t.monthlyCredits)} credits / month`}
                  </div>
                  <div className="text-[11px] font-mono text-white/70">
                    {t.isCustom
                      ? "Talk to sales"
                      : t.monthlyPrice === 0
                        ? "Free forever"
                        : `$${t.monthlyPrice}/mo · $${t.annualPrice}/mo annually`}
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-white/30 text-center mt-3">
            Stub purchase modal — billing integration coming soon.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
