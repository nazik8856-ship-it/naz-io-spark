import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Cpu, Zap, Radio, Terminal, Shield, MessageSquare, ChevronRight, Share2, Globe, AlertTriangle } from "lucide-react";

const NODES = [
  { id: "input", label: "INPUT SENSOR", desc: "SIGNAL CAPTURE & VALIDATION", icon: Radio },
  { id: "logic", label: "LOGIC GATE", desc: "DECISION MATRIX ARCHITECT", icon: Cpu },
  { id: "engine", label: "AUTO ENGINE", desc: "PROCESS CORE EXECUTION", icon: Activity },
  { id: "exec", label: "EXECUTION", desc: "DEPLOY & LIVE SIGNAL", icon: Zap },
];

const Workflower = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const ts = new Date().toISOString().slice(11, 19);
      const entries = ["CORE_STABLE", "SIGNAL_100%", "BUS_ACTIVE", "LINK_SECURE", "GLOBAL_SYNC_OK"];
      setLogs(p => [...p, `[${ts}] ${entries[Math.floor(Math.random() * entries.length)]}`].slice(-12));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen w-full font-mono text-white selection:bg-[#39FF14] selection:text-black overflow-x-hidden"
      style={{ background: "linear-gradient(180deg, #0A192F 0%, #1A0B0B 100%)", backgroundAttachment: "fixed" }}
    >
      <style>{`
        @keyframes shimmer { 100% { transform: translateX(100%); } }
      `}</style>

      {/* 3D PARALLAX GRID */}
      <div className="fixed inset-0 opacity-[0.08] pointer-events-none"
           style={{
             backgroundImage: "linear-gradient(#00A3FF 1px, transparent 1px), linear-gradient(90deg, #00A3FF 1px, transparent 1px)",
             backgroundSize: "60px 60px",
             transform: `translateY(${scrollY * 0.12}px) rotateX(10deg)`,
             willChange: "transform",
           }} />

      <div className="relative z-10 flex flex-col">
        
        {/* ── HEADER ── */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-white/5 bg-black/60 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border border-[#00A3FF]/40 flex items-center justify-center bg-[#00A3FF]/10 shadow-[0_0_20px_rgba(0,163,255,0.3)]">
              <span className="text-[#00A3FF] font-black text-xl italic">N</span>
            </div>
            <div>
              <h1 className="text-lg font-black uppercase tracking-tighter italic leading-none">Naz<span className="text-[#00A3FF]">AI</span></h1>
              <p className="text-[7px] text-white/40 tracking-[0.4em] uppercase font-bold mt-0.5">Global_Systems_v3.1</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-[#39FF14]/20 bg-[#39FF14]/5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#39FF14] animate-pulse" />
            <span className="text-[8px] text-[#39FF14] uppercase tracking-[0.2em] font-black">System_Active</span>
          </div>
        </header>

        {/* ── HERO ── */}
        <div className="py-32 text-center px-6 relative">
          <h2 className="text-5xl md:text-8xl font-black uppercase tracking-tighter mb-12 leading-[0.9]">
            <span className="text-white">Welcome to </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00A3FF] to-[#00E0FF] drop-shadow-[0_0_25px_#00A3FF]">NazAI</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#10B981] to-[#39FF14]">One Prompt, </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF0055] to-[#7A0000] drop-shadow-[0_0_30px_rgba(255,0,85,0.5)]">Solutions Orchestrated</span>
          </h2>
          
          <div className="flex flex-wrap justify-center gap-8">
            {/* PRIMARY BUTTON */}
            <button className="group relative px-12 py-5 bg-[#39FF14] text-black font-black uppercase text-[11px] border-b-4 border-[#059669] hover:scale-105 active:scale-95 transition-all overflow-hidden shadow-[0_0_40px_rgba(57,255,20,0.4)]">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite]" />
              START_MISSION_NOW
            </button>

            {/* UPDATED SECONDARY BUTTON WITH SHIMMER */}
            <button className="group relative px-12 py-5 border-2 border-[#39FF14] text-[#39FF14] font-black uppercase text-[11px] hover:bg-[#39FF14]/10 backdrop-blur-md transition-all tracking-[0.2em] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#39FF14]/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite]" />
              VIEW_PLANS
            </button>
          </div>
        </div>

        {/* ── INTERACTIVE SCHEMATIC CANVAS ── */}
        <div className="px-8 py-12">
          <div className="max-w-6xl mx-auto h-[450px] rounded-3xl border border-white/10 bg-black/40 relative overflow-hidden backdrop-blur-lg">
            <svg className="absolute inset-0 w-full h-full">
              {[0, 1, 2].map((i) => (
                <g key={i}>
                  <line x1={`${28 + i * 24}%`} y1="50%" x2={`${48 + i * 24}%`} y2="50%" stroke="#00A3FF" strokeWidth="1" strokeDasharray="5 5" opacity="0.2" />
                  <circle r="4" fill="#00A3FF" filter="drop-shadow(0 0 5px #00A3FF)">
                    <animateMotion dur="2s" repeatCount="indefinite" path={`M ${260 + i * 240} 225 L ${460 + i * 240} 225`} />
                  </circle>
                </g>
              ))}
            </svg>
            <div className="absolute inset-0 flex items-center justify-around px-10">
              {NODES.map((node, i) => (
                <div key={i} className="flex flex-col items-center gap-6 p-8 rounded-2xl border border-[#00A3FF]/20 bg-[#0A192F]/80 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                  <div className="w-14 h-14 rounded-full border border-[#00A3FF]/40 flex items-center justify-center bg-[#00A3FF]/10">
                    <node.icon size={28} className="text-[#00A3FF]" />
                  </div>
                  <span className="text-[10px] font-black text-[#00A3FF] tracking-[0.3em] uppercase">{node.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── SECTION TITLE: LOGIC_ORCHESTRATION_CORE ── */}
        <section className="py-28 px-8 bg-black/60 border-y border-white/5">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-4 mb-20 justify-center">
              <div className="h-[1px] w-20 bg-[#00A3FF]/40" />
              <h2 className="text-[11px] font-black uppercase tracking-[0.6em] text-[#00A3FF] drop-shadow-[0_0_10px_rgba(0,163,255,0.4)]">
                LOGIC_ORCHESTRATION_CORE
              </h2>
              <div className="h-[1px] w-20 bg-[#00A3FF]/40" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
              {NODES.map((node, i) => (
                <div key={i} className="group p-8 border border-white/5 bg-[#0A192F]/40 hover:border-[#00A3FF]/40 transition-all">
                  <h3 className="text-xs font-black text-[#00A3FF] uppercase mb-6 tracking-widest border-l-2 border-[#39FF14] pl-3">0{i+1}_{node.label}</h3>
                  <p className="text-[12px] text-white font-medium uppercase leading-relaxed tracking-wider opacity-100">
                    {node.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DIAGNOSTICS PORTAL ── */}
        <section className="py-28 px-8">
          <div className="max-w-2xl mx-auto border border-[#00A3FF]/30 bg-black/80 p-12 rounded-3xl shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-10 border-b border-white/5 pb-6">
              <div className="flex items-center gap-3">
                <MessageSquare size={22} className="text-[#39FF14]" />
                <h2 className="text-sm font-black uppercase tracking-[0.5em] text-[#39FF14]">Diagnostics</h2>
              </div>
            </div>
            
            <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-2">
                <label className="text-[9px] text-white/40 tracking-[0.3em] font-bold">OPERATOR_ID</label>
                <input 
                  type="text" 
                  placeholder="OPERATOR_CALLSIGN" 
                  className="w-full bg-white/5 border border-white/10 p-5 text-[11px] text-white placeholder:text-white font-medium focus:border-[#39FF14] outline-none transition-all" 
                />
              </div>
              
              <div className="space-y-2 relative">
                <label className="text-[9px] text-white/40 tracking-[0.3em] font-bold">ANOMALY_DATA</label>
                <textarea 
                  rows={5} 
                  placeholder="TRANSMIT_SYSTEM_ANOMALY..." 
                  className="w-full bg-white/5 border border-white/10 p-5 text-[11px] text-white placeholder:text-white font-medium focus:border-[#39FF14] outline-none transition-all resize-none" 
                />
                <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded bg-[#FF0055]/10 border border-[#FF0055]/30">
                  <AlertTriangle size={14} className="text-[#FF0055]" />
                  <span className="text-[8px] text-[#FF0055] uppercase font-black">Anomaly!</span>
                </div>
              </div>
              
              <button className="w-full py-5 bg-[#39FF14]/10 border border-[#39FF14]/40 text-[#39FF14] font-black uppercase text-[11px] tracking-[0.4em] hover:bg-[#39FF14] hover:text-black transition-all">TRANSMIT_TO_CORE</button>
            </form>
          </div>
        </section>

        {/* ── TELEMETRY LOG ── */}
        <div className="h-48 bg-black border-t border-white/10 p-8 font-mono">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <Terminal size={16} className="text-[#00A3FF]" />
              <span className="text-[10px] text-[#00A3FF] uppercase tracking-[0.6em] font-black">System_Telemetry_Output</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {logs.map((log, i) => (
                  <div key={i} className="text-[11px] text-[#00A3FF]/40 uppercase tracking-tighter flex items-center gap-2">
                    <span className="text-[#39FF14]">{'>>'}</span> {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <footer className="py-24 px-8 bg-[#030303] border-t border-white/5">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-20">
            <div className="space-y-8">
              <div className="flex items-center gap-4">
                <Shield size={28} className="text-[#00A3FF] drop-shadow-[0_0_10px_#00A3FF]" />
                <span className="text-lg font-black uppercase tracking-[0.2em] text-white">NazAI_Global</span>
              </div>
              <p className="text-[11px] text-white/30 leading-loose uppercase tracking-[0.3em]">
                Autonomous_Logic_Deployment<br />
                Global_Sector_Alpha<br />
                © 2026_NazAI_Systems
              </p>
            </div>
            <div className="flex flex-col gap-6">
              <span className="text-[12px] font-black text-[#10B981] uppercase tracking-[0.5em] mb-4">Core_Index</span>
              {["Workflower", "Launch_Pad", "Security_Vault", "Global_API"].map(link => (
                <span key={link} className="text-[10px] text-white/40 hover:text-[#39FF14] cursor-pointer transition-all uppercase tracking-[0.4em] font-bold">{link}</span>
              ))}
            </div>
            <div className="flex flex-col md:items-end gap-4 text-right">
              <span className="text-[12px] font-black text-[#BF00FF] uppercase tracking-[0.5em] mb-4">Uptime_Pulse</span>
              <p className="text-[11px] text-[#00A3FF] uppercase tracking-[0.4em] mt-2 flex items-center justify-end gap-3">
                99.999%_STABLE
                <Globe size={16} className="text-[#00A3FF]/40 animate-pulse" />
              </p>
              <p className="text-[8px] text-white/10 uppercase tracking-[0.7em] mt-24 italic">BUILD_2026.03.31_GLOBAL</p>
            </div>
          </div>
        </footer>

      </div>
    </motion.div>
  );
};

export default Workflower;