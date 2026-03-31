import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const NODES = [
  { id: "input", label: "INPUT SENSOR", desc: "Signal Capture", x: 80, y: 220 },
  { id: "logic", label: "LOGIC GATE", desc: "Decision Matrix", x: 340, y: 220 },
  { id: "engine", label: "AUTOMATION ENGINE", desc: "Process Core", x: 600, y: 220 },
  { id: "output", label: "OUTPUT EXECUTION", desc: "Deploy Signal", x: 860, y: 220 },
];

const LOG_LINES = [
  "INITIALIZING SENSORS...",
  "LOGIC STREAM ACTIVE...",
  "PARSING INPUT SIGNAL → 0xAF3B",
  "GATE EVALUATION: PASS",
  "ROUTING TO ENGINE CORE...",
  "AUTOMATION SEQUENCE: ENGAGED",
  "OUTPUT PIPELINE: READY",
  "EXECUTING DEPLOYMENT PROTOCOL...",
  "SIGNAL INTEGRITY: 99.7%",
  "CYCLE COMPLETE. AWAITING NEXT INPUT.",
  "HEARTBEAT: OK — 12ms LATENCY",
  "NEURAL HANDSHAKE CONFIRMED",
];

const WorkflowerPage = () => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setLogs((prev) => {
        const next = [...prev, `[${new Date().toISOString().slice(11, 19)}] ${LOG_LINES[i % LOG_LINES.length]}`];
        return next.length > 20 ? next.slice(-20) : next;
      });
      i++;
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen font-mono text-white" style={{ background: "#050505" }}>
      {/* Grid overlay */}
      <div className="fixed inset-0 z-0 opacity-[0.04] pointer-events-none"
           style={{ backgroundImage: 'linear-gradient(#00A3FF 1px, transparent 1px), linear-gradient(90deg, #00A3FF 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 space-y-10">
        {/* Header */}
        <header className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center border border-[#00A3FF]/30"
               style={{ background: "rgba(0,163,255,0.05)", boxShadow: "0 0 30px rgba(0,163,255,0.15)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                 style={{ filter: "drop-shadow(0 0 10px #00A3FF)" }}>
              <path d="M7 19V5L17 19V5" stroke="#00A3FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic">
              Naz<span style={{ color: "#00A3FF" }}>AI</span>{" "}
              <span className="text-white/30 text-lg">Workflower</span>
            </h1>
            <p className="text-[9px] uppercase tracking-[0.5em] text-white/20 mt-0.5">
              Automotive Logic Flow v1.0
            </p>
          </div>
        </header>

        {/* Workflower Canvas */}
        <div className="relative rounded-2xl border border-[#00A3FF]/10 overflow-hidden"
             style={{ background: "rgba(0,163,255,0.02)", minHeight: 440 }}>
          
          <svg width="100%" height="440" viewBox="0 0 1000 440" className="block">
            {/* Connection lines */}
            {NODES.slice(0, -1).map((node, i) => {
              const next = NODES[i + 1];
              return (
                <g key={`line-${i}`}>
                  {/* Static line */}
                  <line
                    x1={node.x + 60} y1={node.y}
                    x2={next.x - 60} y2={next.y}
                    stroke="#00A3FF" strokeWidth="1" opacity="0.15"
                  />
                  {/* Pulsing data dot */}
                  <circle r="4" fill="#00A3FF" opacity="0.9">
                    <animateMotion
                      dur={`${1.5 + i * 0.3}s`}
                      repeatCount="indefinite"
                      path={`M${node.x + 60},${node.y} L${next.x - 60},${next.y}`}
                    />
                  </circle>
                  <circle r="8" fill="#00A3FF" opacity="0.2">
                    <animateMotion
                      dur={`${1.5 + i * 0.3}s`}
                      repeatCount="indefinite"
                      path={`M${node.x + 60},${node.y} L${next.x - 60},${next.y}`}
                    />
                  </circle>
                </g>
              );
            })}
          </svg>

          {/* Nodes overlay */}
          <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
            {NODES.map((node) => (
              <motion.div
                key={node.id}
                className="absolute cursor-pointer"
                style={{
                  left: node.x - 60,
                  top: node.y - 55,
                  width: 120,
                  pointerEvents: "auto",
                }}
                onHoverStart={() => setHoveredNode(node.id)}
                onHoverEnd={() => setHoveredNode(null)}
                whileHover={{ scale: 1.08 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <motion.div
                  className="rounded-xl border px-3 py-4 text-center"
                  style={{
                    background: hoveredNode === node.id
                      ? "rgba(0,163,255,0.12)"
                      : "rgba(0,163,255,0.04)",
                    borderColor: hoveredNode === node.id
                      ? "rgba(0,163,255,0.6)"
                      : "rgba(0,163,255,0.15)",
                    boxShadow: hoveredNode === node.id
                      ? "0 0 40px rgba(0,163,255,0.25), inset 0 0 20px rgba(0,163,255,0.05)"
                      : "none",
                    transition: "all 0.3s ease",
                  }}
                >
                  <div className="w-8 h-8 mx-auto mb-2 rounded-lg flex items-center justify-center"
                       style={{ background: "rgba(0,163,255,0.1)", border: "1px solid rgba(0,163,255,0.2)" }}>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#00A3FF", boxShadow: "0 0 8px #00A3FF" }} />
                  </div>
                  <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#00A3FF" }}>
                    {node.label}
                  </p>
                  <p className="text-[7px] text-white/25 mt-1 uppercase tracking-wider">
                    {node.desc}
                  </p>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Live System Log */}
        <div className="rounded-xl border border-[#00A3FF]/10 overflow-hidden"
             style={{ background: "rgba(0,163,255,0.02)" }}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#00A3FF]/10"
               style={{ background: "rgba(0,163,255,0.04)" }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#00A3FF", boxShadow: "0 0 6px #00A3FF" }} />
            <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: "#00A3FF" }}>
              Live System Log
            </span>
          </div>
          <div className="p-4 h-48 overflow-y-auto flex flex-col gap-1" id="log-container">
            <AnimatePresence>
              {logs.map((log, i) => (
                <motion.p
                  key={`${i}-${log}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-[10px] leading-relaxed"
                  style={{ color: "rgba(0,163,255,0.5)" }}
                >
                  <span className="text-white/10 mr-2">▸</span>
                  {log}
                </motion.p>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowerPage;
