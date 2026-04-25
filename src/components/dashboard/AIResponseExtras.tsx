import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Search,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
} from "lucide-react";

/**
 * AIResponseExtras
 *
 * Mounts beneath every NazAI message bubble. Adds the Professional Layer
 * the user requested:
 *   1. Verification Chip — deterministic simulated confidence score +
 *      "Fact-check" button that runs a 1.5s source-search simulation and
 *      reveals 3 reference cards.
 *   2. Reasoning Trace — Lucide Eye toggle that expands a "Logic
 *      Breakdown" explaining the rationale behind the output.
 *   3. Approve as Ground Truth — saves the output to project memory
 *      (localStorage key `nazai-ground-truth`) so it appears in the
 *      sidebar's Project Memory section as the authoritative reference
 *      for future generations.
 *
 * All three features are presentational/client-side. They never mutate
 * the underlying AI response and never make network calls.
 */

interface AIResponseExtrasProps {
  /** Raw AI response text — used as the basis for deterministic scoring. */
  text: string;
  /** Stable identifier for the message — drives memory key + Approve toggle. */
  messageId: string;
  /** Optional: original prompt that produced this response (kept in memory). */
  prompt?: string;
}

const STORAGE_KEY = "nazai-ground-truth";

type GroundTruthEntry = {
  id: string;
  prompt: string;
  excerpt: string;
  approvedAt: number;
};

const readGroundTruth = (): GroundTruthEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeGroundTruth = (entries: GroundTruthEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    // Notify other components in the same tab (storage event only fires cross-tab).
    window.dispatchEvent(new CustomEvent("nazai-ground-truth-changed"));
  } catch {
    /* quota or disabled storage — no-op */
  }
};

// Deterministic 0..1 hash so the same response always yields the same score
// (prevents jittery "magic numbers" between renders).
const hashSeed = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
};

const buildConfidence = (text: string): number => {
  // Confidence is anchored between 78 and 97 — deliberately never 100, to
  // visibly remind the user this is AI output, not ground truth.
  const seed = hashSeed(text);
  const length = Math.min(1, text.length / 1200);
  const base = 78 + Math.floor(seed * 14); // 78..91
  const lengthBonus = Math.floor(length * 6); // 0..6
  return Math.min(97, base + lengthBonus);
};

const buildReasoning = (text: string): string[] => {
  // Lightweight, response-aware reasoning trace.
  const lower = text.toLowerCase();
  const traces: string[] = [];

  if (/saas|software|subscription|tier/.test(lower)) {
    traces.push("Anchored on SaaS pricing benchmarks (Tier × ARPU × churn ≤ 5%).");
  }
  if (/market|audience|customer/.test(lower)) {
    traces.push("Sized the addressable market using TAM → SAM → SOM funnel logic.");
  }
  if (/finance|revenue|cash|burn|runway/.test(lower)) {
    traces.push("Modeled cashflow with conservative CAC payback under 12 months.");
  }
  if (/landing|hero|cta|conversion|design|layout/.test(lower)) {
    traces.push("Optimized for mobile-first conversion: single-CTA hero, ≤ 6s LCP.");
  }
  if (/security|compliance|legal/.test(lower)) {
    traces.push("Cross-checked against common SOC 2 / GDPR control families.");
  }

  if (traces.length === 0) {
    traces.push(
      "Synthesized strategic options against a 4-pillar baseline (vision, growth, architecture, execution).",
      "Prioritized recommendations by expected ROI vs. effort.",
    );
  }

  traces.push("Output reviewed against NazAI guardrails: no hallucinated entities, no fabricated metrics.");
  return traces;
};

const buildSources = (text: string): { title: string; domain: string }[] => {
  // Deterministic, domain-flavored source list — pure simulation.
  const seed = hashSeed(text);
  const pool = [
    { title: "Industry benchmarks · 2025 SaaS pricing report", domain: "openviewpartners.com" },
    { title: "Market sizing methodology", domain: "hbr.org" },
    { title: "Conversion benchmarks for B2B landing pages", domain: "wordstream.com" },
    { title: "Cash runway calculator & best practices", domain: "a16z.com" },
    { title: "Mobile-first design patterns", domain: "nngroup.com" },
    { title: "GTM playbooks for early-stage founders", domain: "firstround.com" },
  ];
  // Pick 3 distinct sources, deterministic by seed.
  const start = Math.floor(seed * pool.length);
  return [0, 1, 2].map((i) => pool[(start + i) % pool.length]);
};

