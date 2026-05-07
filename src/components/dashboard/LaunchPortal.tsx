import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * LaunchPortal — circular glowing portal that spins, widens, and emits
 * data streams (binary/code snippets) flowing inward. On `complete`, the
 * portal bursts open and reveals the result below.
 *
 * Renders as a fixed overlay on top of the preview area. ONLY used for
 * website / business generation — never during plain text chat.
 */
interface LaunchPortalProps {
  active: boolean;
  /** When true, plays the burst-open exit. */
  complete: boolean;
  /** Optional label rendered under the portal. */
  label?: string;
}

const STREAM_TOKENS = [
  "01001110", "11010110", "<section>", "const init=", "load()", "10110011",
  "{ build }", "build()", "00111010", "</hero>", "tailwind", "01100110",
  "render()", "11001100", "<div>", "ai.spawn", "10101010", "<launch/>",
];

const LaunchPortal: React.FC<LaunchPortalProps> = ({ active, complete, label }) => {
  const [bursting, setBursting] = useState(false);

  useEffect(() => {
    if (complete && active) {
      setBursting(true);
      const t = setTimeout(() => setBursting(false), 850);
      return () => clearTimeout(t);
    }
  }, [complete, active]);

  return (
    <AnimatePresence>
      {(active || bursting) && (
        <motion.div
          key="launch-portal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center pointer-events-none"
          style={{
            background: "radial-gradient(circle at center, rgba(2,6,23,0.78) 0%, rgba(2,6,23,0.95) 70%)",
            backdropFilter: "blur(6px)",
          }}
        >
          {/* Data streams */}
          <div className="absolute inset-0 overflow-hidden">
            {STREAM_TOKENS.map((tok, i) => {
              const angle = (i / STREAM_TOKENS.length) * 360;
              const rad = (angle * Math.PI) / 180;
              const startR = 320;
              const x = Math.cos(rad) * startR;
              const y = Math.sin(rad) * startR;
              return (
                <motion.span
                  key={`${tok}-${i}`}
                  className="absolute left-1/2 top-1/2 font-mono text-[10px] tracking-widest"
                  style={{ color: "#06b6d4" }}
                  initial={{ x, y, opacity: 0, scale: 0.8 }}
                  animate={{
                    x: [x, 0],
                    y: [y, 0],
                    opacity: [0, 0.85, 0],
                    scale: [0.8, 1, 0.4],
                  }}
                  transition={{
                    duration: 1.6,
                    delay: (i % 6) * 0.18,
                    repeat: bursting ? 0 : Infinity,
                    ease: "easeIn",
                  }}
                >
                  {tok}
                </motion.span>
              );
            })}
          </div>

          {/* Spinning portal ring */}
          <motion.div
            className="relative"
            animate={
              bursting
                ? { scale: [1, 1.4, 2.6], opacity: [1, 0.8, 0] }
                : { scale: [0.85, 1, 0.95, 1] }
            }
            transition={
              bursting
                ? { duration: 0.85, ease: "easeOut" }
                : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <motion.div
              className="rounded-full"
              style={{
                width: 220,
                height: 220,
                border: "2px solid #06b6d4",
                boxShadow:
                  "0 0 60px rgba(6,182,212,0.55), inset 0 0 60px rgba(6,182,212,0.35), 0 0 120px rgba(168,85,247,0.25)",
                background:
                  "conic-gradient(from 0deg, rgba(6,182,212,0.0) 0deg, rgba(6,182,212,0.7) 90deg, rgba(168,85,247,0.6) 180deg, rgba(6,182,212,0.0) 360deg)",
                maskImage: "radial-gradient(circle, transparent 60%, black 62%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 60%, black 62%)",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
            />
            {/* Inner ring */}
            <motion.div
              className="absolute inset-6 rounded-full"
              style={{
                border: "1px solid rgba(6,182,212,0.5)",
                boxShadow: "inset 0 0 30px rgba(6,182,212,0.45)",
              }}
              animate={{ rotate: -360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
            {/* Core */}
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: 80,
                height: 80,
                background: "radial-gradient(circle, #ffffff 0%, #06b6d4 40%, transparent 75%)",
                filter: "blur(1px)",
              }}
              animate={{ scale: [0.9, 1.15, 0.9], opacity: [0.85, 1, 0.85] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>

          {label && !bursting && (
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-10 font-mono text-[11px] uppercase tracking-[0.3em]"
              style={{ color: "#06b6d4", textShadow: "0 0 12px rgba(6,182,212,0.5)" }}
            >
              {label}
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LaunchPortal;
