import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  Check,
  X,
  Terminal,
  Sparkles,
  Zap,
  Mountain,
  PlayCircle,
  Rocket,
  ShieldCheck,
} from "lucide-react";

// ─── Theme tokens ─────────────────────────────────────────────────────────────
const CYAN = "#00F0FF";
const CYAN_DIM = "rgba(0, 240, 255, 0.35)";
const GREEN = "#39FF14";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";
const SANS = "'Inter', sans-serif";

type BillingCycle = "monthly" | "yearly";

// ─── Pricing data ─────────────────────────────────────────────────────────────
interface Tier {
  id: "spark" | "kinetic" | "monolith";
  name: string;
  tagline: string;
  icon: typeof Sparkles;
  monthly: number;
  yearly: number; // effective monthly rate when billed yearly
  maxProjects: number; // Infinity === unlimited
  featured?: boolean;
  cta: string;
  features: string[];
}

const TIERS: Tier[] = [
  {
    id: "spark",
    name: "Spark",
    tagline: "Ignite the idea.",
    icon: Sparkles,
    monthly: 0,
    yearly: 0,
    maxProjects: 3,
    cta: "Launch Free",
    features: [
      "3 active projects",
      "AI idea validation",
      "Basic business plan",
      "Community support",
    ],
  },
  {
    id: "kinetic",
    name: "Kinetic",
    tagline: "Keep the momentum.",
    icon: Zap,
    monthly: 25,
    yearly: 19,
    maxProjects: 15,
    featured: true,
    cta: "Go Kinetic",
    features: [
      "15 active projects",
      "Agentic workflows",
      "Self-healing SEO",
      "Landing page generation",
      "Priority email support",
    ],
  },
  {
    id: "monolith",
    name: "Monolith",
    tagline: "Become the system.",
    icon: Mountain,
    monthly: 99,
    yearly: 89,
    maxProjects: Infinity,
    cta: "Claim Monolith",
    features: [
      "Unlimited projects",
      "CEO Decision Engine",
      "Multi-agent orchestration",
      "Dedicated infra + API access",
      "White-glove onboarding",
    ],
  },
];