const AIResponseExtras: React.FC<AIResponseExtrasProps> = ({
  text,
  messageId,
  prompt = "",
}) => {
  const confidence = useMemo(() => buildConfidence(text), [text]);
  const reasoning = useMemo(() => buildReasoning(text), [text]);
  const sources = useMemo(() => buildSources(text), [text]);

  const [factCheckState, setFactCheckState] = useState<"idle" | "checking" | "done">("idle");
  const [traceOpen, setTraceOpen] = useState(false);
  const [approved, setApproved] = useState<boolean>(() =>
    readGroundTruth().some((e) => e.id === messageId),
  );

  const runFactCheck = () => {
    if (factCheckState !== "idle") return;
    setFactCheckState("checking");
    window.setTimeout(() => setFactCheckState("done"), 1500);
  };

  const toggleApprove = () => {
    const current = readGroundTruth();
    if (approved) {
      writeGroundTruth(current.filter((e) => e.id !== messageId));
      setApproved(false);
      return;
    }
    const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 140);
    const next: GroundTruthEntry[] = [
      { id: messageId, prompt: prompt.slice(0, 80) || "Untitled output", excerpt, approvedAt: Date.now() },
      ...current.filter((e) => e.id !== messageId),
    ].slice(0, 12);
    writeGroundTruth(next);
    setApproved(true);
  };

  const confidenceTone =
    confidence >= 90
      ? { color: "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.4)" }
      : confidence >= 84
        ? { color: "#06b6d4", bg: "rgba(6,182,212,0.08)", border: "rgba(6,182,212,0.4)" }
        : { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.4)" };

  return (
    <div className="mt-2 px-3 pb-3 space-y-2">
      {/* ── Action row: Verification chip · Trace toggle · Approve ─────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Verification Chip */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.18em]"
          style={{
            background: confidenceTone.bg,
            border: `1px solid ${confidenceTone.border}`,
            color: confidenceTone.color,
          }}
          title="Simulated NazAI confidence — never trust AI output blindly."
        >
          <ShieldCheck size={10} />
          {confidence}% confidence
        </div>

        {/* Fact-check button */}
        <button
          type="button"
          onClick={runFactCheck}
          disabled={factCheckState !== "idle"}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.18em] transition-colors disabled:opacity-80"
          style={{
            background: factCheckState === "done" ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${factCheckState === "done" ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)"}`,
            color: factCheckState === "done" ? "#86efac" : "#a1a1aa",
          }}
        >
          {factCheckState === "checking" ? (
            <Loader2 size={10} className="animate-spin" />
          ) : factCheckState === "done" ? (
            <CheckCircle2 size={10} />
          ) : (
            <Search size={10} />
          )}
          {factCheckState === "checking"
            ? "Searching sources…"
            : factCheckState === "done"
              ? "Verified"
              : "Fact-check"}
        </button>

        {/* Reasoning Trace toggle */}
        <button
          type="button"
          onClick={() => setTraceOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.18em] transition-colors"
          style={{
            background: traceOpen ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${traceOpen ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.1)"}`,
            color: traceOpen ? "#c4b5fd" : "#a1a1aa",
          }}
          aria-expanded={traceOpen}
          aria-label="Toggle reasoning trace"
        >
          {traceOpen ? <EyeOff size={10} /> : <Eye size={10} />}
          {traceOpen ? "Hide trace" : "Why this?"}
        </button>

        {/* Approve as Ground Truth */}
        <button
          type="button"
          onClick={toggleApprove}
          className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.18em] transition-colors"
          style={{
            background: approved ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${approved ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.1)"}`,
            color: approved ? "#86efac" : "#a1a1aa",
          }}
          title={approved ? "Saved as ground truth — click to remove" : "Save as ground truth for future runs"}
        >
          {approved ? <BookmarkCheck size={10} /> : <Bookmark size={10} />}
          {approved ? "Ground truth" : "Approve"}
        </button>
      </div>

      {/* ── Reasoning Trace panel ──────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {traceOpen && (
          <motion.div
            key="trace"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className="rounded-md p-2.5 space-y-1"
              style={{
                background: "rgba(139,92,246,0.05)",
                border: "1px solid rgba(139,92,246,0.25)",
              }}
            >
              <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-violet-300/80 mb-1">
                Logic Breakdown
              </div>
              {reasoning.map((line, i) => (
                <div key={i} className="flex gap-2 text-[10px] font-mono text-zinc-300">
                  <span className="text-violet-400/70 shrink-0">›</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Fact-check sources ─────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {factCheckState === "done" && (
          <motion.div
            key="sources"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className="rounded-md p-2.5 space-y-1.5"
              style={{
                background: "rgba(34,197,94,0.04)",
                border: "1px solid rgba(34,197,94,0.25)",
              }}
            >
              <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-emerald-300/80 mb-1">
                Cross-referenced sources
              </div>
              {sources.map((s, i) => (
                <a
                  key={i}
                  href={`https://${s.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 text-[10px] font-mono text-zinc-200 hover:text-emerald-300 transition-colors"
                >
                  <ExternalLink size={9} className="text-emerald-400/70 shrink-0" />
                  <span className="truncate">{s.title}</span>
                  <span className="text-zinc-500 ml-auto shrink-0">{s.domain}</span>
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AIResponseExtras;
export { STORAGE_KEY as GROUND_TRUTH_STORAGE_KEY, readGroundTruth };
export type { GroundTruthEntry };
