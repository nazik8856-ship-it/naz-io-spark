import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Code2,
  TrendingUp,
  ShieldCheck,
  Layers,
  Target,
  Zap,
  Send,
  ArrowRight,
} from "lucide-react";

interface NextStepHintsProps {
  /** The latest AI response text — drives suggestion selection */
  latestResponse: string;
  /** Whether the AI is currently generating — hides the bar */
  isPending: boolean;
  /** Triggered when user clicks a suggestion chip — should send as prompt */
  onSuggestionClick: (prompt: string) => void;
  /** Triggered when user submits a strategy question */
  onStrategyAsk: (question: string) => void;
  /** Aura accent color (hex like #06b6d4) — for glow + border */
  accentColor: string;
  /** Helper to convert accent hex into "r,g,b" */
  getRgb: (hex: string) => string;
}

interface NextAction {
  icon: React.ReactNode;
  label: string;
  /** The full prompt sent to the model when clicked */
  prompt: string;
}

/**
 * Stage-aware: inspects the latest AI response and proposes 3–4 next-step
 * actions plus a secondary strategy input. Designed to slot directly above
 * the Adaptive Workbench input container in Dashboard, mirroring the
 * "what's next" affordance Lovable shows above its own prompt bar.
 */
const NextStepHints: React.FC<NextStepHintsProps> = ({
  latestResponse,
  isPending,
  onSuggestionClick,
  onStrategyAsk,
  accentColor,
  getRgb,
}) => {
  const [strategyInput, setStrategyInput] = useState("");

  const actions: NextAction[] = useMemo(() => {
    const r = (latestResponse || "").toLowerCase();

    // Stage detection — order matters (most specific first)
    const isWebsite =
      r.includes("<html") ||
      r.includes("<!doctype") ||
      r.includes("```html") ||
      (r.includes("hero") && r.includes("section"));

    const isCode =
      !isWebsite &&
      (r.includes("```") ||
        r.includes("function ") ||
        r.includes("const ") ||
        r.includes("api") ||
        r.includes("architecture"));

    const isBusiness =
      !isWebsite &&
      !isCode &&
      (r.includes("market") ||
        r.includes("revenue") ||
        r.includes("strategy") ||
        r.includes("customer") ||
        r.includes("pricing") ||
        r.includes("competitor"));

    if (isWebsite) {
      return [
        {
          icon: <Sparkles className="w-3.5 h-3.5" />,
          label: "Refine Hero",
          prompt:
            "Refine the hero section: stronger headline, clearer value proposition, and a more compelling primary CTA.",
        },
        {
          icon: <Layers className="w-3.5 h-3.5" />,
          label: "Add Pricing",
          prompt:
            "Add a 3-tier pricing section with feature comparison and a recommended plan highlight.",
        },
        {
          icon: <Target className="w-3.5 h-3.5" />,
          label: "Add Lead Form",
          prompt:
            "Add a lead capture form near the bottom with name, email, and a single goal-oriented question.",
        },
        {
          icon: <ShieldCheck className="w-3.5 h-3.5" />,
          label: "Polish & Launch",
          prompt:
            "Audit the site for spacing, contrast, mobile responsiveness, and SEO meta tags. Apply fixes.",
        },
      ];
    }

    if (isCode) {
      return [
        {
          icon: <Code2 className="w-3.5 h-3.5" />,
          label: "Architecture Map",
          prompt:
            "Produce a clear architecture diagram and module breakdown for the system you just described.",
        },
        {
          icon: <Zap className="w-3.5 h-3.5" />,
          label: "Edge Cases",
          prompt:
            "List the top edge cases and failure modes for this implementation, with mitigations.",
        },
        {
          icon: <ShieldCheck className="w-3.5 h-3.5" />,
          label: "Security Review",
          prompt:
            "Run a security review on this code: auth, input validation, secrets handling, and RLS posture.",
        },
        {
          icon: <TrendingUp className="w-3.5 h-3.5" />,
          label: "Optimize Perf",
          prompt:
            "Identify the top performance bottlenecks here and propose concrete optimizations.",
        },
      ];
    }

    if (isBusiness) {
      return [
        {
          icon: <TrendingUp className="w-3.5 h-3.5" />,
          label: "12-Mo Cashflow",
          prompt:
            "Generate a realistic 12-month cashflow projection based on the strategy above.",
        },
        {
          icon: <Target className="w-3.5 h-3.5" />,
          label: "GTM Plan",
          prompt:
            "Build a 90-day go-to-market plan with channels, weekly milestones, and KPIs.",
        },
        {
          icon: <Layers className="w-3.5 h-3.5" />,
          label: "Competitor Gaps",
          prompt:
            "Map the top 5 competitors and identify the 3 sharpest gaps we can exploit.",
        },
        {
          icon: <Sparkles className="w-3.5 h-3.5" />,
          label: "Build Website",
          prompt:
            "Turn this strategy into a production-ready landing page that sells the offer.",
        },
      ];
    }

    // Generic fallback
    return [
      {
        icon: <Sparkles className="w-3.5 h-3.5" />,
        label: "Go Deeper",
        prompt: "Expand the most important point above with concrete detail and a worked example.",
      },
      {
        icon: <Target className="w-3.5 h-3.5" />,
        label: "Action Plan",
        prompt: "Convert this into a numbered action plan I can execute this week.",
      },
      {
        icon: <Layers className="w-3.5 h-3.5" />,
        label: "Build Website",
        prompt: "Turn this into a production-ready landing page.",
      },
      {
        icon: <ShieldCheck className="w-3.5 h-3.5" />,
        label: "Pressure Test",
        prompt: "Stress-test the logic above — where would it break in the real world?",
      },
    ];
  }, [latestResponse]);

  if (isPending) return null;

  const rgb = getRgb(accentColor);

  return (
    <AnimatePresence>
      <motion.div
        key="next-step-hints"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="fixed left-1/2 -translate-x-1/2 z-30 w-[94%] sm:w-full sm:max-w-2xl -translate-y-0"
        style={{
          bottom: 180,
          pointerEvents: "auto",
        }}
      >
        <div
          className="rounded-2xl px-3 py-3 sm:px-4 sm:py-3.5"
          style={{
            background: "rgba(10, 14, 23, 0.92)",
            border: `1px solid rgba(${rgb},0.22)`,
            boxShadow: `0 12px 40px -16px rgba(0,0,0,0.6), 0 0 24px -12px rgba(${rgb},0.35)`,
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-2.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}` }}
            />
            <span
              className="text-[9px] font-mono tracking-[0.22em] uppercase"
              style={{ color: accentColor }}
            >
              Next Steps
            </span>
            <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-white/30 ml-auto">
              Tap to continue
            </span>
          </div>

          {/* Action chips */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {actions.map((a, i) => (
              <motion.button
                key={`${a.label}-${i}`}
                onClick={() => onSuggestionClick(a.prompt)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                style={{
                  background: `rgba(${rgb},0.06)`,
                  border: `1px solid rgba(${rgb},0.22)`,
                  color: "var(--nazai-text-color, rgba(255,255,255,0.92))",
                }}
                title={a.prompt}
              >
                <span style={{ color: accentColor }}>{a.icon}</span>
                <span className="truncate max-w-[160px]">{a.label}</span>
                <ArrowRight
                  className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-60 group-hover:translate-x-0 transition-all"
                />
              </motion.button>
            ))}
          </div>

          {/* Strategy question */}
          <div
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <Sparkles className="w-3 h-3 shrink-0" style={{ color: accentColor }} />
            <input
              type="text"
              value={strategyInput}
              onChange={(e) => setStrategyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && strategyInput.trim()) {
                  onStrategyAsk(strategyInput.trim());
                  setStrategyInput("");
                }
              }}
              placeholder="Ask a strategy question…"
              className="flex-1 bg-transparent border-none outline-none text-[11px] font-mono text-white/85 placeholder:text-white/30"
            />
            <button
              type="button"
              disabled={!strategyInput.trim()}
              onClick={() => {
                if (strategyInput.trim()) {
                  onStrategyAsk(strategyInput.trim());
                  setStrategyInput("");
                }
              }}
              className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md transition-opacity disabled:opacity-30"
              style={{
                background: `rgba(${rgb},0.15)`,
                border: `1px solid rgba(${rgb},0.32)`,
                color: accentColor,
              }}
              title="Ask"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default NextStepHints;
