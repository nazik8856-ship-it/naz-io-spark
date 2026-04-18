import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";

const SESSION_KEY = "nazai_splash_played_v1";

interface EntranceSplashProps {
  children: React.ReactNode;
}

const EntranceSplash = ({ children }: EntranceSplashProps) => {
  // Synchronously check session storage so the landing page never flashes first
  const [showSplash, setShowSplash] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(SESSION_KEY) !== "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!showSplash) return;
    // Total duration: flicker 1s + scan 1.6s + glow 0.6s + buffer = ~3.4s
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
      setShowSplash(false);
    }, 3400);
    return () => clearTimeout(timer);
  }, [showSplash]);

  return (
    <>
      {/* Underlying app — kept hidden while splash is active so it can't be seen behind */}
      <motion.div
        initial={false}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        style={{ pointerEvents: showSplash ? "none" : "auto" }}
      >
        {children}
      </motion.div>

      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="nazai-splash"
            initial={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, filter: "blur(20px)", scale: 1.15 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
            style={{ background: "#020617" }}
          >
            {/* Subtle vignette */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
              }}
            />

            {/* Phase 2 — Razor scan line top → bottom */}
            <motion.div
              initial={{ y: "-2%", opacity: 0 }}
              animate={{
                y: ["-2%", "102%"],
                opacity: [0, 1, 1, 0.9, 0],
              }}
              transition={{
                duration: 1.6,
                delay: 0.9,
                ease: "linear",
                times: [0, 0.05, 0.5, 0.95, 1],
              }}
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                height: "2px",
                background:
                  "linear-gradient(90deg, transparent 0%, #22c55e 20%, #4ade80 50%, #22c55e 80%, transparent 100%)",
                boxShadow:
                  "0 0 24px 4px rgba(34,197,94,0.85), 0 0 60px 12px rgba(34,197,94,0.35)",
              }}
            />

            {/* Faint trailing scan glow */}
            <motion.div
              initial={{ y: "-10%", opacity: 0 }}
              animate={{ y: ["-10%", "100%"], opacity: [0, 0.25, 0.25, 0] }}
              transition={{ duration: 1.6, delay: 0.9, ease: "linear" }}
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                height: "120px",
                background:
                  "linear-gradient(180deg, rgba(34,197,94,0.18) 0%, transparent 100%)",
                filter: "blur(10px)",
              }}
            />

            {/* Center content */}
            <div className="relative z-10 flex flex-col items-center gap-5 px-6">
              {/* Phase 1 — Flicker logo + zap */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0.4, 1, 0.6, 1] }}
                transition={{ duration: 1, ease: "easeOut", times: [0, 0.2, 0.4, 0.6, 0.8, 1] }}
                className="flex items-center gap-4"
              >
                <motion.div
                  animate={{
                    filter: [
                      "drop-shadow(0 0 0px rgba(34,197,94,0))",
                      "drop-shadow(0 0 12px rgba(34,197,94,0.9))",
                      "drop-shadow(0 0 24px rgba(34,197,94,1))",
                      "drop-shadow(0 0 8px rgba(34,197,94,0.6))",
                    ],
                  }}
                  transition={{ duration: 2.4, delay: 0.2, ease: "easeOut", times: [0, 0.4, 0.7, 1] }}
                >
                  <Zap
                    size={42}
                    strokeWidth={2.5}
                    style={{ color: "#22c55e", fill: "#22c55e" }}
                  />
                </motion.div>

                <motion.h1
                  animate={{
                    textShadow: [
                      "0 0 0px rgba(34,197,94,0)",
                      "0 0 18px rgba(34,197,94,0.7)",
                      "0 0 36px rgba(34,197,94,1)",
                      "0 0 12px rgba(34,197,94,0.5)",
                    ],
                  }}
                  transition={{ duration: 2.4, delay: 0.2, ease: "easeOut", times: [0, 0.4, 0.7, 1] }}
                  className="text-5xl md:text-7xl font-extrabold italic tracking-tight"
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "#FFFFFF",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Naz<span style={{ color: "#22c55e" }}>AI</span>
                </motion.h1>
              </motion.div>

              {/* Subtext */}
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: [0, 0.9, 0.9], y: 0 }}
                transition={{ duration: 1.2, delay: 1.4, ease: "easeOut" }}
                className="text-[10px] md:text-xs font-mono"
                style={{
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "0.4em",
                }}
              >
                [ NEURAL ARCHITECT // INITIALIZING SYSTEM ]
              </motion.p>

              {/* Bottom progress thread */}
              <motion.div
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: [0, 0.8, 0.8] }}
                transition={{ duration: 2.4, delay: 0.9, ease: "easeOut" }}
                className="mt-3 h-px w-48 origin-left"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, #22c55e 50%, transparent)",
                  boxShadow: "0 0 8px rgba(34,197,94,0.6)",
                }}
              />
            </div>

            {/* Corner brackets — terminal frame */}
            {[
              { top: 24, left: 24, rotate: 0 },
              { top: 24, right: 24, rotate: 90 },
              { bottom: 24, right: 24, rotate: 180 },
              { bottom: 24, left: 24, rotate: 270 },
            ].map((pos, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.5, 0.5] }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.08 }}
                className="absolute pointer-events-none"
                style={{
                  ...pos,
                  width: 18,
                  height: 18,
                  borderTop: "1px solid #22c55e",
                  borderLeft: "1px solid #22c55e",
                  transform: `rotate(${pos.rotate}deg)`,
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default EntranceSplash;
