import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Rocket, Loader2, CheckCircle2, Copy, Check, Globe2, Terminal, Triangle } from "lucide-react";

/**
 * LaunchpadDeploymentBar
 *
 * Mounts directly under the generated website preview. Provides a single,
 * high-emphasis "PUBLISH TO WEB" CTA that triggers a simulated multi-stage
 * deployment animation (build → upload → CDN → live), then reveals a
 * shareable live URL with a one-tap copy action.
 *
 * The deploy is intentionally simulated client-side for now — the
 * platform's real publish pipeline is a separate concern.
 */

interface LaunchpadDeploymentBarProps {
  /** Used to seed the simulated subdomain (so each project gets a unique URL). */
  directive?: string;
}

type Phase = "idle" | "building" | "deploying" | "live";

const STAGES: { key: string; label: string; pct: number }[] = [
  { key: "compile", label: "Compiling React bundle", pct: 18 },
  { key: "optimize", label: "Optimizing assets & images", pct: 38 },
  { key: "ship", label: "Uploading to edge network", pct: 62 },
  { key: "cdn", label: "Distributing across CDN regions", pct: 84 },
  { key: "verify", label: "Verifying SSL certificate", pct: 96 },
  { key: "live", label: "Live", pct: 100 },
];

const slugify = (input: string): string => {
  const cleaned = (input || "")
    .replace(/\[.*?\]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-");
  const fallback = Math.random().toString(36).slice(2, 7);
  const base = cleaned.length > 2 ? cleaned : `nazai-${fallback}`;
  const suffix = Math.random().toString(36).slice(2, 5);
  return `${base}-${suffix}`;
};

const LaunchpadDeploymentBar: React.FC<LaunchpadDeploymentBarProps> = ({
  directive,
}) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [liveUrl, setLiveUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const timeouts = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timeouts.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const handlePublish = () => {
    if (phase === "building" || phase === "deploying") return;
    setPhase("building");
    setProgress(0);
    setStageIdx(0);
    setCopied(false);

    // Smooth progress tween
    let pct = 0;
    const tick = () => {
      pct = Math.min(100, pct + 1.4);
      setProgress(pct);
      // advance stage label as we cross thresholds
      const next = STAGES.findIndex((s) => pct < s.pct);
      const idx = next === -1 ? STAGES.length - 1 : Math.max(0, next);
      setStageIdx(idx);
      if (pct >= 60) setPhase((p) => (p === "building" ? "deploying" : p));
      if (pct < 100) {
        timeouts.current.push(window.setTimeout(tick, 70));
      } else {
        const slug = slugify(directive || "site");
        setLiveUrl(`https://${slug}.nazai.app`);
        setPhase("live");
      }
    };
    timeouts.current.push(window.setTimeout(tick, 120));
  };

  const handleCopy = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const isBusy = phase === "building" || phase === "deploying";
  const isLive = phase === "live";

  return (
    <div
      className="w-full rounded-xl p-5"
      style={{
        background:
          "linear-gradient(180deg, rgba(8,10,14,0.95) 0%, rgba(11,11,15,0.95) 100%)",
        border: "1px solid #27272a",
        boxShadow: isLive
          ? "0 30px 80px -30px rgba(34,197,94,0.35), inset 0 0 20px rgba(34,197,94,0.05)"
          : "0 30px 80px -30px rgba(6,182,212,0.25)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Rocket size={12} className="text-cyan-400" />
        <h4 className="text-[11px] font-mono uppercase tracking-[0.22em] text-zinc-300">
          Launchpad
        </h4>
        <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-500 ml-auto">
          {isLive
            ? "Deployed · live"
            : isBusy
              ? "Deploying"
              : "Ready to ship"}
        </span>
      </div>

      <p className="text-[11px] font-mono text-zinc-500 leading-relaxed mb-4">
        Push this build to a public URL on the NazAI edge. Free SSL, global
        CDN, instant rollback.
      </p>

      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.button
            key="cta"
            type="button"
            onClick={handlePublish}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.985 }}
            className="w-full relative overflow-hidden rounded-lg px-5 py-3.5 flex items-center justify-center gap-2 text-[12px] font-mono font-bold tracking-[0.18em] uppercase"
            style={{
              background:
                "linear-gradient(135deg, #06b6d4 0%, #0891b2 60%, #0e7490 100%)",
              color: "#031014",
              boxShadow:
                "0 0 22px rgba(6,182,212,0.55), inset 0 0 14px rgba(255,255,255,0.18)",
            }}
          >
            <motion.span
              aria-hidden
              className="absolute inset-0"
              animate={{
                background: [
                  "radial-gradient(circle at 0% 50%, rgba(255,255,255,0.18), transparent 50%)",
                  "radial-gradient(circle at 100% 50%, rgba(255,255,255,0.18), transparent 50%)",
                  "radial-gradient(circle at 0% 50%, rgba(255,255,255,0.18), transparent 50%)",
                ],
              }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />
            <Rocket size={14} className="relative z-10" />
            <span className="relative z-10">Publish to Web</span>
          </motion.button>
        )}

        {(phase === "building" || phase === "deploying") && (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
              <Loader2 size={12} className="animate-spin text-cyan-400" />
              {STAGES[stageIdx]?.label ?? "Working"}
            </div>
            <div
              className="relative h-2 w-full rounded-full overflow-hidden"
              style={{ background: "#1a1a1f", border: "1px solid #27272a" }}
            >
              <motion.div
                className="h-full"
                style={{
                  width: `${progress}%`,
                  background:
                    "linear-gradient(90deg, #06b6d4 0%, #22d3ee 60%, #67e8f9 100%)",
                  boxShadow: "0 0 12px rgba(6,182,212,0.7)",
                }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <div className="flex justify-between text-[9px] font-mono text-zinc-500">
              <span>NazAI Edge · global</span>
              <span>{Math.round(progress)}%</span>
            </div>
          </motion.div>
        )}

        {phase === "live" && (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400">
              <CheckCircle2 size={12} />
              Deployment complete
            </div>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{
                background: "rgba(34,197,94,0.06)",
                border: "1px solid rgba(34,197,94,0.35)",
              }}
            >
              <Globe2 size={12} className="text-emerald-400 shrink-0" />
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11px] font-mono text-emerald-200 truncate hover:underline"
              >
                {liveUrl}
              </a>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-auto px-2 py-1 rounded-md flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
                style={{
                  background: copied
                    ? "rgba(34,197,94,0.18)"
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${copied ? "rgba(34,197,94,0.6)" : "#27272a"}`,
                  color: copied ? "#86efac" : "#a1a1aa",
                }}
              >
                {copied ? <Check size={10} /> : <Copy size={10} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              onClick={handlePublish}
              className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500 hover:text-cyan-400 transition-colors"
            >
              Redeploy
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LaunchpadDeploymentBar;
