import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, useInView, useMotionValue, animate, AnimatePresence, PanInfo, useTransform } from "framer-motion";
import { Sparkles, Zap, TrendingUp } from "lucide-react";

/**
 * SubscriptionVacuum - Interactive Edition (FIXED)
 * 
 * Features:
 * - Smooth draggable cards with momentum
 * - Automatic spring return to orbit position
 * - No animation conflicts during drag
 */

type Cost = {
  label: string;
  price: number;
  hue: string;
  baseAngle: number;
};

const COSTS: Cost[] = [
  { label: "CRM", price: 50, hue: "#06b6d4", baseAngle: 0 },
  { label: "SEO Suite", price: 200, hue: "#8b5cf6", baseAngle: 60 },
  { label: "AI Images", price: 30, hue: "#06b6d4", baseAngle: 120 },
  { label: "Hosting", price: 25, hue: "#8b5cf6", baseAngle: 180 },
  { label: "Email Tool", price: 40, hue: "#06b6d4", baseAngle: 240 },
  { label: "Analytics", price: 60, hue: "#8b5cf6", baseAngle: 300 },
];

const FINAL_PRICE = 25;
const TOTAL_OLD = COSTS.reduce((s, c) => s + c.price, 0);
const SAVINGS = TOTAL_OLD - FINAL_PRICE;

