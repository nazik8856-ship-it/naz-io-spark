import React, { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, animate, AnimatePresence } from "framer-motion";
import { Sparkles, Zap } from "lucide-react";

/**
 * SubscriptionVacuum
 * Centripetal-force animation: orbiting cost cards get pulled into a central
 * Core, which then expands into a single Growth Plan card. A savings counter
 * rolls up to display the total monthly savings.
 *
 * Trigger: IntersectionObserver (threshold 0.6) via framer-motion useInView.
 * Phase A — idle: low-intensity sine-wave float around orbit positions.
 * Phase B — triggered: spring (high stiffness) pulls cards to (0,0).
 * Phase C — outcome: scale-up Core + number-counter for price + savings.
 */

type Cost = {
  label: string;
  price: number; // monthly $
  hue: string; // accent color
  angle: number; // initial orbit angle (deg)
};

const COSTS: Cost[] = [
  { label: "CRM",          price: 50,  hue: "#06b6d4", angle: 0 },
  { label: "SEO Suite",    price: 200, hue: "#8b5cf6", angle: 60 },
  { label: "AI Images",    price: 30,  hue: "#06b6d4", angle: 120 },
  { label: "Hosting",      price: 25,  hue: "#8b5cf6", angle: 180 },
  { label: "Email Tool",   price: 40,  hue: "#06b6d4", angle: 240 },
  { label: "Analytics",    price: 60,  hue: "#8b5cf6", angle: 300 },
];

const FINAL_PRICE = 25;
const TOTAL_OLD = COSTS.reduce((s, c) => s + c.price, 0); // 405
const SAVINGS = TOTAL_OLD - FINAL_PRICE; // 380

