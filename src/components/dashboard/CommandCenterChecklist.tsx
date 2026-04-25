import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  UserPlus,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Circle,
  Lock,
  Sparkles,
  TrendingUp,
  MessageSquare,
  BarChart3,
  ArrowRight,
  KeyRound,
  Compass,
} from "lucide-react";

/**
 * CommandCenterChecklist
 * Onboarding checklist + Reliability Guardrails + blurred activity skeletons
 * that progressively unlock as the user completes onboarding steps.
 *
 * State is persisted to localStorage so progress survives reloads.
 * Pure presentation — no Supabase logic touched.
 */

const STORAGE_KEY = "nazai.commandCenter.checklist.v1";

type StepId = "domain" | "customer" | "invoice" | "brand";

type Step = {
  id: StepId;
  title: string;
  desc: string;
  icon: React.ElementType;
  cta: string;
};

const STEPS: Step[] = [
  {
    id: "domain",
    title: "Get a custom domain",
    desc: "Claim a branded domain so customers find you instantly.",
    icon: Globe,
    cta: "Browse domains",
  },
  {
    id: "customer",
    title: "Add your first customer",
    desc: "Drop a contact into the CRM to activate revenue tracking.",
    icon: UserPlus,
    cta: "Open CRM",
  },
  {
    id: "invoice",
    title: "Create an invoice",
    desc: "Send your first invoice and turn on payment receiving.",
    icon: FileText,
    cta: "New invoice",
  },
  {
    id: "brand",
    title: "Generate brand assets",
    desc: "Logo, palette, and social kit — produced by the AI image agent.",
    icon: ImageIcon,
    cta: "Run brand agent",
  },
];

const GUARDRAILS = [
  {
    icon: BarChart3,
    label: "92% confidence",
    desc: "Score calibrated from prompt specificity and available assumptions.",
    accent: "#06b6d4",
  },
  {
    icon: CheckCircle2,
    label: "Verified assumptions",
    desc: "Flags uncertain market, finance, and compliance claims before use.",
    accent: "#8b5cf6",
  },
  {
    icon: FileText,
    label: "Fact-check ready",
    desc: "Send any section through a source-backed verification pass.",
    accent: "#06b6d4",
  },
  {
    icon: Lock,
    label: "Approved memory",
    desc: "Mark final decisions as approved for future iterations.",
    accent: "#22c55e",
  },
];

type ProgressMap = Record<StepId, boolean>;
const DEFAULT_PROGRESS: ProgressMap = {
  domain: false,
  customer: false,
  invoice: false,
  brand: false,
};

const loadProgress = (): ProgressMap => {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PROGRESS, ...parsed };
  } catch {
    return DEFAULT_PROGRESS;
  }
};

