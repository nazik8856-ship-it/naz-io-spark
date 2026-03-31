import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Cpu, Zap, Radio } from "lucide-react";

const NODES = [
  { id: "input", label: "INPUT SENSOR", desc: "Signal Capture", icon: Radio, color: "#00A3FF" },
  { id: "logic", label: "LOGIC GATE", desc: "Decision Matrix", icon: Cpu, color: "#00A3FF" },
  { id: "engine", label: "AUTO ENGINE", desc: "Process Core", icon: Activity, color: "#00A3FF" },
  { id: "exec", label: "EXECUTION", desc: "Deploy Signal", icon: Zap, color: "#00A3FF" },
];

const LOG_SEQUENCE = [
  "NAZAI_OS: LINKED",
  "WORKFLOWER: ACTIVE",
  "SENSOR ARRAY: CALIBRATING...",
  "LOGIC GATE: HANDSHAKE OK",
  "ENGINE CORE: SPINNING UP — 12ms",
  "EXECUTION PIPELINE: ARMED",
  "SIGNAL INTEGRITY: 99.7%",
  "NEURAL HANDSHAKE: CONFIRMED",
  "DATA THROUGHPUT: 2.4 GB/s",
  "CYCLE LATENCY: 8ms",
  "AUTOMOTIVE BUS: CAN-FD ACTIVE",
  "TELEMETRY STREAM: NOMINAL",
  "WATCHDOG TIMER: RESET",
  "WORKFLOWER CYCLE: COMPLETE",
];

