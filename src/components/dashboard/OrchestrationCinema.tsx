import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Code2, Layout, Sparkles, Rocket, ShieldCheck, Zap, Search } from "lucide-react";

/**
 * OrchestrationCinema
 *
 * A fast (≤3s) "Hyper-Space" transition that plays inside the
 * WebsiteRevealPane preview area while NazAI is generating a website.
 *
 * Visual: code snippets, UI wireframe blocks, and positive-feedback chips
 * fly in from all four edges, pulse with a cyan glow, then shatter / drop
 * into the final website layout. The overlay fades out as the staged
 * skeleton-to-live reveal takes over.
 *
 * Constraints (per design brief):
 *  • Total runtime ≤ 3s — must never block the user.
 *  • Purely presentational — drives off the `active` prop.
 *  • No global side effects.
 */

interface OrchestrationCinemaProps {
  /** Show/hide the cinematic overlay. Parent should flip this off after the build settles. */
  active: boolean;
}

type FlyerKind = "code" | "wireframe" | "chip";
type Flyer = {
  id: string;
  kind: FlyerKind;
  label: string;
  Icon?: React.ElementType;
  // origin edge: -1..1 from center on each axis (one axis is ±1)
  fromX: number;
  fromY: number;
  delay: number;
};

const CODE_SNIPPETS = [
  "<Hero />",
  "useState()",
  "/* tailwind */",
  "export default",
  "<section>",
  "fetch('/api')",
  "z-index: 50",
  "supabase.from()",
];

const WIREFRAME_LABELS = [
  "Header",
  "Hero",
  "Features",
  "Pricing",
  "CTA",
  "Footer",
];

const FEEDBACK_CHIPS: { label: string; Icon: React.ElementType }[] = [
  { label: "SEO Optimized", Icon: Search },
  { label: "High Conversion UI", Icon: Sparkles },
  { label: "Edge Cached", Icon: Zap },
  { label: "A11y Verified", Icon: ShieldCheck },
  { label: "Lighthouse 98", Icon: Rocket },
];

const buildFlyers = (): Flyer[] => {
  const flyers: Flyer[] = [];
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;
  const edge = () => {
    // pick one of 4 edges
    const e = Math.floor(Math.random() * 4);
    if (e === 0) return { fromX: -1.1, fromY: rand(-0.6, 0.6) }; // left
    if (e === 1) return { fromX: 1.1, fromY: rand(-0.6, 0.6) }; // right
    if (e === 2) return { fromX: rand(-0.6, 0.6), fromY: -1.1 }; // top
    return { fromX: rand(-0.6, 0.6), fromY: 1.1 }; // bottom
  };

  CODE_SNIPPETS.forEach((label, i) => {
    const o = edge();
    flyers.push({
      id: `c-${i}`,
      kind: "code",
      label,
      Icon: Code2,
      fromX: o.fromX,
      fromY: o.fromY,
      delay: 0.05 + i * 0.05,
    });
  });
  WIREFRAME_LABELS.forEach((label, i) => {
    const o = edge();
    flyers.push({
      id: `w-${i}`,
      kind: "wireframe",
      label,
      Icon: Layout,
      fromX: o.fromX,
      fromY: o.fromY,
      delay: 0.2 + i * 0.06,
    });
  });
  FEEDBACK_CHIPS.forEach(({ label, Icon }, i) => {
    const o = edge();
    flyers.push({
      id: `f-${i}`,
      kind: "chip",
      label,
      Icon,
      fromX: o.fromX,
      fromY: o.fromY,
      delay: 0.4 + i * 0.07,
    });
  });
  return flyers;
};

const OrchestrationCinema: React.FC<OrchestrationCinemaProps> = ({ active }) => {
  // Re-seed on each activation so the entrance feels fresh
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    if (active) setSeed((s) => s + 1);
  }, [active]);
  const flyers = useMemo(() => buildFlyers(), [seed]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`cinema-${seed}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(6,182,212,0.10) 0%, rgba(9,9,11,0.85) 55%, rgba(9,9,11,0.96) 100%)",
            backdropFilter: "blur(6px)",
          }}
          aria-hidden
        >
          {/* Hyperspace streak grid */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "linear-gradient(rgba(6,182,212,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.18) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              maskImage:
                "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          />

          {/* Center pulse */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: [0.6, 1.05, 0.95], opacity: [0, 0.9, 0.7] }}
            transition={{ duration: 1.4, ease: "easeOut", repeat: Infinity, repeatType: "mirror" }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <div
              className="w-24 h-24 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(6,182,212,0.55) 0%, rgba(6,182,212,0.05) 60%, transparent 80%)",
                boxShadow: "0 0 60px rgba(6,182,212,0.55)",
              }}
            />
          </motion.div>

          {/* Status caption */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 text-center">
            <div className="text-[10px] font-mono tracking-[0.32em] uppercase text-cyan-300 mb-1">
              NazAI · Hyper-Space
            </div>
            <div className="text-[11px] font-mono text-zinc-300">
              Fusing components into final layout
            </div>
          </div>

          {/* Flyers */}
          {flyers.map((f) => {
            const Icon = f.Icon;
            const isCode = f.kind === "code";
            const isChip = f.kind === "chip";
            const accent = isChip ? "#22c55e" : isCode ? "#06b6d4" : "#a78bfa";

            // travel distance roughly half the pane on whichever axis dominates
            const travelX = f.fromX * 360;
            const travelY = f.fromY * 220;

            return (
              <motion.div
                key={f.id}
                initial={{
                  x: travelX,
                  y: travelY,
                  opacity: 0,
                  scale: 0.6,
                  rotate: isCode ? -8 : 0,
                }}
                animate={{
                  x: [travelX, 0, 0],
                  y: [travelY, 0, 60],
                  opacity: [0, 1, 0],
                  scale: [0.6, 1, 0.4],
                  rotate: [isCode ? -8 : 0, 0, isCode ? 6 : 0],
                }}
                transition={{
                  duration: 2.2,
                  delay: f.delay,
                  times: [0, 0.55, 1],
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute left-1/2 top-1/2"
                style={{ translateX: "-50%", translateY: "-50%" }}
              >
                <div
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 font-mono text-[10px] tracking-wide whitespace-nowrap ${
                    isCode ? "uppercase" : ""
                  }`}
                  style={{
                    background: `${accent}14`,
                    border: `1px solid ${accent}55`,
                    color: accent,
                    boxShadow: `0 0 18px ${accent}55`,
                  }}
                >
                  {Icon && <Icon size={10} />}
                  {f.label}
                </div>
              </motion.div>
            );
          })}

          {/* Final "lock-in" flash — fires near the end */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.6, delay: 2.4, times: [0, 0.4, 1] }}
            className="absolute inset-0"
            style={{ background: "rgba(6,182,212,0.18)" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OrchestrationCinema;
