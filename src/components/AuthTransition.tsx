import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Cpu, Sparkles } from "lucide-react";

interface AuthTransitionProps {
  active: boolean;
  onComplete: () => void;
}

const SLIDES = [
  {
    icon: ShieldCheck,
    kicker: "01 // HANDSHAKE",
    title: "Identity Verified",
    sub: "Encrypted credentials accepted by NazAI Neural Gateway.",
    accent: "#22c55e",
  },
  {
    icon: Cpu,
    kicker: "02 // SPIN-UP",
    title: "Initializing Neural Core",
    sub: "Allocating agents, memory, and orchestration channels.",
    accent: "#00A3FF",
  },
  {
    icon: Sparkles,
    kicker: "03 // READY",
    title: "Welcome, Operator",
    sub: "Routing you to your Command Center.",
    accent: "#a855f7",
  },
];

const SLIDE_MS = 900;

const AuthTransition: React.FC<AuthTransitionProps> = ({ active, onComplete }) => {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!active) return;
    setIdx(0);
    const timers: number[] = [];
    SLIDES.forEach((_, i) => {
      timers.push(window.setTimeout(() => setIdx(i), i * SLIDE_MS));
    });
    timers.push(window.setTimeout(onComplete, SLIDES.length * SLIDE_MS));
    return () => timers.forEach(clearTimeout);
  }, [active, onComplete]);

  if (!active) return null;

  const slide = SLIDES[idx];
  const Icon = slide.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(8,12,24,0.96) 0%, rgba(2,6,23,1) 70%)",
      }}
    >
      {/* grid */}
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,163,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,163,255,0.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* progress bar */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/5">
        <motion.div
          className="h-full"
          style={{ background: slide.accent, boxShadow: `0 0 12px ${slide.accent}` }}
          initial={{ width: "0%" }}
          animate={{ width: `${((idx + 1) / SLIDES.length) * 100}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* step pips */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {SLIDES.map((s, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all duration-500"
            style={{
              width: i === idx ? 28 : 10,
              background: i <= idx ? s.accent : "rgba(255,255,255,0.15)",
              boxShadow: i === idx ? `0 0 10px ${s.accent}` : "none",
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, x: 80, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -80, filter: "blur(6px)" }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex flex-col items-center text-center px-6 max-w-xl"
        >
          <motion.div
            initial={{ scale: 0.6, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-7 relative"
            style={{
              background: `linear-gradient(135deg, ${slide.accent}30, ${slide.accent}10)`,
              border: `1px solid ${slide.accent}80`,
              boxShadow: `0 0 50px ${slide.accent}55, inset 0 0 30px ${slide.accent}25`,
            }}
          >
            <Icon size={36} style={{ color: slide.accent }} />
            <motion.div
              className="absolute inset-0 rounded-2xl"
              style={{ border: `1px solid ${slide.accent}` }}
              animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            />
          </motion.div>

          <div
            className="text-[10px] font-mono tracking-[0.4em] mb-3"
            style={{ color: slide.accent }}
          >
            {slide.kicker}
          </div>
          <h2
            className="text-4xl md:text-5xl font-black italic tracking-tight text-white mb-4"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              textShadow: `0 0 30px ${slide.accent}55`,
            }}
          >
            {slide.title}
          </h2>
          <p className="text-sm text-white/55 max-w-md">{slide.sub}</p>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
};

export default AuthTransition;
