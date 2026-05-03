import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Plus, Check, Crown, Sparkles, Flame } from "lucide-react";
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
import { CREDIT_PACKS, openPaymentWindow, totalCredits } from "@/lib/credit-packs";
import { useToast } from "@/hooks/use-toast";

type Tab = "packs" | "plans";

/**
 * CreditBalance — navbar widget. Click opens the Add Credits panel with two
 * tabs (Buy Credit Packs / Upgrade Plan). All purchase buttons fire the
 * global PaymentWindow via `openPaymentWindow`.
 */
export default function CreditBalance({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { credits, used, monthlyLimit, plan, tier } = useCredits(user?.id);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("packs");
  const { toast } = useToast();

  if (!user) return null;

  const isCustom = plan.isCustom;
  const usedDisplay = used == null ? "—" : formatCredits(used);
  const limitDisplay = isCustom ? "Custom" : formatCredits(monthlyLimit);
  const remaining = credits ?? 0;
  const pct = isCustom || monthlyLimit === 0 ? 100 : Math.max(0, Math.min(100, (remaining / monthlyLimit) * 100));
  const low = !isCustom && pct < 15;
  const accent = low ? "#f97316" : "#06b6d4";

  const handleBuyPack = (packId: string) => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    setOpen(false);
    setTimeout(() => openPaymentWindow({ kind: "pack", pack }), 180);
  };

  const handleSelectTier = (id: TierId) => {
    const t = TIER_PLANS[id];
    if (id === tier) return;
    if (t.isCustom) {
      toast({ title: "Talk to sales", description: "Our team will reach out about Enterprise onboarding." });
      return;
    }
    if (t.monthlyPrice === 0) {
      // Free — instant switch, no payment.
      window.dispatchEvent(new CustomEvent("nazai:tier-changed", { detail: id }));
      localStorage.setItem("nazai:user-tier", id);
      toast({ title: `Switched to ${t.name}`, description: `${formatCredits(t.monthlyCredits)} credits / month available.` });
      return;
    }
    setOpen(false);
    setTimeout(
      () =>
        openPaymentWindow({
          kind: "plan",
          tierId: id,
          name: t.name,
          price: t.monthlyPrice,
        }),
      180,
    );
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
        title={`${formatCredits(remaining)} credits remaining · click to add credits`}
      >
        <Zap size={compact ? 11 : 12} style={{ color: accent }} />
        <span className="text-[11px] font-mono tabular-nums text-white/85">
          {formatCredits(remaining)}
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
          <Plus size={9} /> Add
        </span>
      </motion.button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl border-white/10 p-0 overflow-hidden"
          style={{
            background:
              "radial-gradient(120% 80% at 0% 0%, rgba(6,182,212,0.10), transparent 55%), rgba(8,10,16,0.96)",
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-white/5">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tight">
                Add Credits
              </DialogTitle>
              <DialogDescription className="text-white/55">
                Current balance: <span className="text-white/90 font-bold tabular-nums">{formatCredits(remaining)}</span>{" "}
                credits — on the <span className="text-white/85 font-semibold">{plan.name}</span> tier
                {!isCustom && (
                  <> ({usedDisplay} of {limitDisplay} used this period)</>
                )}.
              </DialogDescription>
            </DialogHeader>

            {/* Usage bar */}
            {!isCustom && (
              <div className="mt-3">
                <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{
                      background: low
                        ? "linear-gradient(90deg, #f97316, #fb923c)"
                        : "linear-gradient(90deg, #06b6d4, #22d3ee)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Tab toggle */}
            <div className="mt-4 inline-flex items-center p-1 rounded-full border border-white/10 bg-white/[0.03]">
              {(["packs", "plans"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="relative px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors"
                  style={{ color: tab === t ? "#020617" : "rgba(255,255,255,0.55)" }}
                >
                  {tab === t && (
                    <motion.div
                      layoutId="add-credits-tab"
                      className="absolute inset-0 rounded-full"
                      style={{ background: "linear-gradient(135deg, #06b6d4, #22d3ee)" }}
                      transition={{ type: "spring", damping: 25, stiffness: 400 }}
                    />
                  )}
                  <span className="relative">{t === "packs" ? "Buy Credit Packs" : "Upgrade Plan"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="p-6 max-h-[65vh] overflow-y-auto">
            <AnimatePresence mode="wait">
              {tab === "packs" ? (
                <motion.div
                  key="packs"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="grid sm:grid-cols-2 gap-3"
                >
                  {CREDIT_PACKS.map((pack) => {
                    const onSale = pack.salePrice < pack.price;
                    return (
                      <button
                        key={pack.id}
                        onClick={() => handleBuyPack(pack.id)}
                        className="text-left p-4 rounded-xl border transition-all hover:scale-[1.01] relative overflow-hidden group"
                        style={{
                          background: pack.popular
                            ? "linear-gradient(135deg, rgba(6,182,212,0.10), rgba(6,182,212,0.02))"
                            : "rgba(255,255,255,0.025)",
                          borderColor: pack.popular ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.08)",
                          boxShadow: pack.popular ? "0 0 22px rgba(6,182,212,0.18)" : "none",
                        }}
                      >
                        {pack.popular && (
                          <span className="absolute top-2 right-2 text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                            <Sparkles size={8} className="inline mr-0.5" /> Popular
                          </span>
                        )}
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-black tabular-nums">{formatCredits(pack.credits)}</span>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-white/45">credits</span>
                        </div>
                        {pack.bonus > 0 && (
                          <div className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                            <Flame size={9} /> +{formatCredits(pack.bonus)} bonus
                          </div>
                        )}
                        <div className="mt-3 flex items-baseline gap-2">
                          <span className="text-lg font-black tabular-nums">${pack.salePrice.toFixed(2)}</span>
                          {onSale && (
                            <span className="text-[11px] text-white/35 line-through font-mono">
                              ${pack.price.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {onSale && (
                          <div className="mt-1 text-[9px] font-mono uppercase tracking-wider text-[#f5c451]">
                            Sale ends Jul 21, 2026
                          </div>
                        )}
                        <div
                          className="mt-3 inline-flex items-center justify-center w-full py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all"
                          style={{
                            background: pack.popular
                              ? "linear-gradient(135deg, #06b6d4, #0891b2)"
                              : "rgba(255,255,255,0.08)",
                            color: pack.popular ? "#020617" : "white",
                          }}
                        >
                          Buy now
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.div
                  key="plans"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="grid sm:grid-cols-2 gap-3"
                >
                  {TIER_ORDER.map((id) => {
                    const t = TIER_PLANS[id];
                    const isCurrent = tier === id;
                    return (
                      <button
                        key={id}
                        onClick={() => handleSelectTier(id)}
                        disabled={isCurrent}
                        className="text-left p-4 rounded-xl border transition-all disabled:cursor-default"
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
                          <span className="text-[14px] font-black tracking-tight">{t.name}</span>
                          {isCurrent && (
                            <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#06b6d4]">
                              <Check size={9} /> Current
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/55 mb-3">
                          {t.isCustom
                            ? "Custom credits + dedicated support"
                            : `${formatCredits(t.monthlyCredits)} credits / month`}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          {t.isCustom ? (
                            <span className="text-base font-black">Talk to sales</span>
                          ) : t.monthlyPrice === 0 ? (
                            <span className="text-base font-black">Free</span>
                          ) : (
                            <>
                              <span className="text-lg font-black tabular-nums">${t.monthlyPrice}</span>
                              <span className="text-[10px] text-white/45 font-mono uppercase">/mo</span>
                            </>
                          )}
                        </div>
                        {!isCurrent && (
                          <div
                            className="mt-3 inline-flex items-center justify-center w-full py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider"
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              color: "white",
                            }}
                          >
                            {t.isCustom ? "Contact sales" : t.monthlyPrice === 0 ? "Switch" : `Upgrade to ${t.name}`}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            <p className="text-[10px] text-white/30 text-center mt-4">
              Switching between Packs and Plans is free — you only pay when you confirm in checkout.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
