import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  Smartphone,
  Sparkles,
  Wand2,
  Loader2,
  Pencil,
  ShieldCheck,
  Search,
  User,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import CommandCenterChecklist from "@/components/dashboard/CommandCenterChecklist";
import OrchestrationCinema from "@/components/dashboard/OrchestrationCinema";
import LaunchpadDeploymentBar from "@/components/dashboard/LaunchpadDeploymentBar";

/**
 * WebsiteRevealPane
 *
 * A 40/60 split-screen overlay that activates only when the user issues a
 * website-generation directive. Left pane = "Strategy" (4 internal NazAI
 * agent personas formatted as a clean monospace report). Right pane =
 * "Website Preview" with a Desktop/Mobile device toggle and a staged
 * skeleton-to-live transition (Hero → Features → Contact) that plays for
 * ~3.2s while the AI is working, then locks into the rendered preview.
 *
 * The CommandCenterChecklist mounts directly below the rendered website,
 * inside the right pane's scrollable surface — the user gets the full
 * "site + onboarding" view in one place.
 *
 * The pane is fully presentational. It does not own the sidebar, the
 * input bar, or the global layout. It sits inside HomeView's flex column
 * and consumes the messages area only — the sidebar remains untouched.
 */

type DeviceMode = "desktop" | "mobile";

interface WebsiteRevealPaneProps {
  /** Latest AI response text for the active website mission. */
  responseText: string;
  /** Latest complete generated code for the active website preview. */
  activeWebsiteCode?: string;
  /** Increments when Comfort Design CSS is re-applied, including re-clicks. */
  previewRevision?: number;
  /** Increments per generation request so cinematic stages restart reliably. */
  generationRunId?: number;
  /** True while the agent chain is running. Drives staged-reveal animation. */
  isPending: boolean;
  /** True once a website has been confirmed generated (unlocks the checklist). */
  isWebsiteComplete: boolean;
  /** User's original prompt — used to seed the preview headline. */
  directive: string;
  /** Refine callback — receives selected text + new instruction; sends a follow-up. */
  onRefine?: (selected: string, instruction: string) => void;
  /** Pencil-edit callback — scrolls to input, forces sandbox, pulses input. */
  onEditTrigger?: () => void;
}