// ─── FlipDigit / RollingPrice ─────────────────────────────────────────────────
// Replaces each digit with a smooth vertical-flip transition when the value
// changes. Non-digit characters (e.g. "$") pass through unchanged.
const FlipDigit = ({ char }: { char: string }) => (
  <span className="relative inline-block w-[0.62em] h-[1em] overflow-hidden align-middle tabular-nums">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={char}
        initial={{ y: "-100%", rotateX: -90, opacity: 0 }}
        animate={{ y: "0%", rotateX: 0, opacity: 1 }}
        exit={{ y: "100%", rotateX: 90, opacity: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0 flex items-center justify-center"
        style={{ transformStyle: "preserve-3d", transformPerspective: 600 }}
      >
        {char}
      </motion.span>
    </AnimatePresence>
  </span>
);

const RollingPrice = ({ value }: { value: number }) => {
  const text = String(value);
  return (
    <span className="inline-flex items-baseline">
      <span className="text-3xl md:text-4xl font-black text-white/70 mr-1" style={{ fontFamily: MONO }}>
        $
      </span>
      <span className="text-6xl md:text-7xl font-black text-white leading-none" style={{ fontFamily: MONO }}>
        {text.split("").map((c, i) => (
          <FlipDigit key={`${i}-${c}`} char={c} />
        ))}
      </span>
    </span>
  );
};

// ─── Live Terminal Loop (Monolith card) ───────────────────────────────────────
const TERMINAL_LOGS = [
  "[DECISION_ENGINE: ACTIVE]",
  "[AGENT_SWARM] spawning 12 workers",
  "[SEO/SELF_HEAL] patched 3 canonical tags",
  "[MARKET] scanning 1,284 competitors…",
  "[CASHFLOW] 60-month forecast: +248%",
  "[OPS] CRM sync → 842 contacts indexed",
  "[DEPLOY] Vercel edge rollout → ok",
  "[LEGAL] contract v1.2 → reviewed",
  "[CEO_MODE] strategic priority rebalanced",
  "[NEURAL] mission confidence 97.4%",
];

const LiveTerminal = () => {
  const [lines, setLines] = useState<string[]>(() => TERMINAL_LOGS.slice(0, 5));
  const cursor = useRef(5);

  useEffect(() => {
    const id = setInterval(() => {
      const next = TERMINAL_LOGS[cursor.current % TERMINAL_LOGS.length];
      cursor.current += 1;
      setLines((prev) => [...prev.slice(-4), next]);
    }, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="relative mt-5 border-2 bg-black overflow-hidden"
      style={{ borderColor: CYAN_DIM, borderRadius: 0 }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b-2 text-[9px] tracking-[0.3em] uppercase font-black"
        style={{ borderColor: CYAN_DIM, color: CYAN, fontFamily: MONO }}
      >
        <span className="flex items-center gap-1.5">
          <Terminal size={10} /> ceo.intel.log
        </span>
        <span className="flex items-center gap-1.5 text-[#22c55e]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
          LIVE
        </span>
      </div>
      <div
        className="h-[110px] px-3 py-2 text-[10px] leading-[1.55] relative"
        style={{ fontFamily: MONO }}
      >
        {lines.map((l, i) => (
          <motion.div
            key={`${i}-${l}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1 - (lines.length - 1 - i) * 0.17, x: 0 }}
            transition={{ duration: 0.35 }}
            className="text-[#00F0FF]/90 truncate"
          >
            <span className="text-white/30 mr-2">{String(cursor.current - (lines.length - i)).padStart(4, "0")}</span>
            {l}
          </motion.div>
        ))}
        {/* scanline sheen */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,240,255,0.05) 0 1px, transparent 1px 3px)",
          }}
        />
      </div>
    </div>
  );
};

// ─── Vercel-Ready Badge ───────────────────────────────────────────────────────
const VercelBadge = () => (
  <div
    className="inline-flex items-center gap-2 px-3 py-1.5 border-2 bg-black/80"
    style={{ borderColor: CYAN_DIM, borderRadius: 0, fontFamily: MONO }}
  >
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path d="M12 2L22 20H2L12 2Z" fill="#ffffff" />
    </svg>
    <span className="text-[9px] tracking-[0.3em] uppercase font-black text-white">Vercel-Ready</span>
    <span className="relative flex h-2 w-2">
      <span className="absolute inset-0 rounded-full bg-[#22c55e] opacity-75 animate-ping" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]" />
    </span>
  </div>
);

// ─── 3D-tilt wrapper ──────────────────────────────────────────────────────────
const TiltCard = ({ children, className = "", featured }: { children: React.ReactNode; className?: string; featured?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rX = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), { stiffness: 220, damping: 18 });
  const rY = useSpring(useTransform(mx, [-0.5, 0.5], [-10, 10]), { stiffness: 220, damping: 18 });

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const reset = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{
        rotateX: rX,
        rotateY: rY,
        transformStyle: "preserve-3d",
        transformPerspective: 1000,
      }}
      whileHover={{
        boxShadow: featured
          ? `0 0 0 2px ${CYAN}, 0 0 60px 6px rgba(0,240,255,0.55), 0 0 120px 20px rgba(0,240,255,0.25)`
          : `0 0 0 2px ${CYAN}, 0 0 40px 4px rgba(0,240,255,0.35)`,
      }}
      transition={{ boxShadow: { duration: 0.3 } }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

// ─── Founder Mode Modal ───────────────────────────────────────────────────────
const FounderModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      >
        <motion.div
          initial={{ y: 30, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-2xl bg-black border-2"
          style={{ borderColor: CYAN, borderRadius: 0 }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b-2"
            style={{ borderColor: CYAN_DIM, fontFamily: MONO }}
          >
            <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase font-black" style={{ color: CYAN }}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-[#FF0055] opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF0055]" />
              </span>
              REC ── Founder Mode · Raw Cut
            </div>
            <button
              onClick={onClose}
              aria-label="Close founder video"
              className="text-white/60 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="relative aspect-video bg-[#050505] overflow-hidden">
            {/* Low-fi VHS-style intro — no external video to keep it dep-free */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px)",
              }}
            />
            <motion.div
              aria-hidden
              className="absolute inset-x-0 h-[3px] bg-white/10"
              animate={{ y: ["-10%", "110%"] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: "linear" }}
            />
            <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
              <div
                className="text-[9px] tracking-[0.5em] uppercase font-black mb-3"
                style={{ color: CYAN, fontFamily: MONO }}
              >
                Transmission · 04:13 AM · Basement Lab
              </div>
              <p
                className="text-white text-xl md:text-2xl font-black italic max-w-lg leading-snug"
                style={{ fontFamily: SANS }}
              >
                “I didn't build NazAI to make money. I built it so nobody has to feel stuck the way I did.”
              </p>
              <p className="mt-4 text-[11px] text-white/50" style={{ fontFamily: MONO }}>
                — the founder, unfiltered
              </p>
              <div
                className="absolute bottom-3 right-4 text-[10px] text-[#FF0055] font-black tracking-[0.3em] uppercase"
                style={{ fontFamily: MONO }}
              >
                ● REC
              </div>
            </div>
          </div>
          <div
            className="px-4 py-3 border-t-2 text-[10px] text-white/60 flex items-center justify-between"
            style={{ borderColor: CYAN_DIM, fontFamily: MONO }}
          >
            <span>ESC to close · shot on a phone, edited in 9 minutes.</span>
            <span className="text-white/30">NazAI.raw/founder-mode</span>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

// ─── Project Slider ───────────────────────────────────────────────────────────
const bestPlanFor = (projects: number): Tier["id"] => {
  if (projects <= 3) return "spark";
  if (projects <= 15) return "kinetic";
  return "monolith";
};

const ProjectSlider = ({
  projects,
  setProjects,
  best,
  cycle,
}: {
  projects: number;
  setProjects: (n: number) => void;
  best: Tier["id"];
  cycle: BillingCycle;
}) => {
  const bestTier = TIERS.find((t) => t.id === best)!;
  const price = cycle === "yearly" ? bestTier.yearly : bestTier.monthly;
  return (
    <div className="mt-16 max-w-4xl mx-auto border-2 bg-black p-6 md:p-8" style={{ borderColor: CYAN, borderRadius: 0 }}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-[10px] tracking-[0.4em] uppercase font-black mb-2" style={{ color: CYAN, fontFamily: MONO }}>
            Project Slider · Mathematical Optimum
          </div>
          <div className="text-white text-xl md:text-2xl font-black" style={{ fontFamily: SANS }}>
            I'm planning to run{" "}
            <span style={{ color: CYAN }}>{projects}</span> project{projects === 1 ? "" : "s"}.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/40 font-bold" style={{ fontFamily: MONO }}>
            Recommended
          </div>
          <div className="text-white text-2xl font-black tracking-tight" style={{ fontFamily: SANS }}>
            {bestTier.name}
          </div>
          <div className="text-[11px] text-white/60" style={{ fontFamily: MONO }}>
            ${price}/mo · {projects === 0 ? 0 : (price / Math.max(projects, 1)).toFixed(2)}/project
          </div>
        </div>
      </div>

      <div className="relative">
        <input
          type="range"
          min={1}
          max={50}
          value={projects}
          onChange={(e) => setProjects(Number(e.target.value))}
          className="w-full appearance-none h-1.5 bg-white/10 outline-none cursor-pointer range-neon"
          aria-label="Number of projects"
        />
        <style>{`
          .range-neon::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 22px; height: 22px;
            background: #000; border: 2px solid ${CYAN};
            box-shadow: 0 0 12px ${CYAN}, 0 0 24px rgba(0,240,255,0.5);
            cursor: pointer;
          }
          .range-neon::-moz-range-thumb {
            width: 22px; height: 22px;
            background: #000; border: 2px solid ${CYAN};
            box-shadow: 0 0 12px ${CYAN};
            cursor: pointer;
          }
        `}</style>
        {/* Ticks */}
        <div className="flex justify-between mt-2 text-[9px] text-white/30 font-bold tracking-[0.2em]" style={{ fontFamily: MONO }}>
          <span>1</span>
          <span>10</span>
          <span>20</span>
          <span>30</span>
          <span>40</span>
          <span>50</span>
        </div>
      </div>

      {/* Plan ladder */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {TIERS.map((t) => {
          const active = t.id === best;
          return (
            <motion.div
              key={t.id}
              animate={{
                borderColor: active ? CYAN : "rgba(255,255,255,0.08)",
                boxShadow: active ? `0 0 28px rgba(0,240,255,0.45)` : "none",
              }}
              className="border-2 p-3 bg-black"
              style={{ borderRadius: 0 }}
            >
              <div className="text-[10px] tracking-[0.3em] uppercase font-black" style={{ color: active ? CYAN : "rgba(255,255,255,0.4)", fontFamily: MONO }}>
                {t.name}
              </div>
              <div className="text-white/60 text-[11px] mt-1" style={{ fontFamily: MONO }}>
                {t.maxProjects === Infinity ? "∞" : `≤ ${t.maxProjects}`} projects
              </div>
              {active && (
                <div
                  className="mt-2 text-[9px] font-black tracking-[0.3em] uppercase"
                  style={{ color: GREEN, fontFamily: MONO }}
                >
                  ◉ Mathematically Best
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Comparison Table ─────────────────────────────────────────────────────────
const COMPARE_ROWS: Array<{ feature: string; nazai: string | true; durable: string | false; highlight?: boolean }> = [
  { feature: "Active projects", nazai: "Unlimited", durable: "Limited" },
  { feature: "Agentic workflows", nazai: true, durable: false, highlight: true },
  { feature: "Self-healing SEO", nazai: true, durable: false, highlight: true },
  { feature: "CEO Decision Engine", nazai: true, durable: false, highlight: true },
  { feature: "Landing page generation", nazai: true, durable: true },
  { feature: "Vercel-edge deploy", nazai: "Native", durable: "Manual" },
  { feature: "Founder support", nazai: "Direct", durable: "Ticket" },
];

const ComparisonTable = () => (
  <div className="mt-20 max-w-5xl mx-auto">
    <div className="text-center mb-8">
      <span className="text-[10px] tracking-[0.5em] uppercase font-black" style={{ color: CYAN, fontFamily: MONO }}>
        Head-to-head
      </span>
      <h3 className="text-3xl md:text-4xl font-black text-white mt-3" style={{ fontFamily: SANS }}>
        NazAI vs Durable.
      </h3>
    </div>

    <div className="border-2 bg-black" style={{ borderColor: CYAN, borderRadius: 0 }}>
      {/* Header */}
      <div
        className="grid grid-cols-3 px-4 md:px-6 py-3 text-[10px] tracking-[0.3em] uppercase font-black border-b-2"
        style={{ borderColor: CYAN_DIM, fontFamily: MONO, color: CYAN }}
      >
        <div>Feature</div>
        <div className="text-center">NazAI</div>
        <div className="text-center text-white/40">Durable</div>
      </div>

      {COMPARE_ROWS.map((row, i) => (
        <div
          key={row.feature}
          className="grid grid-cols-3 items-center px-4 md:px-6 py-4 border-b border-white/5 last:border-b-0 relative"
          style={{
            // Obsidian frosted-glass row
            background:
              i % 2 === 0
                ? "linear-gradient(180deg, rgba(10,13,20,0.7), rgba(0,0,0,0.85))"
                : "linear-gradient(180deg, rgba(6,10,18,0.55), rgba(0,0,0,0.75))",
            backdropFilter: "blur(10px) saturate(140%)",
            WebkitBackdropFilter: "blur(10px) saturate(140%)",
          }}
        >
          {row.highlight && (
            <div
              aria-hidden
              className="absolute left-0 top-0 bottom-0 w-[3px]"
              style={{ background: CYAN, boxShadow: `0 0 10px ${CYAN}` }}
            />
          )}
          <div className="text-white text-sm font-semibold" style={{ fontFamily: SANS }}>
            {row.feature}
            {row.highlight && (
              <span
                className="ml-2 align-middle inline-block px-1.5 py-0.5 text-[8px] font-black tracking-[0.25em] border"
                style={{ color: CYAN, borderColor: CYAN_DIM, fontFamily: MONO }}
              >
                NAZAI-ONLY
              </span>
            )}
          </div>
          <div className="text-center">
            {row.nazai === true ? (
              <Check className="inline" size={18} style={{ color: CYAN }} />
            ) : (
              <span className="text-white text-sm font-bold" style={{ fontFamily: MONO }}>
                {row.nazai}
              </span>
            )}
          </div>
          <div className="text-center">
            {row.durable === false ? (
              <X className="inline text-white/25" size={18} />
            ) : row.durable === true ? (
              <Check className="inline text-white/40" size={18} />
            ) : (
              <span className="text-white/40 text-sm" style={{ fontFamily: MONO }}>
                {row.durable}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Billing Toggle ───────────────────────────────────────────────────────────
const BillingToggle = ({ cycle, onChange }: { cycle: BillingCycle; onChange: (c: BillingCycle) => void }) => (
  <div
    className="relative inline-flex border-2 bg-black select-none"
    style={{ borderColor: CYAN, borderRadius: 0 }}
  >
    <motion.div
      aria-hidden
      className="absolute top-0 bottom-0"
      style={{ background: CYAN, boxShadow: `0 0 24px ${CYAN}` }}
      animate={{ left: cycle === "monthly" ? 0 : "50%", right: cycle === "monthly" ? "50%" : 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    />
    {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
      <button
        key={c}
        onClick={() => onChange(c)}
        className="relative z-10 px-5 md:px-7 py-2.5 text-[11px] font-black tracking-[0.3em] uppercase transition-colors"
        style={{
          fontFamily: MONO,
          color: cycle === c ? "#000" : "#fff",
          mixBlendMode: cycle === c ? "difference" : "normal",
        }}
      >
        {c}
        {c === "yearly" && (
          <span
            className="ml-2 inline-block px-1.5 py-0.5 text-[8px] border"
            style={{ borderColor: cycle === c ? "#000" : CYAN_DIM, color: cycle === c ? "#000" : CYAN }}
          >
            −24%
          </span>
        )}
      </button>
    ))}
  </div>
);

// ─── Price Card ───────────────────────────────────────────────────────────────
const PriceCard = ({
  tier,
  cycle,
  isBest,
  onOpenFounder,
}: {
  tier: Tier;
  cycle: BillingCycle;
  isBest: boolean;
  onOpenFounder: () => void;
}) => {
  const Icon = tier.icon;
  const price = cycle === "yearly" ? tier.yearly : tier.monthly;

  return (
    <TiltCard
      featured={tier.featured}
      className="relative bg-black border-2 p-6 md:p-7 flex flex-col"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          border: `2px solid ${tier.featured ? CYAN : CYAN_DIM}`,
          borderRadius: 0,
        }}
      />

      {/* Featured / Best tag */}
      <div className="absolute -top-3 left-4 flex items-center gap-2">
        {tier.featured && (
          <span
            className="px-2 py-0.5 text-[9px] font-black tracking-[0.3em] uppercase bg-black"
            style={{ color: CYAN, border: `2px solid ${CYAN}`, fontFamily: MONO }}
          >
            Most Kinetic
          </span>
        )}
        {isBest && !tier.featured && (
          <span
            className="px-2 py-0.5 text-[9px] font-black tracking-[0.3em] uppercase bg-black"
            style={{ color: GREEN, border: `2px solid ${GREEN}`, fontFamily: MONO }}
          >
            Best for You
          </span>
        )}
      </div>

      {/* Head */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-9 h-9 flex items-center justify-center border-2"
          style={{ borderColor: CYAN_DIM, color: CYAN, borderRadius: 0 }}
        >
          <Icon size={18} />
        </div>
        <div>
          <div className="text-white text-xl font-black tracking-tight" style={{ fontFamily: SANS }}>
            {tier.name}
          </div>
          <div className="text-[10px] text-white/50 tracking-[0.25em] uppercase font-bold" style={{ fontFamily: MONO }}>
            {tier.tagline}
          </div>
        </div>
      </div>

      {/* Price */}
      <div className="mt-4 flex items-end gap-2">
        <RollingPrice value={price} />
        <span className="text-xs text-white/40 pb-2" style={{ fontFamily: MONO }}>
          /mo {cycle === "yearly" ? "· billed yearly" : ""}
        </span>
      </div>

      {/* Features */}
      <ul className="mt-6 space-y-2.5 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px] text-white/80" style={{ fontFamily: SANS }}>
            <Check size={14} className="mt-[3px] shrink-0" style={{ color: CYAN }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Monolith extras */}
      {tier.id === "monolith" && (
        <>
          <LiveTerminal />
          <div className="mt-4 flex items-center gap-2">
            <VercelBadge />
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 border-2 text-[9px] tracking-[0.3em] uppercase font-black text-white/80"
              style={{ borderColor: CYAN_DIM, fontFamily: MONO, borderRadius: 0 }}
            >
              <ShieldCheck size={10} style={{ color: CYAN }} /> 99.99% SLA
            </span>
          </div>
        </>
      )}

      {/* CTA row */}
      <div className="mt-6 flex items-stretch gap-2">
        <button
          className="flex-1 py-3 text-[11px] font-black tracking-[0.3em] uppercase transition-all border-2"
          style={{
            fontFamily: MONO,
            background: tier.featured ? CYAN : "#000",
            color: tier.featured ? "#000" : CYAN,
            borderColor: CYAN,
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 24px ${CYAN}`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
          }}
        >
          <span className="inline-flex items-center gap-2 justify-center">
            <Rocket size={12} /> {tier.cta}
          </span>
        </button>
        <button
          onClick={onOpenFounder}
          aria-label="Watch founder-mode video"
          title="Founder Mode · raw video"
          className="px-3 border-2 flex items-center justify-center gap-1.5 text-[10px] font-black tracking-[0.2em] uppercase text-white/80 hover:text-white transition-colors"
          style={{ borderColor: CYAN_DIM, fontFamily: MONO, borderRadius: 0 }}
        >
          <PlayCircle size={14} style={{ color: CYAN }} />
          <span className="hidden md:inline">Founder</span>
        </button>
      </div>
    </TiltCard>
  );
};

// ─── Main Export ──────────────────────────────────────────────────────────────
const PricingEngine = () => {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [projects, setProjects] = useState(8);
  const [founderOpen, setFounderOpen] = useState(false);

  const best = useMemo(() => bestPlanFor(projects), [projects]);

  return (
    <section
      id="pricing"
      className="relative py-24 md:py-32 px-6 md:px-8 scroll-mt-20"
      style={{ background: "#000000", fontFamily: SANS }}
    >
      {/* Section grid backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(${CYAN} 1px, transparent 1px), linear-gradient(90deg, ${CYAN} 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-10">
          <span
            className="text-[10px] tracking-[0.5em] uppercase font-black inline-block mb-4"
            style={{ color: CYAN, fontFamily: MONO, textShadow: `0 0 12px ${CYAN_DIM}` }}
          >
            // Pricing Engine · v1.1
          </span>
          <h2
            className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-4"
            style={{ fontFamily: SANS }}
          >
            Pay for outcomes,<br />
            <span style={{ color: CYAN, textShadow: `0 0 20px ${CYAN_DIM}` }}>not for tools.</span>
          </h2>
          <p className="text-sm md:text-base text-white/60 max-w-2xl mx-auto leading-relaxed">
            Three tiers engineered for the three speeds of founder chaos. Toggle yearly to save 24%.
            Slide below to let the math pick your plan.
          </p>
        </div>

        {/* Toggle */}
        <div className="flex justify-center mb-12">
          <BillingToggle cycle={cycle} onChange={setCycle} />
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-3 gap-6 md:gap-5" style={{ perspective: 1200 }}>
          {TIERS.map((t) => (
            <PriceCard
              key={t.id}
              tier={t}
              cycle={cycle}
              isBest={best === t.id}
              onOpenFounder={() => setFounderOpen(true)}
            />
          ))}
        </div>

        {/* Slider */}
        <ProjectSlider projects={projects} setProjects={setProjects} best={best} cycle={cycle} />

        {/* Comparison Table */}
        <ComparisonTable />
      </div>

      {/* Founder modal */}
      <FounderModal open={founderOpen} onClose={() => setFounderOpen(false)} />
    </section>
  );
};

export default PricingEngine;
