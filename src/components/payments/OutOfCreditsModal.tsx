import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Crown, Sparkles, Zap, AlertCircle, Check } from "lucide-react";
import { TIER_PLANS, formatCredits, TierId } from "@/lib/credit-tiers";
import { openPaymentWindow } from "@/lib/credit-packs";

/**
 * Global "Out of Credits" modal.
 * Listens for `nazai:out-of-credits` events. Show all 3 tiers
 * (Explorer / Operator / Titan) with upgrade CTAs that fire PaymentWindow.
 */
export default function OutOfCreditsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("nazai:out-of-credits", onOpen);
    return () => window.removeEventListener("nazai:out-of-credits", onOpen);
  }, []);

  const upgrade = (id: Exclude<TierId, "enterprise" | "explorer">) => {
    const t = TIER_PLANS[id];
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

  const tiers: TierId[] = ["explorer", "operator", "titan"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-3xl border-white/10 p-0 overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, rgba(249,115,22,0.10), transparent 55%), radial-gradient(120% 80% at 100% 100%, rgba(168,139,250,0.10), transparent 55%), rgba(8,10,16,0.96)",
          backdropFilter: "blur(24px)",
        }}
      >
        <div className="px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-orange-300/80 mb-1">
            <AlertCircle size={12} /> Mission halted
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">Out of Credits</h2>
          <p className="text-[12.5px] text-white/55 mt-1">
            Pick a plan that matches your build velocity — upgrade instantly, no setup.
          </p>
        </div>

        <div className="p-6 grid sm:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto">
          {tiers.map((id) => {
            const t = TIER_PLANS[id];
            const isExplorer = id === "explorer";
            const isOperator = id === "operator";
            const isTitan = id === "titan";
            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border p-5 flex flex-col"
                style={{
                  background: isOperator
                    ? "linear-gradient(160deg, rgba(6,182,212,0.10), rgba(6,182,212,0.02))"
                    : isTitan
                      ? "linear-gradient(160deg, rgba(245,196,81,0.08), rgba(168,85,247,0.04))"
                      : "rgba(255,255,255,0.025)",
                  borderColor: isOperator
                    ? "rgba(6,182,212,0.5)"
                    : isTitan
                      ? "rgba(245,196,81,0.4)"
                      : "rgba(255,255,255,0.08)",
                  boxShadow: isOperator
                    ? "0 0 24px rgba(6,182,212,0.18)"
                    : isTitan
                      ? "0 0 24px rgba(245,196,81,0.14)"
                      : "none",
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  {isTitan && <Crown size={13} className="text-[#f5c451]" />}
                  {isOperator && <Sparkles size={13} className="text-cyan-300" />}
                  {isExplorer && <Zap size={13} className="text-white/60" />}
                  <span className="text-[14px] font-black tracking-tight text-white">{t.name}</span>
                  {isOperator && (
                    <span className="ml-auto text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                      Most popular
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-baseline gap-1.5">
                  {t.monthlyPrice === 0 ? (
                    <span className="text-2xl font-black text-white">Free</span>
                  ) : (
                    <>
                      <span className="text-2xl font-black tabular-nums text-white">${t.monthlyPrice}</span>
                      <span className="text-[10px] text-white/45 font-mono uppercase">/mo</span>
                    </>
                  )}
                </div>
                <div className="mt-1 text-[11px] font-mono uppercase tracking-wider text-white/50">
                  {formatCredits(t.monthlyCredits)} credits / month
                </div>

                {isExplorer ? (
                  <p className="mt-4 text-[12px] text-white/65 leading-relaxed flex-1">
                    You've run out of credits. Wait for daily/monthly recovery or upgrade your plan.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-1.5 text-[11.5px] text-white/65 flex-1">
                    <li className="flex items-start gap-1.5">
                      <Check size={11} className="mt-0.5 text-emerald-400 shrink-0" />
                      {formatCredits(t.monthlyCredits)} monthly credits
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Check size={11} className="mt-0.5 text-emerald-400 shrink-0" />
                      {t.overageRate}
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Check size={11} className="mt-0.5 text-emerald-400 shrink-0" />
                      {isTitan ? "Priority models · advanced agents" : "All NazAI visual themes"}
                    </li>
                  </ul>
                )}

                {isExplorer ? (
                  <button
                    onClick={() => setOpen(false)}
                    className="mt-5 w-full py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border border-white/10 text-white/70 hover:bg-white/5 transition"
                  >
                    Wait for recovery
                  </button>
                ) : (
                  <button
                    onClick={() => upgrade(id as "operator" | "titan")}
                    className="mt-5 w-full py-3 rounded-lg text-[12px] font-black uppercase tracking-[0.06em] transition-all"
                    style={{
                      background: isTitan
                        ? "linear-gradient(135deg, #f5c451, #d97706)"
                        : "linear-gradient(135deg, #06b6d4, #0891b2)",
                      color: "#020617",
                      boxShadow: isTitan
                        ? "0 8px 28px rgba(245,196,81,0.30)"
                        : "0 8px 28px rgba(6,182,212,0.30)",
                    }}
                  >
                    Upgrade Now
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>

        <div className="px-6 pb-5 text-[10px] text-white/35 text-center">
          Need something custom? Enterprise plans include dedicated support and SLA.
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const triggerOutOfCredits = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("nazai:out-of-credits"));
};