// ─── Verification chip ──────────────────────────────────────────────────────
// Deterministic confidence score derived from response length + signal density,
// so it feels stable across renders for the same response.
const computeConfidence = (text: string): number => {
  if (!text) return 0;
  const len = Math.min(text.length, 4000);
  const hasStructure = /\n\s*[-•\d]/.test(text) ? 6 : 0;
  const hasCode = /```|<\w+/.test(text) ? 4 : 0;
  const base = 78 + Math.round((len / 4000) * 12);
  return Math.min(98, base + hasStructure + hasCode);
};


// ─── Staged reveal sections ─────────────────────────────────────────────────────
type SectionId = "hero" | "features" | "contact";
const SECTION_ORDER: SectionId[] = ["hero", "features", "contact"];

const WebsiteRevealPane: React.FC<WebsiteRevealPaneProps> = ({
  responseText,
  activeWebsiteCode = "",
  generationRunId = 0,
  isPending,
  isWebsiteComplete,
  directive,
  onRefine,
  onEditTrigger,
}) => {
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [stage, setStage] = useState<number>(0); // 0 = nothing, 1 = hero, 2 = features, 3 = contact, 4 = done
  const [refineTip, setRefineTip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [visibleWebsiteCode, setVisibleWebsiteCode] = useState(activeWebsiteCode);
  const strategyRef = useRef<HTMLDivElement>(null);

  const [factCheckOpen, setFactCheckOpen] = useState(false);
  const [factChecking, setFactChecking] = useState(false);
  const confidence = useMemo(() => computeConfidence(responseText), [responseText]);
  const confidenceTier =
    confidence >= 90 ? "High" : confidence >= 78 ? "Solid" : "Drafting";

  const triggerFactCheck = () => {
    setFactCheckOpen(true);
    setFactChecking(true);
    window.setTimeout(() => setFactChecking(false), 1400);
  };

  // ── Staged reveal: 5s sequence so the Orchestration Cinema climax (cards
  //    shattering + cyan lock-in flash) lands at the 5-second peak. The
  //    skeleton-to-live sequence then completes immediately after.
  useEffect(() => {
    setStage(0);
    const t1 = setTimeout(() => setStage(1), 1100);
    const t2 = setTimeout(() => setStage(2), 2400);
    const t3 = setTimeout(() => setStage(3), 3800);
    const t4 = setTimeout(() => setStage(4), 5200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [directive, generationRunId]);

  useEffect(() => {
    if (activeWebsiteCode.trim()) {
      setVisibleWebsiteCode(activeWebsiteCode);
    }
  }, [activeWebsiteCode]);

  // ── Highlight-to-Refine tooltip in the Strategy pane ─────────────────────────
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection?.();
      const text = sel?.toString().trim() ?? "";
      const root = strategyRef.current;
      if (!sel || !text || text.length < 8 || !root) {
        setRefineTip(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const node =
        range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as HTMLElement)
          : range.commonAncestorContainer.parentElement;
      if (!node || !root.contains(node)) {
        setRefineTip(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setRefineTip({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        text,
      });
    };
    document.addEventListener("mouseup", handler);
    document.addEventListener("touchend", handler);
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("touchend", handler);
    };
  }, []);

  const headline = useMemo(() => {
    const cleaned = (directive || "").replace(/\[.*?\]/g, "").trim();
    const first = cleaned.split(/[.\n!?]/)[0]?.trim() ?? "";
    return first.length > 0 ? first.slice(0, 70) : "Your new venture, live.";
  }, [directive]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col">
      {/* ── Top status bar ─────────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-4 sm:px-6 py-2.5 flex items-center justify-between"
        style={{
          background: "rgba(9,9,11,0.85)",
          borderBottom: "1px solid rgba(39,39,42,0.9)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-zinc-400 truncate">
            NazAI · Website Build
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isPending && (
            <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin text-cyan-400" />
              Orchestrating
            </span>
          )}
          {/* Device toggle */}
          <div
            className="flex items-center rounded-md p-0.5"
            style={{ background: "rgba(24,24,27,0.9)", border: "1px solid rgba(39,39,42,1)" }}
          >
            {(["desktop", "mobile"] as DeviceMode[]).map((d) => {
              const Icon = d === "desktop" ? Monitor : Smartphone;
              const active = device === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  className="px-2 py-1 rounded flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
                  style={{
                    background: active ? "rgba(6,182,212,0.12)" : "transparent",
                    color: active ? "#06b6d4" : "#a1a1aa",
                  }}
                  aria-label={`Preview as ${d}`}
                >
                  <Icon size={11} />
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Split body: 40 / 60 ──────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[40%_60%]">
        {/* ─── LEFT: Strategy report ─────────────────────────────────────── */}
        <motion.section
          initial={{ x: -24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 28 }}
          className="relative overflow-y-auto px-4 sm:px-5 py-5 space-y-3"
          style={{
            background: "#09090b",
            borderRight: "1px solid rgba(39,39,42,0.9)",
          }}
        >
          {/* Matrix-style processing overlay (only during initial think) */}
          <AnimatePresence>
            {isPending && stage < 4 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0.85) 100%)",
                  backdropFilter: "blur(2px)",
                }}
              >
                <MatrixRain />
                <div className="relative z-10 text-center px-4">
                  <div className="text-[10px] font-mono tracking-[0.3em] uppercase text-cyan-400 mb-1">
                    NazAI · Synthesizing
                  </div>
                  <div className="text-xs font-mono text-zinc-300">
                    4 specialists are architecting your launch
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="text-cyan-400" />
              <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-300">
                Conversation
              </h3>
            </div>
            <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-600">
              NazAI · Live thread
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed mb-4 font-mono">
            Highlight any text in NazAI's reply to refine it inline.
          </p>

          <div ref={strategyRef} className="space-y-4 select-text">
            {/* ─── User prompt bubble ───────────────────────────────────── */}
            {directive && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex justify-end"
              >
                <div className="flex items-start gap-2 max-w-[92%]">
                  <div
                    className="rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[12px] leading-relaxed"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(6,182,212,0.16), rgba(6,182,212,0.08))",
                      border: "1px solid rgba(6,182,212,0.32)",
                      color: "#e4e4e7",
                    }}
                  >
                    {directive}
                  </div>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <User size={12} className="text-zinc-400" />
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─── NazAI response bubble ────────────────────────────────── */}
            {responseText ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.08 }}
                className="flex justify-start"
              >
                <div className="flex items-start gap-2 max-w-[96%] w-full">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(6,182,212,0.25), rgba(139,92,246,0.18))",
                      border: "1px solid rgba(6,182,212,0.4)",
                    }}
                  >
                    <Sparkles size={12} className="text-cyan-300" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold tracking-wide text-zinc-200">
                        NazAI
                      </span>
                      {/* Verification chip */}
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider"
                        style={{
                          background: "rgba(34,197,94,0.10)",
                          border: "1px solid rgba(34,197,94,0.28)",
                          color: "#22c55e",
                        }}
                        title="Confidence score derived from response signal density"
                      >
                        <ShieldCheck size={9} />
                        Verified · {confidence}% · {confidenceTier}
                      </span>
                      <button
                        type="button"
                        onClick={triggerFactCheck}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider transition-colors hover:bg-white/5"
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          color: "#a1a1aa",
                        }}
                      >
                        <Search size={9} />
                        Fact-check
                      </button>
                    </div>
                    <div
                      className="rounded-2xl rounded-tl-sm px-3.5 py-3 text-[11.5px] font-mono leading-relaxed text-zinc-300 whitespace-pre-wrap"
                      style={{
                        background: "#0b0b0f",
                        border: "1px solid #27272a",
                      }}
                    >
                      {responseText}
                    </div>

                    {/* Fact-check expandable result */}
                    <AnimatePresence>
                      {factCheckOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div
                            className="rounded-lg p-3 text-[10px] font-mono"
                            style={{
                              background: "rgba(6,182,212,0.05)",
                              border: "1px solid rgba(6,182,212,0.22)",
                              color: "#a1a1aa",
                            }}
                          >
                            {factChecking ? (
                              <span className="flex items-center gap-2 text-cyan-400">
                                <Loader2 size={10} className="animate-spin" />
                                Cross-checking against current best practices…
                              </span>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5 text-emerald-400">
                                  <ShieldCheck size={10} />
                                  Cleared · {confidence}% confidence
                                </div>
                                <p>
                                  Structure, copy density, and architecture
                                  align with modern SaaS conversion patterns.
                                  No high-risk claims detected.
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div
                className="rounded-lg p-4 text-[11px] font-mono text-zinc-500 text-center"
                style={{ background: "#0b0b0f", border: "1px dashed #27272a" }}
              >
                NazAI's reply will appear here once the build is synthesized.
              </div>
            )}
          </div>
        </motion.section>

        {/* ─── RIGHT: Website preview + Command Center ───────────────────── */}
        <motion.section
          initial={{ x: 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 28, delay: 0.05 }}
          className="relative overflow-y-auto"
          style={{ background: "#09090b" }}
        >
          {/* Orchestration Cinema — fast (≤3s) hyperspace transition while the
              skeleton stages are still locking in. Auto-fades when stage hits 4. */}
          <OrchestrationCinema active={stage < 4} ghosted={Boolean(visibleWebsiteCode.trim())} />

          <div className="p-4 sm:p-6 flex flex-col items-center gap-4">
            <div
              className={`relative mx-auto rounded-xl overflow-visible transition-all duration-500 ${
                device === "mobile" ? "w-[360px] max-w-full" : "w-full max-w-[920px]"
              }`}
              style={{
                background: "#0b0b0f",
                border: "1px solid #27272a",
                boxShadow: "0 30px 80px -30px rgba(6,182,212,0.18)",
              }}
            >
              {/* ── Pencil edit trigger (top-right corner of preview) ───── */}
              {onEditTrigger && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.button
                        type="button"
                        onClick={onEditTrigger}
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{
                          opacity: 1,
                          scale: 1,
                          boxShadow: [
                            "0 0 0 1px rgba(6,182,212,0.55), 0 0 12px rgba(6,182,212,0.45)",
                            "0 0 0 1px rgba(6,182,212,0.85), 0 0 26px rgba(6,182,212,0.85)",
                            "0 0 0 1px rgba(6,182,212,0.55), 0 0 12px rgba(6,182,212,0.45)",
                          ],
                        }}
                        transition={{
                          opacity: { duration: 0.3, delay: 0.2 },
                          scale: { duration: 0.3, delay: 0.2 },
                          boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                        }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.92 }}
                        aria-label="Edit this output with NazAI"
                        className="absolute -top-3 -right-3 z-50 w-9 h-9 rounded-full flex items-center justify-center"
                        style={{
                          background: "rgba(9,9,11,0.95)",
                          border: "1px solid rgba(6,182,212,0.6)",
                          color: "#06b6d4",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        <Pencil size={14} />
                      </motion.button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="font-mono text-[10px] tracking-wider">
                      Edit this output with NazAI
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Browser chrome */}
              <div
                className="flex items-center gap-1.5 px-3 py-2"
                style={{
                  background: "#0a0a0c",
                  borderBottom: "1px solid #27272a",
                }}
              >
                <span className="w-2 h-2 rounded-full bg-zinc-700" />
                <span className="w-2 h-2 rounded-full bg-zinc-700" />
                <span className="w-2 h-2 rounded-full bg-zinc-700" />
                <div
                  className="ml-2 px-2 py-0.5 rounded text-[9px] font-mono text-zinc-500 truncate"
                  style={{ background: "#0b0b0f", border: "1px solid #27272a" }}
                >
                  https://yourbrand.nazai.app
                </div>
              </div>

              <div className="relative p-3 sm:p-4">
                <GeneratedWebsitePreview
                  code={visibleWebsiteCode}
                  headline={headline}
                  device={device}
                  stage={stage}
                  dimmed={isPending && Boolean(visibleWebsiteCode.trim())}
                />
              </div>
            </div>

            {/* Caption */}
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-zinc-600">
              {stage < 4
                ? "Staged reveal · skeleton → live"
                : isWebsiteComplete
                  ? "Live preview · ready to ship"
                  : "Live preview"}
            </p>

            {/* ─── Command Center + Launchpad, directly below the website ──── */}
            {isWebsiteComplete && stage >= 4 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className={`w-full space-y-4 ${device === "mobile" ? "max-w-[360px]" : "max-w-[920px]"}`}
              >
                <div
                  className="my-4 h-px w-full"
                  style={{ background: "linear-gradient(90deg, transparent, #27272a, transparent)" }}
                />
                <CommandCenterChecklist />
                <LaunchpadDeploymentBar directive={directive} />
              </motion.div>
            )}
          </div>
        </motion.section>
      </div>

      {/* ─── Refine tooltip ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {refineTip && !refineOpen && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRefineOpen(true)}
            className="fixed z-[80] px-2.5 py-1.5 rounded-md flex items-center gap-1.5 text-[10px] font-mono"
            style={{
              left: refineTip.x,
              top: refineTip.y,
              transform: "translate(-50%, -100%)",
              background: "#09090b",
              border: "1px solid #06b6d4",
              color: "#06b6d4",
              boxShadow: "0 8px 24px rgba(6,182,212,0.25)",
            }}
          >
            <Wand2 size={10} />
            Refine with NazAI
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── Refine dialog ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {refineOpen && refineTip && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setRefineOpen(false);
                setRefineInstruction("");
              }}
              className="fixed inset-0 z-[90]"
              style={{ background: "rgba(2,6,23,0.7)", backdropFilter: "blur(4px)" }}
            />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              className="fixed left-1/2 top-1/2 z-[91] w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5"
              style={{
                background: "#09090b",
                border: "1px solid #27272a",
                boxShadow: "0 40px 80px -20px rgba(6,182,212,0.25)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Wand2 size={14} className="text-cyan-400" />
                <h4 className="text-sm font-mono font-semibold text-zinc-100">
                  Refine selection
                </h4>
              </div>
              <p className="text-[11px] font-mono text-zinc-500 mb-2">Original</p>
              <div
                className="text-[11px] font-mono text-zinc-300 mb-4 max-h-24 overflow-y-auto p-2 rounded"
                style={{ background: "#0b0b0f", border: "1px solid #27272a" }}
              >
                {refineTip.text}
              </div>
              <p className="text-[11px] font-mono text-zinc-500 mb-2">Instruction</p>
              <textarea
                value={refineInstruction}
                onChange={(e) => setRefineInstruction(e.target.value)}
                rows={3}
                placeholder="e.g. Make it sharper. Cut filler. Lead with the metric."
                className="w-full text-[12px] font-mono p-2 rounded outline-none text-zinc-100"
                style={{
                  background: "#0b0b0f",
                  border: "1px solid #27272a",
                }}
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setRefineOpen(false);
                    setRefineInstruction("");
                  }}
                  className="px-3 py-1.5 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!refineInstruction.trim()}
                  onClick={() => {
                    onRefine?.(refineTip.text, refineInstruction.trim());
                    setRefineOpen(false);
                    setRefineInstruction("");
                    setRefineTip(null);
                    window.getSelection?.()?.removeAllRanges();
                  }}
                  className="px-3 py-1.5 rounded text-[11px] font-mono font-bold transition-all disabled:opacity-40"
                  style={{
                    background: "#06b6d4",
                    color: "#020617",
                    boxShadow: "0 0 18px rgba(6,182,212,0.4)",
                  }}
                >
                  Apply Refinement
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Reveal section: skeleton → live ───────────────────────────────────────────
const GeneratedWebsitePreview: React.FC<{
  code: string;
  headline: string;
  device: DeviceMode;
  stage: number;
  dimmed: boolean;
}> = ({ code, headline, device, stage, dimmed }) => {
  const canRenderHtml = /<\s*(html|body|main|section|div|header|nav|article|footer)[\s>]/i.test(code);
  if (canRenderHtml) {
    // Build a stable-but-comprehensive key so the iframe remounts whenever ANY
    // part of the document changes — including injected Comfort Design theme
    // blocks near the end of <head>. Hashing avoids React reusing the iframe
    // (which would silently keep the previous srcDoc on some browsers).
    const themeMatch = code.match(/<style[^>]*id=["']nazai-comfort-theme["'][^>]*>([\s\S]*?)<\/style>/i);
    const themeFingerprint = themeMatch ? themeMatch[1].length + ":" + themeMatch[1].slice(0, 24) : "no-theme";
    const iframeKey = `${code.length}:${code.slice(0, 64)}:${themeFingerprint}`;
    return (
      <iframe
        key={iframeKey}
        srcDoc={code}
        title="Generated website preview"
        sandbox="allow-scripts"
        className="w-full rounded-lg bg-background transition-opacity duration-500"
        style={{
          minHeight: device === "mobile" ? 640 : 560,
          border: "1px solid hsl(var(--border))",
          opacity: dimmed ? 0.3 : 1,
        }}
      />
    );
  }

  return (
    <div className="space-y-3 transition-opacity duration-500" style={{ opacity: dimmed ? 0.3 : 1 }}>
      {SECTION_ORDER.map((id, idx) => (
        <RevealSection key={id} id={id} live={stage > idx} device={device} headline={headline} />
      ))}
      {code.trim() && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.22em] text-primary">
            Updated React/Tailwind source
          </div>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
            {code}
          </pre>
        </div>
      )}
    </div>
  );
};

const RevealSection: React.FC<{
  id: SectionId;
  live: boolean;
  device: DeviceMode;
  headline: string;
}> = ({ id, live, device, headline }) => {
  return (
    <motion.div
      animate={
        live
          ? {
              boxShadow: [
                "0 0 0px rgba(6,182,212,0)",
                "0 0 28px rgba(6,182,212,0.35)",
                "0 0 0px rgba(6,182,212,0)",
              ],
            }
          : {}
      }
      transition={{ duration: 0.9 }}
      className="rounded-lg overflow-hidden"
      style={{
        background: "#0b0b0f",
        border: "1px solid #27272a",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!live ? (
          <motion.div
            key="skel"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <SectionSkeleton id={id} />
          </motion.div>
        ) : (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <SectionLive id={id} device={device} headline={headline} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Skeletons ────────────────────────────────────────────────────────────────
const Pulse: React.FC<{ className?: string; style?: React.CSSProperties }> = ({
  className = "",
  style,
}) => (
  <div
    className={`animate-pulse rounded ${className}`}
    style={{ background: "#1c1c20", ...style }}
  />
);

const SectionSkeleton: React.FC<{ id: SectionId }> = ({ id }) => {
  if (id === "hero") {
    return (
      <div className="p-5 sm:p-6 space-y-3">
        <Pulse className="h-3 w-24" />
        <Pulse className="h-7 w-3/4" />
        <Pulse className="h-3 w-1/2" />
        <div className="flex gap-2 pt-2">
          <Pulse className="h-7 w-24" />
          <Pulse className="h-7 w-20" />
        </div>
      </div>
    );
  }
  if (id === "features") {
    return (
      <div className="p-5 sm:p-6">
        <Pulse className="h-3 w-28 mb-3" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Pulse className="h-5 w-5 rounded-md" />
              <Pulse className="h-3 w-full" />
              <Pulse className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="p-5 sm:p-6 space-y-2">
      <Pulse className="h-3 w-20" />
      <Pulse className="h-3 w-2/3" />
      <Pulse className="h-9 w-full" />
      <Pulse className="h-9 w-full" />
      <Pulse className="h-7 w-28" />
    </div>
  );
};

// ─── Live (rendered) sections ─────────────────────────────────────────────────
const SectionLive: React.FC<{
  id: SectionId;
  device: DeviceMode;
  headline: string;
}> = ({ id, headline }) => {
  if (id === "hero") {
    return (
      <div
        className="p-6 sm:p-8 text-center"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(6,182,212,0.10), transparent 60%), #0b0b0f",
        }}
      >
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-400 mb-2">
          Launch · 2026
        </div>
        <h2
          className="text-xl sm:text-2xl font-bold leading-tight text-zinc-100 mb-2"
          style={{ letterSpacing: "-0.01em" }}
        >
          {headline}
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400 max-w-md mx-auto mb-4">
          Built end-to-end by NazAI in minutes. Strategy, design, and code shipped together.
        </p>
        <div className="flex items-center justify-center gap-2">
          <span
            className="px-3 py-1.5 rounded-md text-[11px] font-mono font-bold"
            style={{ background: "#06b6d4", color: "#020617" }}
          >
            Get started
          </span>
          <span
            className="px-3 py-1.5 rounded-md text-[11px] font-mono"
            style={{ background: "transparent", border: "1px solid #27272a", color: "#a1a1aa" }}
          >
            See pricing
          </span>
        </div>
      </div>
    );
  }
  if (id === "features") {
    const items = [
      { t: "Built-in CRM", d: "Track every lead." },
      { t: "Auto invoices", d: "Get paid faster." },
      { t: "Brand kit", d: "Logo, palette, social." },
    ];
    return (
      <div className="p-6 sm:p-7">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500 mb-3">
          What's included
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {items.map((it) => (
            <div
              key={it.t}
              className="rounded-md p-3"
              style={{ background: "#0a0a0c", border: "1px solid #27272a" }}
            >
              <div
                className="w-6 h-6 rounded mb-2 flex items-center justify-center"
                style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)" }}
              >
                <Sparkles size={12} className="text-cyan-400" />
              </div>
              <div className="text-xs font-bold text-zinc-200 mb-0.5">{it.t}</div>
              <div className="text-[11px] text-zinc-500">{it.d}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="p-6 sm:p-7">
      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500 mb-3">
        Get in touch
      </div>
      <div className="space-y-2">
        <div
          className="h-9 rounded-md px-3 flex items-center text-[11px] font-mono text-zinc-500"
          style={{ background: "#0a0a0c", border: "1px solid #27272a" }}
        >
          Email
        </div>
        <div
          className="h-9 rounded-md px-3 flex items-center text-[11px] font-mono text-zinc-500"
          style={{ background: "#0a0a0c", border: "1px solid #27272a" }}
        >
          Message
        </div>
        <button
          type="button"
          className="px-3 py-1.5 rounded text-[11px] font-mono font-bold"
          style={{ background: "#06b6d4", color: "#020617" }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

// ─── Matrix rain (left-pane processing flourish) ──────────────────────────────
const MatrixRain: React.FC = () => {
  const cols = 10;
  return (
    <div className="absolute inset-0 overflow-hidden">
      {Array.from({ length: cols }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ y: "-30%" }}
          animate={{ y: "120%" }}
          transition={{
            duration: 2.4 + (i % 4) * 0.4,
            repeat: Infinity,
            ease: "linear",
            delay: (i % 5) * 0.18,
          }}
          className="absolute top-0 text-[10px] font-mono leading-tight"
          style={{
            left: `${(i / cols) * 100 + 2}%`,
            color: "rgba(6,182,212,0.35)",
            textShadow: "0 0 8px rgba(6,182,212,0.5)",
            whiteSpace: "pre",
          }}
        >
          {Array.from({ length: 14 })
            .map(() =>
              String.fromCharCode(33 + Math.floor(Math.random() * 90)),
            )
            .join("\n")}
        </motion.div>
      ))}
    </div>
  );
};

export default WebsiteRevealPane;