// Counter that animates from `from` to `to` over `duration` seconds when `play` becomes true.
const Counter: React.FC<{ from: number; to: number; duration?: number; play: boolean; prefix?: string }> = ({
  from,
  to,
  duration = 1.4,
  play,
  prefix = "$",
}) => {
  const mv = useMotionValue(from);
  const [display, setDisplay] = useState(from);

  useEffect(() => {
    if (!play) return;
    const controls = animate(mv, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [play, to, duration, mv]);

  return (
    <span>
      {prefix}
      {display.toLocaleString()}
    </span>
  );
};

const SubscriptionVacuum: React.FC = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  // threshold 0.6 via amount: 0.6
  const inView = useInView(sectionRef, { amount: 0.6, once: true });
  const [phase, setPhase] = useState<"idle" | "pulling" | "merged">("idle");
  const [showReplay, setShowReplay] = useState(false);

  useEffect(() => {
    if (inView && phase === "idle") {
      setPhase("pulling");
      const t1 = setTimeout(() => setPhase("merged"), 1100);
      const t2 = setTimeout(() => setShowReplay(true), 2400);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [inView, phase]);

  const replay = () => {
    setShowReplay(false);
    setPhase("idle");
    setTimeout(() => {
      setPhase("pulling");
      setTimeout(() => setPhase("merged"), 1100);
      setTimeout(() => setShowReplay(true), 2400);
    }, 600);
  };

  // Responsive orbit radius
  const RADIUS_DESKTOP = 220;
  const RADIUS_MOBILE = 130;

  return (
    <section
      ref={sectionRef}
      id="subscription-vacuum"
      className="relative w-full overflow-hidden px-6 md:px-8 py-24 md:py-32"
      style={{ background: "#020617" }}
      aria-label="Replace multiple subscriptions with one solution"
    >
      {/* Subtle background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-30"
          style={{
            background:
              "radial-gradient(circle, rgba(6,182,212,0.12) 0%, rgba(139,92,246,0.06) 40%, transparent 70%)",
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-mono tracking-[0.2em] uppercase mb-5"
            style={{
              background: "rgba(6,182,212,0.06)",
              border: "1px solid rgba(6,182,212,0.2)",
              color: "#06b6d4",
            }}
          >
            <Sparkles size={11} />
            Subscription Vacuum
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-4"
          >
            Replace your stack.{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Keep the results.
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-base md:text-lg text-white/60 max-w-2xl mx-auto"
          >
            Six tools. Six bills. One platform. Watch what happens when NazAI consolidates everything you're paying for.
          </motion.p>
        </div>

        {/* Animation stage */}
        <div
          className="relative mx-auto h-[420px] md:h-[560px] w-full max-w-[680px]"
          aria-hidden="true"
        >
          {/* Concentric orbit rings (visual guides) */}
          <AnimatePresence>
            {phase === "idle" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
                className="absolute inset-0 pointer-events-none"
              >
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block w-[440px] h-[440px] rounded-full border border-white/[0.04]" />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 md:hidden w-[260px] h-[260px] rounded-full border border-white/[0.04]" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Orbiting cost cards */}
          <AnimatePresence>
            {phase !== "merged" &&
              COSTS.map((cost, i) => {
                const rad = (cost.angle * Math.PI) / 180;
                // We position absolutely at center and translate via motion x/y
                const targetX =
                  phase === "pulling"
                    ? 0
                    : Math.cos(rad) * (typeof window !== "undefined" && window.innerWidth < 768 ? RADIUS_MOBILE : RADIUS_DESKTOP);
                const targetY =
                  phase === "pulling"
                    ? 0
                    : Math.sin(rad) * (typeof window !== "undefined" && window.innerWidth < 768 ? RADIUS_MOBILE : RADIUS_DESKTOP);

                return (
                  <motion.div
                    key={cost.label}
                    initial={{ opacity: 0, scale: 0.6, x: 0, y: 0 }}
                    animate={
                      phase === "pulling"
                        ? {
                            opacity: 0,
                            scale: 0.2,
                            x: 0,
                            y: 0,
                            rotate: 180,
                            transition: {
                              type: "spring",
                              stiffness: 220,
                              damping: 22,
                              delay: i * 0.04,
                            },
                          }
                        : {
                            opacity: 1,
                            scale: 1,
                            x: [targetX, targetX + 6, targetX - 4, targetX],
                            y: [targetY, targetY - 8, targetY + 6, targetY],
                            transition: {
                              opacity: { duration: 0.5, delay: 0.1 + i * 0.06 },
                              scale: { duration: 0.5, delay: 0.1 + i * 0.06 },
                              x: { duration: 6 + i * 0.4, repeat: Infinity, ease: "easeInOut" },
                              y: { duration: 7 + i * 0.3, repeat: Infinity, ease: "easeInOut" },
                            },
                          }
                    }
                    exit={{ opacity: 0, scale: 0.2 }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none"
                  >
                    <div
                      className="px-3 py-2 md:px-4 md:py-2.5 rounded-xl backdrop-blur-md"
                      style={{
                        background: `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))`,
                        border: `1px solid ${cost.hue}33`,
                        boxShadow: `0 0 20px ${cost.hue}1a, inset 0 1px 0 rgba(255,255,255,0.04)`,
                        minWidth: 96,
                      }}
                    >
                      <div className="text-[9px] md:text-[10px] font-mono tracking-[0.18em] uppercase text-white/50">
                        {cost.label}
                      </div>
                      <div
                        className="text-base md:text-lg font-bold tabular-nums"
                        style={{ color: cost.hue }}
                      >
                        ${cost.price}
                        <span className="text-[10px] md:text-xs text-white/40 font-normal">/mo</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
          </AnimatePresence>

          {/* CORE — central node */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{
              scale: phase === "merged" ? 1 : phase === "pulling" ? [1, 1.25, 1.05] : 1,
              opacity: 1,
            }}
            transition={{
              scale:
                phase === "pulling"
                  ? { duration: 1.1, times: [0, 0.7, 1], ease: "easeOut" }
                  : { type: "spring", stiffness: 200, damping: 18 },
              opacity: { duration: 0.6 },
            }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            {/* Core glow halo */}
            <motion.div
              animate={{
                opacity: phase === "pulling" ? [0.4, 1, 0.7] : phase === "merged" ? 0.6 : 0.3,
              }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[260px] h-[260px] md:w-[340px] md:h-[340px] rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(6,182,212,0.35) 0%, rgba(139,92,246,0.18) 40%, transparent 70%)",
                filter: "blur(20px)",
              }}
            />

            {/* Core / merged plan */}
            <AnimatePresence mode="wait">
              {phase !== "merged" ? (
                <motion.div
                  key="core"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.4 }}
                  className="relative w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center"
                  style={{
                    background:
                      "radial-gradient(circle at 30% 30%, rgba(6,182,212,0.4), rgba(2,6,23,0.95))",
                    border: "1px solid rgba(6,182,212,0.5)",
                    boxShadow:
                      "0 0 60px rgba(6,182,212,0.4), inset 0 0 30px rgba(6,182,212,0.15)",
                  }}
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-2 rounded-full border border-dashed border-cyan-400/30"
                  />
                  <Zap
                    size={28}
                    className="md:hidden"
                    style={{ color: "#06b6d4", filter: "drop-shadow(0 0 8px #06b6d4)" }}
                  />
                  <Zap
                    size={36}
                    className="hidden md:block"
                    style={{ color: "#06b6d4", filter: "drop-shadow(0 0 8px #06b6d4)" }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="plan"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                  className="relative rounded-2xl overflow-hidden"
                  style={{
                    width: "min(420px, 90vw)",
                    background:
                      "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(139,92,246,0.06))",
                    border: "1px solid rgba(6,182,212,0.35)",
                    boxShadow:
                      "0 30px 80px -20px rgba(6,182,212,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
                    backdropFilter: "blur(20px)",
                  }}
                >
                  <div
                    className="px-5 py-2.5 flex items-center justify-between"
                    style={{
                      background: "rgba(6,182,212,0.08)",
                      borderBottom: "1px solid rgba(6,182,212,0.2)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: "#06b6d4", boxShadow: "0 0 8px #06b6d4" }}
                      />
                      <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-cyan-300/90">
                        NazAI · Growth Plan
                      </span>
                    </div>
                    <span className="text-[9px] font-mono text-white/40">ACTIVE</span>
                  </div>

                  <div className="px-6 py-7">
                    <div className="flex items-baseline gap-2 mb-1">
                      <div className="text-5xl md:text-6xl font-bold text-white tabular-nums">
                        <Counter from={0} to={FINAL_PRICE} play={phase === "merged"} />
                      </div>
                      <div className="text-sm text-white/50">/ month</div>
                    </div>
                    <div className="text-xs text-white/50 mb-5">
                      Replaces every tool above. One bill, one login, one team.
                    </div>

                    <div
                      className="rounded-xl px-4 py-3 flex items-center justify-between"
                      style={{
                        background: "rgba(6,182,212,0.06)",
                        border: "1px dashed rgba(6,182,212,0.3)",
                      }}
                    >
                      <div>
                        <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/50">
                          Savings tracker
                        </div>
                        <div
                          className="text-2xl font-bold tabular-nums"
                          style={{
                            background: "linear-gradient(135deg, #06b6d4, #8b5cf6)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            backgroundClip: "text",
                          }}
                        >
                          <Counter from={0} to={SAVINGS} play={phase === "merged"} duration={1.8} />
                          <span className="text-xs text-white/40 font-normal ml-1">/ mo</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/50">
                          Per year
                        </div>
                        <div className="text-lg font-bold text-white tabular-nums">
                          <Counter
                            from={0}
                            to={SAVINGS * 12}
                            play={phase === "merged"}
                            duration={2.2}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Footer controls */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <AnimatePresence>
            {showReplay && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                onClick={replay}
                className="px-5 py-2 rounded-full text-xs font-mono tracking-[0.18em] uppercase transition-all"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(6,182,212,0.3)",
                  color: "#06b6d4",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(6,182,212,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
              >
                ↻ Replay Consolidation
              </motion.button>
            )}
          </AnimatePresence>
          <p className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30">
            Total stack cost: ${TOTAL_OLD}/mo · NazAI: ${FINAL_PRICE}/mo
          </p>
        </div>
      </div>
    </section>
  );
};

export default SubscriptionVacuum;
