import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Cpu,
  Palette,
  Code2,
  ShieldAlert,
  X,
  Loader2,
  CheckCircle2,
  AlertOctagon,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * AgentThinkTank
 * Streams the 4-agent chain (Architect+Pixel → Syntax → Echo) via SSE
 * from the agent-think-tank edge function and renders a terminal-style
 * "thought process" log. Echo can intercept with Authority Mode
 * ("You're completely wrong.") for inefficient directives.
 *
 * This is fully additive — it does not touch the existing mission flow.
 * It runs in a slide-up modal triggered from the Dashboard input pill.
 */

type AgentId = "architect" | "pixel" | "syntax" | "echo";

type Frame =
  | { type: "init"; directive: string; chain: string[]; trash_signals: string[]; ts: number }
  | { type: "phase"; phase: string; ts: number }
  | { type: "agent_start"; agent: AgentId; label: string; ts: number }
  | { type: "agent_done"; agent: AgentId; label: string; output: any; duration_ms: number; ts: number }
  | { type: "agent_error"; agent: AgentId; label: string; message: string; ts: number }
  | {
      type: "authority_intercept";
      agent: AgentId;
      label: string;
      message: string;
      alternative: { architect_thesis: string | null; suggested_stack: string[]; suggested_actions: string[] };
      ts: number;
    }
  | { type: "final"; intercept: boolean; architect: any; pixel: any; syntax: any; echo: any; total_ms: number; ts: number }
  | { type: "error"; message: string; ts: number };

const AGENT_META: Record<AgentId, { Icon: React.ElementType; color: string; role: string }> = {
  architect: { Icon: Cpu, color: "#06b6d4", role: "Lead Strategist" },
  pixel: { Icon: Palette, color: "#8b5cf6", role: "Designer" },
  syntax: { Icon: Code2, color: "#06b6d4", role: "Engineer" },
  echo: { Icon: ShieldAlert, color: "#f59e0b", role: "QA / Authority" },
};

const formatTs = (ms: number) => {
  const s = (ms / 1000).toFixed(2);
  return `+${s}s`.padStart(7, " ");
};

interface AgentThinkTankProps {
  open: boolean;
  directive: string;
  onClose: () => void;
}

