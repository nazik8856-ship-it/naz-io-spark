import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SESSION_KEY = "nazai-intro-played";
const SCAN_DURATION = 2.0; // seconds — matches reference video
const EXIT_DURATION = 0.7;

interface EntranceSplashProps {
  children: React.ReactNode;
}

const EntranceSplash = ({ children }: EntranceSplashProps) => {
  // Default to true so the landing page is hidden on first paint;
  // useEffect immediately corrects this if the splash was already played.
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    try {
      const played = sessionStorage.getItem(SESSION_KEY) === "1";
      if (played) {
        setShowSplash(false);
        return;
      }
    } catch {
      /* ignore */
    }

    // Total: scan (2.0s) + exit (0.7s) + small buffer
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
      setShowSplash(false);
    }, SCAN_DURATION * 1000 + 200);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Underlying app — physically hidden while splash is active */}
      <div
        style={{
          display: showSplash && hasMounted ? "none" : "block",
        }}
      >
        {children}
      </div>

      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="nazai-splash"
            initial={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, filter: "blur(25px)", scale: 1.1 }}
            transition={{ duration: EXIT_DURATION, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
            style={{ background: "#000000" }}
          >
            {/* Razor scan line — pure white core, green glow halo */}
            <motion.div
              initial={{ top: "-5%" }}
              animate={{ top: "105%" }}
              transition={{ duration: SCAN_DURATION, ease: "linear" }}
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                height: "2px",
                background: "#FFFFFF",
                boxShadow:
                  "0 0 20px #22c55e, 0 0 40px #22c55e, 0 0 80px rgba(34,197,94,0.6)",
              }}
            />

            {/* Center content */}
            <div className="relative z-10 flex flex-col items-center gap-4 px-6">
              {/* NazAI logo with mid-scan flicker */}
              <motion.h1
                animate={{ opacity: [1, 1, 0, 1, 0.2, 1, 1] }}
                transition={{
                  duration: SCAN_DURATION,
                  ease: "linear",
                  // Flicker concentrated around mid-scan (~50%)
                  times: [0, 0.45, 0.5, 0.55, 0.6, 0.65, 1],
                }}
                className="text-5xl md:text-7xl font-extrabold italic tracking-tight"
                style={{
                  fontFamily:
                    "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                  color: "#FFFFFF",
                  letterSpacing: "-0.02em",
                  textShadow:
                    "0 0 10px rgba(255,255,255,0.4), 0 0 30px rgba(34,197,94,0.3)",
                }}
              >
                Naz<span style={{ color: "#22c55e" }}>AI</span>
              </motion.h1>

              {/* Subtext — slow pulse */}
              <motion.p
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{
                  duration: 1.8,
                  ease: "easeInOut",
                  repeat: Infinity,
                }}
                style={{
                  color: "#22c55e",
                  fontSize: "8px",
                  fontFamily:
                    "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                  letterSpacing: "0.4em",
                }}
              >
                [ ARCHITECT_V24 // INITIALIZING ]
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default EntranceSplash;
