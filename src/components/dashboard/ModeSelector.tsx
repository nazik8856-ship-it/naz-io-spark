import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Shield, X, ChevronDown, Lock } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useTier, hasFeature } from "@/lib/feature-gates";
import { TIER_PLANS } from "@/lib/credit-tiers";

export type ChatMode = "pro-designer" | "antifragile" | null;

interface ModeSelectorProps {
  /** currently active mode (null when none) */
  active: ChatMode;
  /** called when user picks a mode (or clears via X) */
  onChange: (next: ChatMode) => void;
  /** optional niche text used by Antifragile mode */
  niche?: string;
  onNicheChange?: (next: string) => void;
}

const MODE_META: Record<
  Exclude<ChatMode, null>,
  { label: string; sub: string; accent: string; icon: typeof Sparkles }
> = {
  "pro-designer": {
    label: "Pro Designer",
    sub: "Senior B2B web designer protocol — minimalist, conversion-driven.",
    accent: "#a78bfa",
    icon: Sparkles,
  },
  antifragile: {
    label: "Antifragile",
    sub: "Volatility-resistant, gain-from-disorder business systems.",
    accent: "#f97316",
    icon: Shield,
  },
};

/**
 * ModeSelector — single ✨ trigger that opens a glassmorphic popover with two
 * large premium buttons (Pro Designer / Antifragile). When a mode is active a
 * highlighted pill is shown with an X to deactivate. Designed to sit next to
 * the chat input "+" button.
 */
const ModeSelector = ({ active, onChange, niche = "", onNicheChange }: ModeSelectorProps) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const tier = useTier();
  const tierName = TIER_PLANS[tier].name;

  const activeMeta = active ? MODE_META[active] : null;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="w-8 h-8 rounded-xl flex items-center justify-center border transition-all relative"
            style={{
              background: active
                ? `${activeMeta!.accent}22`
                : "rgba(255,255,255,0.05)",
              borderColor: active ? activeMeta!.accent : "rgba(255,255,255,0.10)",
              boxShadow: active ? `0 0 16px ${activeMeta!.accent}55` : "none",
            }}
            title="AI Modes"
            aria-label="Open AI mode selector"
          >
            <Sparkles
              size={14}
              style={{ color: active ? activeMeta!.accent : "rgba(255,255,255,0.7)" }}
            />
          </motion.button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={10}
          className="w-[300px] p-3 rounded-2xl border-white/10"
          style={{
            background: "rgba(8,10,16,0.92)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 20px 60px -10px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          <div className="px-1 pb-2 mb-1 border-b border-white/5">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">
              AI Mode
            </div>
            <div className="text-[11px] text-white/50 mt-0.5">
              Inject a specialized system protocol into the next prompts.
            </div>
          </div>

          <div className="space-y-2">
            {(Object.keys(MODE_META) as Array<Exclude<ChatMode, null>>).map((key) => {
              const meta = MODE_META[key];
              const Icon = meta.icon;
              const isActive = active === key;
              const featureKey = key === "pro-designer" ? "mode.pro-designer" : "mode.antifragile";
              const unlocked = hasFeature(tier, featureKey);
              return (
                <motion.button
                  key={key}
                  whileHover={{ scale: unlocked ? 1.015 : 1 }}
                  whileTap={{ scale: unlocked ? 0.985 : 1 }}
                  onClick={() => {
                    if (!unlocked) {
                      setOpen(false);
                      navigate("/pricing");
                      return;
                    }
                    onChange(isActive ? null : key);
                    setOpen(false);
                  }}
                  className="w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 relative"
                  style={{
                    background: isActive
                      ? `linear-gradient(135deg, ${meta.accent}1c, ${meta.accent}08)`
                      : "rgba(255,255,255,0.025)",
                    borderColor: isActive ? `${meta.accent}80` : "rgba(255,255,255,0.08)",
                    boxShadow: isActive ? `0 0 24px ${meta.accent}33` : "none",
                    opacity: unlocked ? 1 : 0.78,
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: `${meta.accent}1f`,
                      border: `1px solid ${meta.accent}55`,
                    }}
                  >
                    {unlocked ? (
                      <Icon size={16} style={{ color: meta.accent }} />
                    ) : (
                      <Lock size={14} style={{ color: meta.accent }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="text-[13px] font-bold tracking-tight"
                        style={{ color: isActive ? meta.accent : "rgba(255,255,255,0.92)" }}
                      >
                        {meta.label}
                      </span>
                      {isActive && (
                        <span
                          className="text-[9px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-full"
                          style={{ background: `${meta.accent}22`, color: meta.accent }}
                        >
                          ON
                        </span>
                      )}
                      {!unlocked && (
                        <span
                          className="text-[9px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            color: "rgba(255,255,255,0.6)",
                            border: "1px solid rgba(255,255,255,0.1)",
                          }}
                        >
                          Operator+
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed">
                      {unlocked
                        ? meta.sub
                        : `Locked on ${tierName}. Upgrade to unlock this specialized protocol.`}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Antifragile niche input — only when antifragile is active */}
          <AnimatePresence>
            {active === "antifragile" && onNicheChange && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-white/5">
                  <label className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40 block mb-1.5">
                    Your niche
                  </label>
                  <input
                    type="text"
                    value={niche}
                    onChange={(e) => onNicheChange(e.target.value)}
                    placeholder="e.g. boutique consultancy, supply-chain SaaS…"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-white/25 focus:outline-none focus:border-[#f97316]/60 transition-colors"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </PopoverContent>
      </Popover>

      {/* Active mode pill (with X to deactivate) */}
      <AnimatePresence>
        {active && activeMeta && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.9 }}
            className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full"
            style={{
              background: `${activeMeta.accent}1c`,
              border: `1px solid ${activeMeta.accent}66`,
              boxShadow: `0 0 14px ${activeMeta.accent}33`,
            }}
          >
            <activeMeta.icon size={10} style={{ color: activeMeta.accent }} />
            <span
              className="text-[10px] font-mono uppercase tracking-[0.14em]"
              style={{ color: activeMeta.accent }}
            >
              {activeMeta.label}
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
              aria-label={`Deactivate ${activeMeta.label} mode`}
            >
              <X size={9} style={{ color: activeMeta.accent }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ModeSelector;
