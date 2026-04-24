import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Rocket, ShieldCheck, Zap, Search, TrendingUp } from "lucide-react";

/**
 * OrchestrationCinema — "Hyper-Space" website-build transition.
 *
 * Inspired by Durable.co's generation reveal: floating mini website preview
 * "thumbnails" drift in from the four edges of the pane and converge toward
 * a central browser-chromed frame. As they reach the center they pulse with
 * a cyan glow, then SHATTER into particles. A final cyan flash reveals the
 * generated website locking into place beneath the overlay.
 *
 * Total runtime ≤ 3s (per design brief — "Flash of Genius, not a movie").
 */

interface OrchestrationCinemaProps {
  /** Show/hide the cinematic overlay. */
  active: boolean;
}

type ThumbCard = {
  id: string;
  /** origin edge unit: one of x or y is ±1.1 */
  fromX: number;
  fromY: number;
  rotate: number;
  delay: number;
  hue: string; // accent color of the floating card
  title: string;
  blocks: { w: number; h: number }[];
  hasImage: boolean;
};

const FEEDBACK_CHIPS: { label: string; Icon: React.ElementType; color: string }[] = [
  { label: "SEO Optimized", Icon: Search, color: "#06b6d4" },
  { label: "Conversion-Ready", Icon: TrendingUp, color: "#22c55e" },
  { label: "Edge Cached", Icon: Zap, color: "#06b6d4" },
  { label: "A11y Verified", Icon: ShieldCheck, color: "#a78bfa" },
  { label: "Lighthouse 98", Icon: Rocket, color: "#f59e0b" },
  { label: "Pixel Perfect", Icon: Sparkles, color: "#06b6d4" },
];

const CARD_PRESETS: Omit<ThumbCard, "id" | "fromX" | "fromY" | "delay">[] = [
  {
    rotate: -6,
    hue: "#b45309",
    title: "Atelier",
    blocks: [{ w: 70, h: 6 }, { w: 50, h: 4 }],
    hasImage: true,
  },
  {
    rotate: 5,
    hue: "#065f46",
    title: "Bloom Studio",
    blocks: [{ w: 60, h: 6 }, { w: 80, h: 4 }],
    hasImage: true,
  },
  {
    rotate: -4,
    hue: "#1e3a8a",
    title: "Northwind",
    blocks: [{ w: 50, h: 6 }, { w: 70, h: 4 }],
    hasImage: false,
  },
  {
    rotate: 8,
    hue: "#7c2d12",
    title: "Forge & Co.",
    blocks: [{ w: 80, h: 6 }, { w: 40, h: 4 }],
    hasImage: true,
  },
  {
    rotate: -3,
    hue: "#581c87",
    title: "Lumen Labs",
    blocks: [{ w: 60, h: 6 }, { w: 60, h: 4 }],
    hasImage: false,
  },
  {
    rotate: 6,
    hue: "#0f766e",
    title: "Tidehouse",
    blocks: [{ w: 70, h: 6 }, { w: 50, h: 4 }],
    hasImage: true,
  },
];

const buildCards = (): ThumbCard[] => {
  // 6 cards — 2 per side (left, right, top split between top-left & top-right corners)
  const positions = [
    { fromX: -1.15, fromY: -0.55 }, // top-left
    { fromX: 1.15, fromY: -0.5 },   // top-right
    { fromX: -1.2, fromY: 0.55 },    // bottom-left
    { fromX: 1.2, fromY: 0.6 },      // bottom-right
    { fromX: -1.05, fromY: 0.05 },   // mid-left
    { fromX: 1.05, fromY: -0.05 },   // mid-right
  ];
  return CARD_PRESETS.map((preset, i) => ({
    ...preset,
    id: `card-${i}`,
    fromX: positions[i].fromX,
    fromY: positions[i].fromY,
    delay: 0.05 + i * 0.08,
  }));
};

const PARTICLE_COUNT = 28;

