import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Check, Lock, ShieldCheck, CreditCard, Sparkles, Tag, Loader2, X } from "lucide-react";
import { CreditPack, PaymentIntent, totalCredits } from "@/lib/credit-packs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { TIER_PLANS, TierId, setStoredTier, formatCredits } from "@/lib/credit-tiers";
import { useToast } from "@/hooks/use-toast";

type Method = "paypal" | "card";
type Phase = "form" | "processing" | "success";

const PROMOS: Record<string, number> = {
  NAZAI10: 0.10,
  LAUNCH20: 0.20,
  TITAN15: 0.15,
};

/**
 * PaymentWindow — global modal listening for `nazai:open-payment` events.
 * Mock checkout: simulates processing, then credits the user via the
 * `add_credits` RPC (for packs) or flips their stored tier (for plans).
 */
export default function PaymentWindow() {
  const { user } = useAuth();
  const { refetchCredits } = useCredits(user?.id);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [method, setMethod] = useState<Method>("paypal");
  const [phase, setPhase] = useState<Phase>("form");

  const [email, setEmail] = useState(user?.email ?? "");
  const [card, setCard] = useState({ number: "", exp: "", cvc: "", name: "" });
  const [promo, setPromo] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; pct: number } | null>(null);

  useEffect(() => setEmail(user?.email ?? ""), [user?.email]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as PaymentIntent;
      setIntent(detail);
      setPhase("form");
      setMethod("paypal");
      setAppliedPromo(null);
      setPromo("");
      setOpen(true);
    };
    window.addEventListener("nazai:open-payment", onOpen);
    return () => window.removeEventListener("nazai:open-payment", onOpen);
  }, []);

  if (!intent) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="hidden" />
      </Dialog>
    );
  }

  const isPack = intent.kind === "pack";
  const basePrice =
    intent.kind === "pack" ? intent.pack.salePrice : intent.price;
  const originalPrice =
    intent.kind === "pack" ? intent.pack.price : intent.price;
  const discount = appliedPromo ? +(basePrice * appliedPromo.pct).toFixed(2) : 0;
  const tax = +((basePrice - discount) * 0.0).toFixed(2); // tax handled by provider
  const total = +(basePrice - discount + tax).toFixed(2);

  const title =
    intent.kind === "pack"
      ? `${formatCredits(totalCredits(intent.pack))} Credits`
      : `${intent.name} Plan${intent.annual ? " · Annual" : " · Monthly"}`;

  const subtitle =
    intent.kind === "pack"
      ? `${formatCredits(intent.pack.credits)} credits${intent.pack.bonus ? ` + ${formatCredits(intent.pack.bonus)} bonus` : ""}`
      : intent.annual
        ? "Billed annually"
        : "Billed monthly";

  const applyPromo = () => {
    const code = promo.trim().toUpperCase();
    if (!code) return;
    const pct = PROMOS[code];
    if (!pct) {
      toast({ title: "Invalid promo code", description: `${code} isn't recognized.`, variant: "destructive" });
      return;
    }
    setAppliedPromo({ code, pct });
    toast({ title: `Promo applied`, description: `${(pct * 100).toFixed(0)}% off — ${code}` });
  };

  const canSubmit =
    email.includes("@") &&
    (method === "paypal" ||
      (card.number.replace(/\s/g, "").length >= 12 &&
        card.exp.length >= 4 &&
        card.cvc.length >= 3 &&
        card.name.trim().length > 1));

  const handlePay = async () => {
    if (!user) {
      toast({ title: "Sign in required", description: "Create an account or sign in to complete checkout." });
      return;
    }
    setPhase("processing");
    // Simulate provider round-trip.
    await new Promise((r) => setTimeout(r, 1600 + Math.random() * 800));

    try {
      if (intent.kind === "pack") {
        const amount = totalCredits(intent.pack);
        const { error } = await supabase.rpc("add_credits", { amount });
        if (error) throw error;
        await refetchCredits();
        await supabase.from("credit_transactions" as any).insert({
          user_id: user.id,
          type: "credit_pack",
          description: `${formatCredits(amount)} credits pack${appliedPromo ? ` · ${appliedPromo.code}` : ""}`,
          amount,
          price_usd: total,
          status: "completed",
          metadata: { method, pack_id: intent.pack.id, promo: appliedPromo?.code ?? null },
        });
      } else {
        // Plan switch — stored locally for now (subscription billing wires later).
        setStoredTier(intent.tierId as TierId);
        await supabase.from("credit_transactions" as any).insert({
          user_id: user.id,
          type: "plan_change",
          description: `Switched to ${intent.name} plan${intent.annual ? " (annual)" : " (monthly)"}`,
          amount: TIER_PLANS[intent.tierId as TierId]?.monthlyCredits ?? 0,
          price_usd: total,
          status: "completed",
          metadata: { method, tier: intent.tierId, annual: !!intent.annual, promo: appliedPromo?.code ?? null },
        });
      }
      setPhase("success");
    } catch (err: any) {
      toast({
        title: "Payment failed",
        description: err?.message ?? "Something went wrong. No charge was made.",
        variant: "destructive",
      });
      setPhase("form");
    }
  };

  const close = () => {
    setOpen(false);
    setTimeout(() => {
      setIntent(null);
      setPhase("form");
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <DialogContent
        className="max-w-xl border-white/10 p-0 overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, rgba(6,182,212,0.10), transparent 55%), radial-gradient(120% 80% at 100% 100%, rgba(167,139,250,0.10), transparent 55%), rgba(8,10,16,0.96)",
          backdropFilter: "blur(24px)",
        }}
      >
        <AnimatePresence mode="wait">
          {phase === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-8 text-center"
            >
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 12, stiffness: 200 }}
                className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
                style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.4)" }}
              >
                <Check size={28} className="text-emerald-400" />
              </motion.div>
              <h2 className="text-xl font-black tracking-tight">Payment successful</h2>
              <p className="text-sm text-white/55 mt-2">
                {isPack
                  ? `${formatCredits(totalCredits((intent as any).pack))} credits added to your balance.`
                  : `Welcome to ${(intent as any).name}. Features unlocked instantly.`}
              </p>
              <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Sparkles size={11} className="text-cyan-400" />
                Receipt sent to {email}
              </div>
              <button
                onClick={close}
                className="mt-7 w-full py-3 rounded-lg text-[13px] font-bold tracking-tight"
                style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)", color: "#020617" }}
              >
                Continue
              </button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Header */}
              <div className="px-6 pt-6 pb-4 border-b border-white/5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40 mb-1">
                      Secure checkout
                    </div>
                    <h2 className="text-xl font-black tracking-tight">{title}</h2>
                    <p className="text-[12px] text-white/55 mt-0.5">{subtitle}</p>
                  </div>
                  <div className="text-right">
                    {originalPrice !== basePrice && (
                      <div className="text-[11px] text-white/35 line-through font-mono">
                        ${originalPrice.toFixed(2)}
                      </div>
                    )}
                    <div className="text-2xl font-black tabular-nums">${basePrice.toFixed(2)}</div>
                    {isPack && (intent as any).pack.bonus > 0 && (
                      <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 mt-0.5">
                        +{formatCredits((intent as any).pack.bonus)} bonus
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                {/* Method selector */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2">Payment method</div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: "paypal" as const, label: "PayPal", sub: "Recommended" },
                      { id: "card" as const, label: "Credit Card", sub: "Visa · MC · Amex" },
                    ]).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMethod(m.id)}
                        className="text-left p-3 rounded-xl border transition-all"
                        style={{
                          background: method === m.id ? "rgba(6,182,212,0.08)" : "rgba(255,255,255,0.02)",
                          borderColor: method === m.id ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.08)",
                          boxShadow: method === m.id ? "0 0 18px rgba(6,182,212,0.18)" : "none",
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {m.id === "paypal" ? (
                            <span className="text-[13px] font-black tracking-tight">
                              <span className="text-[#0070ba]">Pay</span><span className="text-[#003087]">Pal</span>
                            </span>
                          ) : (
                            <CreditCard size={14} className="text-white/80" />
                          )}
                          <span className="text-[12px] font-bold tracking-tight">{m.label}</span>
                        </div>
                        <div className="text-[10px] text-white/45">{m.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Email always */}
                <Field label="Email for receipt">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-transparent outline-none text-[13px] placeholder:text-white/25"
                  />
                </Field>

                {/* Card fields */}
                {method === "card" && (
                  <div className="space-y-3">
                    <Field label="Card number">
                      <input
                        value={card.number}
                        onChange={(e) =>
                          setCard({
                            ...card,
                            number: e.target.value.replace(/[^\d ]/g, "").slice(0, 19),
                          })
                        }
                        placeholder="1234 5678 9012 3456"
                        className="w-full bg-transparent outline-none text-[13px] font-mono placeholder:text-white/25"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Expiry (MM/YY)">
                        <input
                          value={card.exp}
                          onChange={(e) => setCard({ ...card, exp: e.target.value.slice(0, 5) })}
                          placeholder="06/28"
                          className="w-full bg-transparent outline-none text-[13px] font-mono placeholder:text-white/25"
                        />
                      </Field>
                      <Field label="CVC">
                        <input
                          value={card.cvc}
                          onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                          placeholder="123"
                          className="w-full bg-transparent outline-none text-[13px] font-mono placeholder:text-white/25"
                        />
                      </Field>
                    </div>
                    <Field label="Name on card">
                      <input
                        value={card.name}
                        onChange={(e) => setCard({ ...card, name: e.target.value })}
                        placeholder="Jane Doe"
                        className="w-full bg-transparent outline-none text-[13px] placeholder:text-white/25"
                      />
                    </Field>
                  </div>
                )}

                {/* Promo */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                    <Tag size={10} /> Promo code
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03]">
                      <input
                        value={promo}
                        onChange={(e) => setPromo(e.target.value)}
                        placeholder="Try NAZAI10"
                        className="w-full bg-transparent outline-none text-[13px] uppercase placeholder:text-white/25 placeholder:normal-case"
                      />
                    </div>
                    <button
                      onClick={applyPromo}
                      className="px-4 rounded-lg text-[11px] font-bold uppercase tracking-wider border border-white/15 hover:border-white/30 hover:bg-white/5 transition"
                    >
                      Apply
                    </button>
                  </div>
                  {appliedPromo && (
                    <div className="mt-2 text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                      <Check size={11} /> {appliedPromo.code} — {(appliedPromo.pct * 100).toFixed(0)}% off
                      <button onClick={() => setAppliedPromo(null)} className="ml-2 text-white/35 hover:text-white/60">
                        <X size={10} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Order summary */}
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1">
                    Order summary
                  </div>
                  <Row label={title} value={`$${basePrice.toFixed(2)}`} />
                  {appliedPromo && (
                    <Row label={`Discount (${appliedPromo.code})`} value={`-$${discount.toFixed(2)}`} accent="emerald" />
                  )}
                  <Row label="Taxes" value="Calculated by provider" muted />
                  <div className="h-px bg-white/10 my-1.5" />
                  <Row label="Total due today" value={`$${total.toFixed(2)}`} bold />
                </div>

                {/* Trust row */}
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] font-mono uppercase tracking-wider text-white/35">
                  <span className="flex items-center gap-1.5"><Lock size={10} /> 256-bit SSL</span>
                  <span className="flex items-center gap-1.5"><ShieldCheck size={10} /> PCI-DSS</span>
                  <span>Money-back 30 days</span>
                </div>
              </div>

              {/* Footer CTA */}
              <div className="px-6 pb-6">
                <button
                  disabled={!canSubmit || phase === "processing"}
                  onClick={handlePay}
                  className="w-full py-3.5 rounded-lg text-[13px] font-black tracking-[0.05em] uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{
                    background:
                      method === "paypal"
                        ? "linear-gradient(135deg, #ffc439, #f5b400)"
                        : "linear-gradient(135deg, #06b6d4, #0891b2)",
                    color: "#020617",
                    boxShadow: "0 8px 32px rgba(6,182,212,0.25)",
                  }}
                >
                  {phase === "processing" ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Processing securely…
                    </>
                  ) : method === "paypal" ? (
                    <>Pay ${total.toFixed(2)} with PayPal</>
                  ) : (
                    <>Pay ${total.toFixed(2)}</>
                  )}
                </button>
                <p className="mt-2 text-[10px] text-center text-white/35">
                  By continuing you agree to NazAI's Terms & Refund Policy. Mock checkout — no real charge.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">{label}</div>
      <div className="px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03] focus-within:border-cyan-400/40 focus-within:bg-white/[0.05] transition">
        {children}
      </div>
    </div>
  );
}

function Row({
  label, value, bold, muted, accent,
}: { label: string; value: string; bold?: boolean; muted?: boolean; accent?: "emerald" }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className={muted ? "text-white/40" : "text-white/65"}>{label}</span>
      <span
        className={`tabular-nums font-mono ${bold ? "font-bold text-white text-[14px]" : ""} ${
          accent === "emerald" ? "text-emerald-400" : muted ? "text-white/40" : "text-white/85"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
