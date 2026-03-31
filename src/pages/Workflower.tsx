import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Cpu, Zap, Radio } from "lucide-react";

const NODES = [
  { id: "input", label: "INPUT SENSOR", desc: "SIGNAL CAPTURE & VALIDATION", icon: Radio, color: "#00A3FF" },
  { id: "logic", label: "LOGIC GATE", desc: "DECISION MATRIX ARCHITECT", icon: Cpu, color: "#00A3FF" },
  { id: "engine", label: "AUTO ENGINE", desc: "PROCESS CORE EXECUTION", icon: Activity, color: "#00A3FF" },
  { id: "exec", label: "EXECUTION", desc: "DEPLOY & LIVE SIGNAL", icon: Zap, color: "#00A3FF" },
];

const LOG_SEQUENCE = [
  "NAZAI_OS: LINKED",
  "THERMAL_CORE: STABILIZED",
  "BLUE_RED_GRADIENT: ACTIVE",
  "MISSION_READY: 100%",
  "ENGINE CORE: SPINNING UP — 12ms",
  "EXECUTION PIPELINE: ARMED",
];

const Workflower = () => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="min-h-screen w-full font-mono text-white overflow-x-hidden"
      /* FIX: THE BLUE-RED THERMAL GRADIENT */
      style={{ background: "linear-gradient(180deg, #0A192F 0%, #1A0B0B 100%)", backgroundAttachment: "fixed" }}
    >
      <div className="relative z-10 flex flex-col min-h-screen">
        
        {/* ── HEADER ── */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-white/5 bg-black/20 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center border border-[#00A3FF]/30 bg-[#00A3FF]/5 shadow-[0_0_24px_rgba(0,163,255,0.15)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="drop-shadow-[0_0_8px_#00A3FF]">
                <path d="M7 19V5L17 19V5" stroke="#00A3FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic leading-none">
                Naz<span className="text-[#00A3FF]">AI</span>
                <span className="text-white/20 text-sm ml-2 not-italic font-medium">Workflower</span>
              </h1>
              <p className="text-[8px] uppercase tracking-[0.5em] mt-1 text-[#00A3FF]/50">
                Automotive Logic Flow v3.1
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#39FF14]/20 bg-[#39FF14]/5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#39FF14] shadow-[0_0_6px_#39FF14]" />
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#39FF14]">System Online</span>
          </div>
        </header>

        {/* ── HERO HEADLINE ── */}
        <div className="relative px-8 py-20 text-center">
          <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tight leading-tight">
            <span className="text-white">Welcome to </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00A3FF] to-[#00E0FF] drop-shadow-[0_0_15px_rgba(0,163,255,0.6)]">NazAI</span>
            <span className="text-white">.</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#10B981] to-[#39FF14] drop-shadow-[0_0_20px_rgba(16,185,129,0.6)]">One Prompt, </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF0055] to-[#990033] drop-shadow-[0_0_25px_rgba(255,0,85,0.6)]">Solutions Orchestrated</span>
          </h2>

          {/* --- BRIGHT NEON BUTTONS (HEADLINE ADJACENT) --- */}
          <div className="flex flex-wrap items-center justify-center gap-6 mt-12 mb-10">
            <button className="px-10 py-4 bg-[#39FF14] text-black font-black uppercase tracking-[0.2em] text-xs hover:bg-[#10B981] hover:scale-105 transition-all drop-shadow-[0_0_25px_rgba(57,255,20,0.7)] border-b-4 border-[#059669]">
              START_MISSION_NOW >>
            </button>
            <button className="px-10 py-4 bg-transparent text-[#39FF14] border-2 border-[#39FF14] font-black uppercase tracking-[0.2em] text-xs hover:bg-[#39FF14]/10 backdrop-blur-sm">
              VIEW_BLUEPRINTS
            </button>
          </div>
        </div>

        {/* ── USAGE BLUEPRINT (ILLUMINATED) ── */}
        <div className="px-8 py-16 bg-black/40 border-y border-white/5">
          <h2 className="text-[10px] font-black uppercase tracking-[0.5em] mb-12 text-center text-[#00A3FF] drop-shadow-[0_0_10px_#00A3FF]">
            Usage_Blueprint_V3
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {NODES.map((node, idx) => {
              const Icon = node.icon;
              return (
                <div key={node.id} className="group rounded-xl border border-[#00A3FF]/20 p-6 flex flex-col gap-4 bg-[#0A192F]/40 hover:border-[#00A3FF]/60 transition-all">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-[#00A3FF]/30 bg-[#00A3FF]/10">
                    <Icon size={20} color="#00A3FF" className="group-hover:drop-shadow-[0_0_8px_#00A3FF]" />
                  </div>
                  {/* FIX: BRIGHT NAMES AND WHITE TEXT */}
                  <h3 className="text-xs font-black text-[#00A3FF] uppercase tracking-widest drop-shadow-[0_0_8px_rgba(0,163,255,0.8)]">
                    {node.label}
                  </h3>
                  <p className="text-[10px] text-white font-medium uppercase tracking-widest leading-relaxed opacity-90">
                    {node.desc}
                  </p>
                  <span className="text-[8px] text-white/20 font-mono tracking-[0.4em]">NODE.0{idx + 1}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── SYSTEM LOG ── */}
        <div className="border-t border-white/5 bg-black/60">
          <div className="flex items-center gap-2 px-6 py-2 border-b border-white/5 bg-white/5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#39FF14]" />
            <span className="text-[8px] font-black uppercase tracking-[0.4em] text-[#00A3FF]">Live_Telemetry</span>
          </div>
          <div className="px-6 py-4 h-32 overflow-y-auto font-mono text-[9px] text-[#00A3FF]/60">
            {logs.map((log, i) => (
              <div key={i} className="py-0.5">▸ {log}</div>
            ))}
          </div>
        </div>

        {/* ── FOOTER ── */}
        <footer className="px-8 py-12 border-t border-white/5 bg-black/80">
          <div className="max-w-5xl mx-auto flex justify-between items-center text-[9px] text-white/40 uppercase tracking-widest">
            <span>© 2026_NAZAI_SYSTEMS</span>
            <div className="flex gap-8">
              <span className="hover:text-[#39FF14] cursor-pointer">Diagnostics</span>
              <span className="hover:text-[#39FF14] cursor-pointer">Security_Protocol</span>
            </div>
          </div>
        </footer>

      </div>
    </motion.div>
  );
};

export default Workflower;