const OrchestrationCinema: React.FC<OrchestrationCinemaProps> = ({ active }) => {
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    if (active) setSeed((s) => s + 1);
  }, [active]);
  const cards = useMemo(() => buildCards(), [seed]);

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }).map((_, i) => ({
        id: `p-${i}`,
        angle: (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.4,
        distance: 140 + Math.random() * 180,
        size: 2 + Math.random() * 3,
        delay: 2.0 + Math.random() * 0.15,
      })),
    [seed]
  );

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`cinema-${seed}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none absolute inset-0 z-50 overflow-hidden flex items-center justify-center"
          style={{
            background:
              "radial-gradient(circle at center, rgba(6,182,212,0.22) 0%, rgba(2,6,23,0.96) 42%, rgba(2,6,23,1) 78%)",
            backdropFilter: "blur(48px) saturate(140%)",
            WebkitBackdropFilter: "blur(48px) saturate(140%)",
          }}
          aria-hidden
        >
          {/* Black-hole accretion ring — perfectly centered, slowly rotating */}
          <motion.div
            initial={{ opacity: 0, scale: 0.6, rotate: 0 }}
            animate={{ opacity: [0, 0.55, 0.35], scale: [0.6, 1.1, 1], rotate: 360 }}
            transition={{
              opacity: { duration: 2.6, ease: "easeOut" },
              scale: { duration: 2.6, ease: "easeOut" },
              rotate: { duration: 6, repeat: Infinity, ease: "linear" },
            }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: "min(72%, 520px)",
              aspectRatio: "1 / 1",
              background:
                "conic-gradient(from 0deg, rgba(6,182,212,0) 0deg, rgba(6,182,212,0.55) 90deg, rgba(139,92,246,0.45) 180deg, rgba(6,182,212,0.55) 270deg, rgba(6,182,212,0) 360deg)",
              maskImage:
                "radial-gradient(circle at center, transparent 38%, black 46%, black 58%, transparent 66%)",
              WebkitMaskImage:
                "radial-gradient(circle at center, transparent 38%, black 46%, black 58%, transparent 66%)",
            }}
          />

          {/* Hyperspace grid */}
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(6,182,212,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.22) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
              WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          />

          {/* Radial speed-lines emanating from center */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [0, 0.6, 0.3], scale: [0.9, 1.05, 1] }}
            transition={{ duration: 2.6, ease: "easeOut" }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] h-[140%]"
            style={{
              background:
                "repeating-conic-gradient(from 0deg, rgba(6,182,212,0.0) 0deg, rgba(6,182,212,0.18) 2deg, rgba(6,182,212,0.0) 6deg)",
              maskImage:
                "radial-gradient(circle at center, transparent 80px, black 200px, transparent 70%)",
            }}
          />

          {/* Center browser frame target — cyan glowing wireframe */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: [0.8, 1, 1.02], opacity: [0, 1, 1] }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: "min(56%, 380px)" }}
          >
            <div
              className="rounded-xl overflow-hidden border"
              style={{
                borderColor: "rgba(6,182,212,0.55)",
                background: "rgba(255,255,255,0.97)",
                boxShadow:
                  "0 0 0 1px rgba(6,182,212,0.35), 0 0 60px rgba(6,182,212,0.45), 0 20px 80px rgba(6,182,212,0.25)",
              }}
            >
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 mx-2 px-2.5 py-1 rounded-full bg-zinc-100 text-[10px] font-mono text-zinc-400">
                  yourwebsite.com
                </div>
                <motion.div
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.1, repeat: Infinity }}
                  className="px-2 py-1 rounded-full border border-zinc-200 text-[9px] font-mono text-zinc-500"
                >
                  Generating
                </motion.div>
              </div>
              {/* Skeleton body */}
              <div className="p-4 space-y-2.5 min-h-[180px]">
                <motion.div
                  initial={{ width: "30%" }}
                  animate={{ width: ["30%", "65%", "55%"] }}
                  transition={{ duration: 2.4, ease: "easeOut" }}
                  className="h-3 rounded bg-zinc-200"
                />
                <motion.div
                  initial={{ width: "20%" }}
                  animate={{ width: ["20%", "85%", "78%"] }}
                  transition={{ duration: 2.4, delay: 0.15, ease: "easeOut" }}
                  className="h-3 rounded bg-zinc-200"
                />
                <div className="h-2" />
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.6, 0.9] }}
                  transition={{ duration: 2, delay: 0.3 }}
                  className="h-16 rounded bg-gradient-to-br from-zinc-100 to-zinc-200"
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.6 + i * 0.1 }}
                      className="h-8 rounded bg-zinc-100"
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Floating mini website preview cards drifting in from edges */}
          {cards.map((c) => {
            const travelX = c.fromX * 360;
            const travelY = c.fromY * 240;
            return (
              <motion.div
                key={c.id}
                initial={{ x: travelX, y: travelY, opacity: 0, scale: 0.5, rotate: c.rotate * 2 }}
                animate={{
                  x: [travelX, travelX * 0.4, 0],
                  y: [travelY, travelY * 0.4, 0],
                  opacity: [0, 1, 1, 0],
                  scale: [0.5, 0.85, 0.55, 0.3],
                  rotate: [c.rotate * 2, c.rotate, 0],
                }}
                transition={{
                  duration: 2.4,
                  delay: c.delay,
                  times: [0, 0.45, 0.85, 1],
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute left-1/2 top-1/2"
                style={{ translateX: "-50%", translateY: "-50%" }}
              >
                <div
                  className="rounded-lg overflow-hidden bg-white"
                  style={{
                    width: 150,
                    boxShadow:
                      "0 0 0 1px rgba(6,182,212,0.4), 0 0 28px rgba(6,182,212,0.55), 0 12px 30px rgba(0,0,0,0.4)",
                  }}
                >
                  {c.hasImage && (
                    <div
                      className="h-14 w-full"
                      style={{
                        background: `linear-gradient(135deg, ${c.hue} 0%, ${c.hue}aa 100%)`,
                      }}
                    >
                      <div className="h-full w-full flex items-end p-1.5">
                        <div
                          className="text-[8px] font-bold text-white/90 leading-tight"
                          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
                        >
                          {c.title}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="p-2 space-y-1">
                    {!c.hasImage && (
                      <div
                        className="text-[8px] font-bold leading-tight mb-1"
                        style={{ color: c.hue }}
                      >
                        {c.title}
                      </div>
                    )}
                    {c.blocks.map((b, i) => (
                      <div
                        key={i}
                        className="rounded-sm bg-zinc-200"
                        style={{ width: `${b.w}%`, height: b.h }}
                      />
                    ))}
                    <div
                      className="mt-1 inline-block rounded-sm px-1 py-[1px] text-[6px] font-bold text-white"
                      style={{ background: c.hue }}
                    >
                      Visit
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {/* Feedback chips orbiting in */}
          {FEEDBACK_CHIPS.map((chip, i) => {
            const angle = (i / FEEDBACK_CHIPS.length) * Math.PI * 2;
            const r = 220;
            const startX = Math.cos(angle) * r * 1.6;
            const startY = Math.sin(angle) * r * 1.6;
            const restX = Math.cos(angle) * r * 0.95;
            const restY = Math.sin(angle) * r * 0.55;
            const Icon = chip.Icon;
            return (
              <motion.div
                key={chip.label}
                initial={{ x: startX, y: startY, opacity: 0, scale: 0.6 }}
                animate={{
                  x: [startX, restX, restX, 0],
                  y: [startY, restY, restY, 0],
                  opacity: [0, 1, 1, 0],
                  scale: [0.6, 1, 1, 0.4],
                }}
                transition={{
                  duration: 2.5,
                  delay: 0.5 + i * 0.08,
                  times: [0, 0.4, 0.8, 1],
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute left-1/2 top-1/2"
                style={{ translateX: "-50%", translateY: "-50%" }}
              >
                <div
                  className="px-2.5 py-1 rounded-full flex items-center gap-1.5 font-mono text-[10px] font-medium whitespace-nowrap backdrop-blur-sm"
                  style={{
                    background: `${chip.color}1f`,
                    border: `1px solid ${chip.color}66`,
                    color: chip.color,
                    boxShadow: `0 0 18px ${chip.color}55`,
                  }}
                >
                  <Icon size={10} />
                  {chip.label}
                </div>
              </motion.div>
            );
          })}

          {/* SHATTER particles — burst from center near the end */}
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
              animate={{
                x: Math.cos(p.angle) * p.distance,
                y: Math.sin(p.angle) * p.distance,
                opacity: [0, 1, 0],
                scale: [0, 1, 0.2],
              }}
              transition={{
                duration: 0.8,
                delay: p.delay,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: p.size,
                height: p.size,
                background: "#06b6d4",
                boxShadow: "0 0 8px #06b6d4, 0 0 16px rgba(6,182,212,0.6)",
              }}
            />
          ))}

          {/* Status caption — bottom */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center pointer-events-none">
            <div className="text-[10px] font-mono tracking-[0.32em] uppercase text-cyan-300 mb-1">
              NazAI · Hyper-Space
            </div>
            <motion.div
              key={seed}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="text-[11px] font-mono text-zinc-300"
            >
              Fusing components into final layout
            </motion.div>
          </div>

          {/* Final "lock-in" cyan flash — fires near the end */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 0.95, 0] }}
            transition={{ duration: 0.9, delay: 2.2, times: [0, 0.3, 0.55, 1] }}
            className="absolute inset-0"
            style={{ background: "rgba(6,182,212,0.28)" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OrchestrationCinema;