const Workflower = () => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => {
      const ts = new Date().toISOString().slice(11, 19);
      setLogs((p) => {
        const next = [...p, `[${ts}] ${LOG_SEQUENCE[i % LOG_SEQUENCE.length]}`];
        return next.length > 40 ? next.slice(-40) : next;
      });
      i++;
    }, 1600);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="min-h-screen w-full font-mono text-white overflow-hidden" style={{ background: "#050505" }}>
      {/* Subtle grid */}
      <div className="fixed inset-0 opacity-[0.025] pointer-events-none"
           style={{ backgroundImage: "linear-gradient(#00A3FF 1px, transparent 1px), linear-gradient(90deg, #00A3FF 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

      <div className="relative z-10 flex flex-col h-screen">
        {/* ── HEADER ── */}
        <header className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: "rgba(0,163,255,0.08)" }}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center border"
                 style={{ borderColor: "rgba(0,163,255,0.25)", background: "rgba(0,163,255,0.04)", boxShadow: "0 0 24px rgba(0,163,255,0.12)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ filter: "drop-shadow(0 0 8px #00A3FF)" }}>
                <path d="M7 19V5L17 19V5" stroke="#00A3FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic leading-none">
                Naz<span style={{ color: "#00A3FF" }}>AI</span>
                <span className="text-white/20 text-sm ml-2 not-italic font-medium tracking-normal">Workflower</span>
              </h1>
              <p className="text-[8px] uppercase tracking-[0.5em] mt-1" style={{ color: "rgba(0,163,255,0.3)" }}>
                Automotive Logic Flow v1.0
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{ borderColor: "rgba(0,163,255,0.15)", background: "rgba(0,163,255,0.04)" }}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#00A3FF", boxShadow: "0 0 6px #00A3FF" }} />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "#00A3FF" }}>System Online</span>
            </div>
          </div>
        </header>

        {/* ── CANVAS ── */}
        <div className="flex-1 relative flex items-center justify-center px-8 py-6">
          <div className="w-full max-w-5xl rounded-2xl border relative overflow-hidden"
               style={{ borderColor: "rgba(0,163,255,0.08)", background: "rgba(0,163,255,0.015)", height: "clamp(320px, 50vh, 460px)" }}>

            {/* Decorative corner markers */}
            {["top-3 left-3", "top-3 right-3", "bottom-3 left-3", "bottom-3 right-3"].map((pos, i) => (
              <div key={i} className={`absolute ${pos} w-3 h-3 border opacity-20`}
                   style={{ borderColor: "#00A3FF", borderWidth: i < 2 ? "1px 0 0 1px" : "0 1px 1px 0", transform: `rotate(${i * 90}deg)` }} />
            ))}

            {/* SVG connections */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 460">
              <defs>
                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00A3FF" stopOpacity="0.05" />
                  <stop offset="50%" stopColor="#00A3FF" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#00A3FF" stopOpacity="0.05" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Three connection segments */}
              {[0, 1, 2].map((i) => {
                const x1 = 155 + i * 250;
                const x2 = x1 + 190;
                const y = 230;
                return (
                  <g key={`conn-${i}`}>
                    {/* Base line */}
                    <line x1={x1} y1={y} x2={x2} y2={y} stroke="url(#lineGrad)" strokeWidth="1" />
                    {/* Pulse dot */}
                    <circle r="3" fill="#00A3FF" filter="url(#glow)">
                      <animateMotion dur={`${1.2 + i * 0.2}s`} repeatCount="indefinite"
                        path={`M${x1},${y} L${x2},${y}`} />
                    </circle>
                    <circle r="8" fill="#00A3FF" opacity="0.1">
                      <animateMotion dur={`${1.2 + i * 0.2}s`} repeatCount="indefinite"
                        path={`M${x1},${y} L${x2},${y}`} />
                    </circle>
                    {/* Arrow */}
                    <text x={(x1 + x2) / 2} y={y - 14} textAnchor="middle" fill="#00A3FF" opacity="0.15" fontSize="10" fontFamily="monospace">▸</text>
                  </g>
                );
              })}
            </svg>

            {/* Interactive Nodes */}
            <div className="absolute inset-0 flex items-center justify-around px-12">
              {NODES.map((node, idx) => {
                const Icon = node.icon;
                const isHovered = hoveredNode === node.id;
                return (
                  <motion.div
                    key={node.id}
                    className="relative cursor-pointer select-none"
                    style={{ width: 130 }}
                    onHoverStart={() => setHoveredNode(node.id)}
                    onHoverEnd={() => setHoveredNode(null)}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <motion.div
                      className="rounded-xl border p-5 flex flex-col items-center text-center gap-3"
                      animate={{
                        borderColor: isHovered ? "rgba(0,163,255,0.6)" : "rgba(0,163,255,0.12)",
                        background: isHovered ? "rgba(0,163,255,0.08)" : "rgba(0,163,255,0.02)",
                        boxShadow: isHovered
                          ? "0 0 50px rgba(0,163,255,0.2), 0 0 100px rgba(0,163,255,0.05), inset 0 0 30px rgba(0,163,255,0.03)"
                          : "0 0 0px rgba(0,163,255,0)",
                      }}
                      transition={{ duration: 0.35 }}
                      whileHover={{ scale: 1.06 }}
                    >
                      {/* Icon container */}
                      <motion.div
                        className="w-10 h-10 rounded-lg flex items-center justify-center border"
                        animate={{
                          borderColor: isHovered ? "rgba(0,163,255,0.5)" : "rgba(0,163,255,0.15)",
                          background: isHovered ? "rgba(0,163,255,0.15)" : "rgba(0,163,255,0.05)",
                        }}
                        transition={{ duration: 0.35 }}
                      >
                        <Icon
                          size={18}
                          color="#00A3FF"
                          style={{
                            filter: isHovered ? "drop-shadow(0 0 8px #00A3FF)" : "none",
                            transition: "filter 0.3s ease",
                          }}
                        />
                      </motion.div>

                      <div>
                        <p className="text-[8px] font-black uppercase tracking-[0.15em] leading-tight" style={{ color: "#00A3FF" }}>
                          {node.label}
                        </p>
                        <p className="text-[7px] uppercase tracking-wider mt-1" style={{ color: "rgba(255,255,255,0.15)" }}>
                          {node.desc}
                        </p>
                      </div>

                      {/* Sequence number */}
                      <span className="text-[7px] font-bold" style={{ color: "rgba(0,163,255,0.2)" }}>
                        NODE.0{idx + 1}
                      </span>
                    </motion.div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── SYSTEM LOG ── */}
        <div className="border-t" style={{ borderColor: "rgba(0,163,255,0.08)" }}>
          <div className="flex items-center gap-2 px-6 py-2 border-b" style={{ borderColor: "rgba(0,163,255,0.06)", background: "rgba(0,163,255,0.02)" }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#00A3FF", boxShadow: "0 0 4px #00A3FF" }} />
            <span className="text-[8px] font-black uppercase tracking-[0.4em]" style={{ color: "#00A3FF" }}>
              System Log
            </span>
            <span className="text-[7px] ml-auto" style={{ color: "rgba(0,163,255,0.2)" }}>
              {logs.length} entries
            </span>
          </div>
          <div ref={logRef} className="px-6 py-3 overflow-y-auto" style={{ height: "clamp(100px, 18vh, 160px)" }}>
            <AnimatePresence initial={false}>
              {logs.map((log, i) => (
                <motion.div
                  key={`${i}-${log}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-start gap-2 py-0.5"
                >
                  <span className="text-[9px] shrink-0" style={{ color: "rgba(0,163,255,0.12)" }}>▸</span>
                  <span className="text-[9px] leading-relaxed" style={{ color: "rgba(0,163,255,0.4)" }}>{log}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Workflower;