// Counter component
const Counter: React.FC<{ from: number; to: number; play: boolean; prefix?: string }> = ({
  from,
  to,
  play,
  prefix = "$",
}) => {
  const mv = useMotionValue(from);
  const [display, setDisplay] = useState(from);

  useEffect(() => {
    if (!play) return;
    const controls = animate(mv, to, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [play, to, mv]);

  return <span>{prefix}{display.toLocaleString()}</span>;
};

// Individual draggable card - NO CONFLICTING ANIMATIONS
interface DraggableCardProps {
  cost: Cost;
  index: number;
  phase: "idle" | "pulling" | "merged";
  containerRef: React.RefObject<HTMLDivElement>;
  orbitRadius: number;
  orbitRotation: number;
  onDragStart: (index: number) => void;
  onDragEnd: (index: number) => void;
}

const DraggableCard: React.FC<DraggableCardProps> = ({
  cost,
  index,
  phase,
  containerRef,
  orbitRadius,
  orbitRotation,
  onDragStart,
  onDragEnd,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const controls = useMotionValue({ x: 0, y: 0 });
  
  // Calculate current orbital position based on rotation
  const currentAngle = (cost.baseAngle + orbitRotation) % 360;
  const rad = (currentAngle * Math.PI) / 180;
  const targetOrbitX = Math.cos(rad) * orbitRadius;
  const targetOrbitY = Math.sin(rad) * orbitRadius;

  // Handle drag events
  const handleDragStart = () => {
    setIsDragging(true);
    onDragStart(index);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onDragEnd(index);
  };

  // Determine visual state
  if (phase === "pulling") {
    return (
      <motion.div
        initial={{ x: targetOrbitX, y: targetOrbitY, opacity: 1, scale: 1 }}
        animate={{ x: 0, y: 0, opacity: 0, scale: 0.2, rotate: 180 }}
        transition={{ type: "spring", stiffness: 300, damping: 25, delay: index * 0.04 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <CardContent cost={cost} />
      </motion.div>
    );
  }

  if (phase === "merged") {
    return null;
  }

  // IDLE phase - draggable with spring return
  return (
    <motion.div
      drag
      dragMomentum={true}
      dragElastic={0.15}
      dragTransition={{ bounceStiffness: 400, bounceDamping: 25 }}
      dragConstraints={containerRef}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      animate={{ x: targetOrbitX, y: targetOrbitY }}
      transition={{
        type: "spring",
        stiffness: isDragging ? 0 : 250,
        damping: 22,
        mass: 1,
      }}
      whileTap={{ scale: 0.96 }}
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10"
      style={{ touchAction: "none" }}
    >
      <CardContent cost={cost} isDragging={isDragging} />
    </motion.div>
  );
};

// Pure card content component
const CardContent: React.FC<{ cost: Cost; isDragging?: boolean }> = ({ cost, isDragging = false }) => (
  <div
    className="px-3 py-2 md:px-4 md:py-2.5 rounded-xl backdrop-blur-md transition-all duration-150"
    style={{
      background: `linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))`,
      border: `1px solid ${cost.hue}44`,
      boxShadow: isDragging
        ? `0 20px 40px -12px rgba(0,0,0,0.5), 0 0 0 2px ${cost.hue}88`
        : `0 0 20px ${cost.hue}1a, inset 0 1px 0 rgba(255,255,255,0.04)`,
      minWidth: 96,
    }}
  >
    <div className="text-[9px] md:text-[10px] font-mono tracking-[0.18em] uppercase text-white/50">
      {cost.label}
    </div>
    <div className="text-base md:text-lg font-bold tabular-nums" style={{ color: cost.hue }}>
      ${cost.price}
      <span className="text-[10px] md:text-xs text-white/40 font-normal">/mo</span>
    </div>
  </div>
);

const SubscriptionVacuum: React.FC = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { amount: 0.6, once: true });
  const [phase, setPhase] = useState<"idle" | "pulling" | "merged">("idle");
  const [showReplay, setShowReplay] = useState(false);
  const [orbitRadius, setOrbitRadius] = useState(220);
  const [orbitRotation, setOrbitRotation] = useState(0);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Responsive orbit radius
  useEffect(() => {
    const handleResize = () => {
      setOrbitRadius(window.innerWidth < 768 ? 130 : 220);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Slow orbit rotation only when idle and not dragging
  useEffect(() => {
    if (phase !== "idle" || draggingIndex !== null) return;

    let animationId: number;
    let lastTime = 0;
    let rotation = orbitRotation;
    const SPEED = 0.08; // degrees per frame

    const animate = (time: number) => {
      if (lastTime) {
        const delta = Math.min(16, time - lastTime);
        rotation = (rotation + SPEED * (delta / 16)) % 360;
        setOrbitRotation(rotation);
      }
      lastTime = time;
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [phase, draggingIndex, orbitRotation]);

  // Trigger vacuum effect when scrolled into view
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
    }, 100);
  };

  const handleDragStart = (index: number) => {
    setDraggingIndex(index);
  };

  const handleDragEnd = (index: number) => {
    setDraggingIndex(null);
  };

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-hidden px-6 md:px-8 py-24 md:py-32"
      style={{ background: "#020617" }}
    >
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-30"
          style={{
            background: "radial-gradient(circle, rgba(6,182,212,0.12) 0%, rgba(139,92,246,0.06) 40%, transparent 70%)",
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-mono tracking-[0.2em] uppercase mb-5"
            style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)", color: "#06b6d4" }}
          >
            <Sparkles size={11} />
            Subscription Vacuum
          </motion.div>
          
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-4"
          >
            Replace your stack.{" "}
            <span style={{ background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Keep the results.
            </span>
          </motion.h2>
          
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-serif text-base md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed"
            style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
          >
            Six tools. Six bills. One platform. Drag the cards around — they'll snap back into orbit.
          </motion.p>
        </div>

        {/* Price Comparison - High Impact */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-col md:flex-row items-center justify-center gap-6 mb-12"
        >
          {/* Old Price - Dangerous with strikethrough */}
          <div
            className="relative px-6 py-4 rounded-2xl text-center"
            style={{
              background: "linear-gradient(135deg, rgba(255,68,68,0.08), rgba(255,68,68,0.02))",
              border: "1px solid rgba(255,68,68,0.3)",
            }}
          >
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-red-400/70 mb-2">
              Typical Monthly Spend
            </div>
            <div className="text-4xl md:text-5xl font-bold text-red-500 tabular-nums relative">
              ${TOTAL_OLD}
              <div className="absolute inset-x-0 top-1/2 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent -translate-y-1/2" />
            </div>
          </div>

          <div className="text-white/30 text-sm font-mono">→</div>

          {/* New Price - Hero Glow */}
          <motion.div
            animate={{ scale: [1, 1.02, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="relative px-8 py-5 rounded-2xl text-center"
            style={{
              background: "linear-gradient(135deg, rgba(6,182,212,0.12), rgba(139,92,246,0.08))",
              border: "1px solid rgba(6,182,212,0.5)",
              backdropFilter: "blur(12px)",
              boxShadow: "0 0 30px rgba(6,182,212,0.3)",
            }}
          >
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-cyan-400 mb-2">
              NazAI Growth Plan
            </div>
            <div className="text-5xl md:text-6xl font-black text-white tabular-nums">
              <span className="text-2xl text-cyan-400">$</span>
              <span style={{ background: "linear-gradient(135deg, #fff, #06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {FINAL_PRICE}
              </span>
              <span className="text-sm text-white/40">/mo</span>
            </div>
            <div className="text-xs text-cyan-400/80 mt-2 flex items-center justify-center gap-1">
              <TrendingUp size={12} />
              Save ${SAVINGS}/month
            </div>
          </motion.div>
        </motion.div>

        {/* Animation Stage */}
        <div ref={containerRef} className="relative mx-auto h-[420px] md:h-[560px] w-full max-w-[680px]">
          {/* Orbit guide rings */}
          {phase === "idle" && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] h-[440px] md:w-[560px] md:h-[560px] rounded-full border border-white/[0.04]" />
            </div>
          )}

          {/* Draggable Cards */}
          <AnimatePresence>
            {phase !== "merged" && COSTS.map((cost, i) => (
              <DraggableCard
                key={cost.label}
                cost={cost}
                index={i}
                phase={phase}
                containerRef={containerRef}
                orbitRadius={orbitRadius}
                orbitRotation={orbitRotation}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            ))}
          </AnimatePresence>

          {/* Central Core */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: phase === "merged" ? 1 : phase === "pulling" ? [1, 1.3, 1.05] : 1, opacity: 1 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
          >
            <motion.div
              animate={{ opacity: phase === "pulling" ? [0.4, 1, 0.7] : phase === "merged" ? 0.6 : 0.3 }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] md:w-[380px] md:h-[380px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(6,182,212,0.35) 0%, rgba(139,92,246,0.18) 40%, transparent 70%)", filter: "blur(20px)" }}
            />

            <AnimatePresence mode="wait">
              {phase !== "merged" ? (
                <motion.div
                  key="core"
                  className="relative w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center"
                  style={{
                    background: "radial-gradient(circle at 30% 30%, rgba(6,182,212,0.4), rgba(2,6,23,0.95))",
                    border: "1px solid rgba(6,182,212,0.5)",
                    boxShadow: "0 0 60px rgba(6,182,212,0.4)",
                  }}
                >
                  <Zap size={36} className="hidden md:block" style={{ color: "#06b6d4", filter: "drop-shadow(0 0 12px #06b6d4)" }} />
                  <Zap size={28} className="md:hidden" style={{ color: "#06b6d4", filter: "drop-shadow(0 0 12px #06b6d4)" }} />
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
                    background: "linear-gradient(135deg, rgba(6,182,212,0.1), rgba(139,92,246,0.08))",
                    border: "1px solid rgba(6,182,212,0.4)",
                    backdropFilter: "blur(24px)",
                  }}
                >
                  <div className="px-5 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(6,182,212,0.25)" }}>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#06b6d4" }} />
                      <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-cyan-300/90">NazAI · Growth Plan</span>
                    </div>
                    <span className="text-[9px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded-full">ACTIVE</span>
                  </div>
                  <div className="px-6 py-7">
                    <div className="flex items-baseline gap-2 mb-1">
                      <div className="text-5xl md:text-6xl font-black text-white">
                        <Counter from={0} to={FINAL_PRICE} play={phase === "merged"} />
                      </div>
                      <div className="text-sm text-white/50">/ month</div>
                    </div>
                    <div className="text-xs text-white/50 mb-5 font-serif">Replaces every tool above. One bill, one login.</div>
                    <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.35)" }}>
                      <div>
                        <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/50">Savings tracker</div>
                        <div className="text-2xl font-black" style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                          $<Counter from={0} to={SAVINGS} play={phase === "merged"} />
                          <span className="text-xs text-white/40 ml-1">/ mo</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/50">Per year</div>
                        <div className="text-xl font-bold text-white">
                          $<Counter from={0} to={SAVINGS * 12} play={phase === "merged"} />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Replay Button */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <AnimatePresence>
            {showReplay && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                onClick={replay}
                className="px-5 py-2 rounded-full text-xs font-mono tracking-[0.18em] uppercase transition-all cursor-pointer"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4" }}
                whileHover={{ background: "rgba(6,182,212,0.12)", scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                ↻ Replay Consolidation
              </motion.button>
            )}
          </AnimatePresence>
          <p className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30">
            <span className="line-through text-red-400/40">${TOTAL_OLD}/mo</span> → <span className="text-cyan-400">${FINAL_PRICE}/mo</span>
          </p>
        </div>
      </div>
    </section>
  );
};

export default SubscriptionVacuum;