const CommandCenterChecklist: React.FC = () => {
  const [progress, setProgress] = useState<ProgressMap>(DEFAULT_PROGRESS);

  useEffect(() => {
    setProgress(loadProgress());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // ignore
    }
  }, [progress]);

  const completedCount = useMemo(
    () => Object.values(progress).filter(Boolean).length,
    [progress]
  );
  const total = STEPS.length;
  const percent = Math.round((completedCount / total) * 100);

  const toggle = (id: StepId) =>
    setProgress((p) => ({ ...p, [id]: !p[id] }));

  // Activity unlocks: 2 steps unlocks invoices, 3 steps unlocks customers
  const invoicesUnlocked = completedCount >= 2;
  const customersUnlocked = completedCount >= 3;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-mono tracking-[0.2em] uppercase mb-3"
            style={{
              background: "rgba(6,182,212,0.08)",
              border: "1px solid rgba(6,182,212,0.25)",
              color: "#06b6d4",
            }}
          >
            <Sparkles size={10} />
            Command Center
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
            Get your business operating
          </h2>
          <p className="text-sm text-white/50 mt-1">
            Four moves to a fully live operation. NazAI handles the heavy lifting.
          </p>
        </div>

        {/* Progress badge */}
        <div
          className="rounded-xl px-4 py-3 min-w-[200px]"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.2em] uppercase text-white/50 mb-2">
            <span>Onboarding</span>
            <span style={{ color: "#06b6d4" }}>
              {completedCount}/{total}
            </span>
          </div>
          <div
            className="relative h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <motion.div
              animate={{ width: `${percent}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
              className="absolute left-0 top-0 h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #06b6d4, #8b5cf6)",
                boxShadow: "0 0 12px rgba(6,182,212,0.5)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Checklist grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {STEPS.map((step, i) => {
          const done = progress[step.id];
          const Icon = step.icon;
          return (
            <motion.button
              key={step.id}
              type="button"
              onClick={() => toggle(step.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              whileHover={{ y: -2 }}
              className="group relative text-left rounded-xl p-4 transition-all"
              style={{
                background: done
                  ? "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(139,92,246,0.04))"
                  : "rgba(255,255,255,0.02)",
                border: done
                  ? "1px solid rgba(6,182,212,0.35)"
                  : "1px solid rgba(255,255,255,0.06)",
                boxShadow: done
                  ? "0 0 24px rgba(6,182,212,0.12)"
                  : "none",
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: done ? "rgba(6,182,212,0.14)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${done ? "rgba(6,182,212,0.35)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <Icon size={16} style={{ color: done ? "#06b6d4" : "rgba(255,255,255,0.6)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-semibold"
                      style={{
                        color: done ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.85)",
                        textDecoration: done ? "line-through" : "none",
                        textDecorationColor: "rgba(6,182,212,0.5)",
                      }}
                    >
                      {step.title}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">{step.desc}</p>
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.18em] uppercase opacity-70 group-hover:opacity-100 transition-opacity"
                       style={{ color: done ? "#06b6d4" : "rgba(255,255,255,0.6)" }}>
                    {step.cta}
                    <ArrowRight size={10} />
                  </div>
                </div>
                <div className="shrink-0">
                  {done ? (
                    <CheckCircle2 size={18} style={{ color: "#06b6d4" }} />
                  ) : (
                    <Circle size={18} className="text-white/25" />
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Reliability Guardrails */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-white/40">
            Reliability Guardrails
          </span>
          <div className="flex-1 h-px bg-white/5" />
          <span
            className="text-[9px] font-mono tracking-[0.2em] uppercase flex items-center gap-1.5"
            style={{ color: "#06b6d4" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "#06b6d4", boxShadow: "0 0 8px #06b6d4" }}
            />
            LIVE
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {GUARDRAILS.map((guardrail, i) => {
            const Icon = guardrail.icon;
            return (
              <motion.div
                key={guardrail.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                className="rounded-xl p-4"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center"
                    style={{
                      background: `${guardrail.accent}14`,
                      border: `1px solid ${guardrail.accent}33`,
                    }}
                  >
                    <Icon size={13} style={{ color: guardrail.accent }} />
                  </div>
                  <span className="text-xs font-semibold text-white/90">{guardrail.label}</span>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">{guardrail.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Activity Stream — blurred skeletons that unlock with progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ActivityCard
          title="Latest Invoices"
          unlocked={invoicesUnlocked}
          requirement="Complete 2 onboarding steps to unlock"
          rows={[
            { left: "INV-0042 · Acme Co.", right: "$1,240" },
            { left: "INV-0041 · Lumen LLC", right: "$680" },
            { left: "INV-0040 · Northwind", right: "$2,100" },
          ]}
        />
        <ActivityCard
          title="Latest Customers"
          unlocked={customersUnlocked}
          requirement="Complete 3 onboarding steps to unlock"
          rows={[
            { left: "Sarah Chen · Acme Co.", right: "Today" },
            { left: "James Patel · Lumen LLC", right: "Yesterday" },
            { left: "Mira Okafor · Northwind", right: "2d ago" },
          ]}
        />
      </div>
    </div>
  );
};

const ActivityCard: React.FC<{
  title: string;
  unlocked: boolean;
  requirement: string;
  rows: { left: string; right: string }[];
}> = ({ title, unlocked, requirement, rows }) => {
  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-white/50">
          {title}
        </span>
        {unlocked ? (
          <span
            className="text-[9px] font-mono tracking-[0.2em] uppercase flex items-center gap-1"
            style={{ color: "#06b6d4" }}
          >
            <CheckCircle2 size={10} />
            Unlocked
          </span>
        ) : (
          <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/30 flex items-center gap-1">
            <Lock size={10} />
            Locked
          </span>
        )}
      </div>

      <div className="relative">
        <div
          className="p-4 space-y-2.5"
          style={{
            filter: unlocked ? "none" : "blur(6px)",
            transition: "filter 0.5s ease",
          }}
        >
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-3 rounded-md"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-6 h-6 rounded-full shrink-0"
                  style={{
                    background: "linear-gradient(135deg, rgba(6,182,212,0.3), rgba(139,92,246,0.3))",
                  }}
                />
                <span className="text-xs text-white/70 truncate">{row.left}</span>
              </div>
              <span className="text-xs font-mono text-white/60 shrink-0 ml-2">{row.right}</span>
            </div>
          ))}
        </div>

        <AnimatePresence>
          {!unlocked && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
              style={{
                background:
                  "linear-gradient(180deg, rgba(2,6,23,0.4) 0%, rgba(2,6,23,0.85) 100%)",
              }}
            >
              <Lock size={18} className="text-white/40 mb-2" />
              <p className="text-xs text-white/60 max-w-[220px] leading-relaxed">
                {requirement}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CommandCenterChecklist;