const AgentThinkTank: React.FC<AgentThinkTankProps> = ({ open, directive, onClose }) => {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [frames.length]);

  // Reset & start when opened with a directive
  useEffect(() => {
    if (!open) return;
    if (!directive.trim()) return;

    setFrames([]);
    setError(null);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;
        if (!token) {
          setError("Sign in required to run the Think Tank.");
          setRunning(false);
          return;
        }

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-think-tank`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ directive }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          let msg = `Request failed (${resp.status})`;
          try {
            const j = await resp.json();
            msg = j.error || msg;
          } catch { /* ignore */ }
          setError(msg);
          setRunning(false);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") {
              done = true;
              break;
            }
            try {
              const frame = JSON.parse(payload) as Frame;
              setFrames((prev) => [...prev, frame]);
            } catch {
              // partial — push back
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }

        setRunning(false);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Stream failed");
        setRunning(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [open, directive]);

  // Close & abort
  const handleClose = () => {
    abortRef.current?.abort();
    setRunning(false);
    onClose();
  };

  // Derive view state from frames
  const initFrame = frames.find((f) => f.type === "init") as Extract<Frame, { type: "init" }> | undefined;
  const intercept = frames.find((f) => f.type === "authority_intercept") as
    | Extract<Frame, { type: "authority_intercept" }>
    | undefined;
  const final = frames.find((f) => f.type === "final") as Extract<Frame, { type: "final" }> | undefined;

  const agentStates: Record<AgentId, "idle" | "running" | "done" | "error"> = {
    architect: "idle", pixel: "idle", syntax: "idle", echo: "idle",
  };
  for (const f of frames) {
    if (f.type === "agent_start") agentStates[f.agent] = "running";
    if (f.type === "agent_done") agentStates[f.agent] = "done";
    if (f.type === "agent_error") agentStates[f.agent] = "error";
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 z-[9000]"
            style={{ background: "rgba(2,6,23,0.7)", backdropFilter: "blur(8px)" }}
          />

          {/* Panel — Cloaked: only NazAI brand + unified progress is visible */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9001] w-[min(560px,94vw)] flex flex-col rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(180deg, #050b1c 0%, #020617 100%)",
              border: "1px solid rgba(6,182,212,0.25)",
              boxShadow: "0 60px 120px -30px rgba(6,182,212,0.4), 0 0 60px rgba(6,182,212,0.08)",
            }}
          >
            {/* Cloaked Header — only NazAI brand visible */}
            <div
              className="flex items-center justify-between px-6 py-5 shrink-0"
              style={{ background: "rgba(6,182,212,0.03)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <motion.div
                  animate={{
                    boxShadow: running
                      ? ["0 0 0px rgba(6,182,212,0.0)", "0 0 24px rgba(6,182,212,0.6)", "0 0 0px rgba(6,182,212,0.0)"]
                      : "0 0 0px rgba(6,182,212,0.0)",
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.4)" }}
                >
                  <Brain size={18} style={{ color: "#06b6d4" }} />
                </motion.div>
                <div className="min-w-0">
                  <div className="text-sm font-bold tracking-tight text-white">
                    NazAI
                  </div>
                  <div className="text-[11px] text-white/60 font-mono">
                    {running ? "Orchestrating Business…" : final ? "Orchestration complete" : "Initializing…"}
                  </div>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-7 h-7 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Unified NazAI progress bar (replaces per-agent indicators) */}
            <div className="px-6 pb-5 shrink-0">
              <div
                className="relative h-1.5 w-full rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <motion.div
                  animate={{
                    width: `${
                      Math.round(
                        (Object.values(agentStates).filter((s) => s === "done").length / 4) * 100,
                      ) || (running ? 8 : 0)
                    }%`,
                  }}
                  transition={{ type: "spring", stiffness: 80, damping: 20 }}
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #06b6d4, #8b5cf6)",
                    boxShadow: "0 0 12px rgba(6,182,212,0.5)",
                  }}
                />
                {running && (
                  <motion.div
                    animate={{ x: ["-30%", "130%"] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-y-0 w-1/3"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Hidden: 4-agent details retained in DOM for logic continuity but visually cloaked */}
            <div aria-hidden className="hidden">
              {(Object.keys(AGENT_META) as AgentId[]).map((id) => (
                <span key={id}>{`${id}:${agentStates[id]}`}</span>
              ))}
            </div>

            {/* Authority intercept banner */}
            <AnimatePresence>
              {intercept && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="px-5 py-4 shrink-0"
                  style={{
                    background: "linear-gradient(90deg, rgba(245,158,11,0.08), rgba(239,68,68,0.04))",
                    borderBottom: "1px solid rgba(245,158,11,0.25)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <ShieldAlert size={18} className="shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-mono tracking-[0.22em] uppercase mb-1" style={{ color: "#f59e0b" }}>
                        Authority Mode · Echo intercepted
                      </div>
                      <p className="text-sm text-white leading-relaxed">{intercept.message}</p>
                      {!!intercept.alternative.suggested_actions?.length && (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                          {intercept.alternative.suggested_actions.slice(0, 4).map((act, i) => (
                            <div
                              key={i}
                              className="text-xs text-white/80 px-3 py-2 rounded-md flex items-center gap-2"
                              style={{
                                background: "rgba(245,158,11,0.06)",
                                border: "1px solid rgba(245,158,11,0.2)",
                              }}
                            >
                              <Sparkles size={10} style={{ color: "#f59e0b" }} />
                              <span className="truncate">{act}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Terminal log */}
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto p-5 font-mono text-[11px] leading-relaxed"
              style={{ background: "#020617" }}
            >
              {error && (
                <div className="text-red-400 flex items-center gap-2 mb-3">
                  <AlertOctagon size={12} />
                  {error}
                </div>
              )}

              {initFrame && (
                <div className="text-white/50 mb-3">
                  <span className="text-cyan-400">[{formatTs(initFrame.ts)}]</span>{" "}
                  <span className="text-white/40">init</span> → directive accepted ·
                  chain: <span className="text-white/70">{initFrame.chain.join(" → ")}</span>
                  {!!initFrame.trash_signals.length && (
                    <span className="text-amber-400/80">
                      {" · "}heuristic flags: {initFrame.trash_signals.join(", ")}
                    </span>
                  )}
                </div>
              )}

              {frames.map((f, i) => (
                <FrameLine key={i} frame={f} />
              ))}

              {final && (
                <div
                  className="mt-4 p-3 rounded-md"
                  style={{
                    background: "rgba(6,182,212,0.05)",
                    border: "1px solid rgba(6,182,212,0.2)",
                  }}
                >
                  <div className="text-cyan-300 mb-2">
                    [{formatTs(final.total_ms)}] FINAL · chain complete
                  </div>
                  {!final.intercept && final.echo?.headline && (
                    <div className="text-white/90 text-sm font-sans">
                      <span className="font-semibold">{final.echo.headline}</span>
                      <span className="text-white/50"> — {final.echo.subhead}</span>
                    </div>
                  )}
                </div>
              )}

              {!frames.length && !error && (
                <div className="text-white/30 italic">Awaiting first frame…</div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const FrameLine: React.FC<{ frame: Frame }> = ({ frame }) => {
  if (frame.type === "init") return null;
  if (frame.type === "phase") {
    return (
      <div className="text-white/40 my-2">
        <span className="text-cyan-400">[{formatTs(frame.ts)}]</span>{" "}
        <span className="text-violet-400">phase</span> → {frame.phase}
      </div>
    );
  }
  if (frame.type === "agent_start") {
    const meta = AGENT_META[frame.agent];
    return (
      <div className="text-white/70">
        <span className="text-cyan-400">[{formatTs(frame.ts)}]</span>{" "}
        <span style={{ color: meta.color }}>{frame.agent}</span> → connecting…
      </div>
    );
  }
  if (frame.type === "agent_done") {
    const meta = AGENT_META[frame.agent];
    const summary = summarizeOutput(frame.agent, frame.output);
    return (
      <div className="text-white/80 mb-1">
        <span className="text-cyan-400">[{formatTs(frame.ts)}]</span>{" "}
        <span style={{ color: meta.color }}>{frame.agent}</span>{" "}
        <span className="text-white/40">({frame.duration_ms}ms)</span> ✓
        {summary && (
          <div className="pl-7 text-white/55 mt-0.5">{summary}</div>
        )}
      </div>
    );
  }
  if (frame.type === "agent_error") {
    return (
      <div className="text-red-400">
        <span className="text-cyan-400">[{formatTs(frame.ts)}]</span> {frame.agent} ✗ {frame.message}
      </div>
    );
  }
  if (frame.type === "authority_intercept") {
    return (
      <div className="text-amber-400 my-2">
        <span className="text-cyan-400">[{formatTs(frame.ts)}]</span>{" "}
        <span className="font-semibold">echo</span> → AUTHORITY INTERCEPT
      </div>
    );
  }
  if (frame.type === "error") {
    return (
      <div className="text-red-400 mt-2">
        <span className="text-cyan-400">[{formatTs(frame.ts)}]</span> stream error: {frame.message}
      </div>
    );
  }
  return null;
};

const summarizeOutput = (agent: AgentId, output: any): string => {
  if (!output || output._unparsed) return "(unstructured response)";
  switch (agent) {
    case "architect":
      return `verdict: ${output.verdict ?? "?"} · ${output.thesis ?? ""}`;
    case "pixel":
      return `aesthetic: ${output.aesthetic ?? "?"} · palette: ${(output.palette ?? []).slice(0, 3).join(" ")}`;
    case "syntax":
      return `${(output.modules ?? []).length} modules · ${(output.build_order ?? []).length} build steps`;
    case "echo":
      return output.intercept
        ? `INTERCEPT — ${(output.authority_message ?? "").slice(0, 80)}…`
        : `pass · "${output.headline ?? ""}"`;
  }
};

export default AgentThinkTank;
