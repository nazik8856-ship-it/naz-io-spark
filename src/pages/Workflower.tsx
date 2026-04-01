import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Cpu, Zap, Radio, Terminal, Shield, MessageSquare, Globe, AlertTriangle } from "lucide-react";
import MissionWorkspace from "@/components/mission/MissionWorkspace";

const NODES = [
  { id: "input", label: "INPUT SENSOR", desc: "SIGNAL CAPTURE & VALIDATION", icon: Radio },
  { id: "logic", label: "LOGIC GATE", desc: "DECISION MATRIX ARCHITECT", icon: Cpu },
  { id: "engine", label: "AUTO ENGINE", desc: "PROCESS CORE EXECUTION", icon: Activity },
  { id: "exec", label: "EXECUTION", desc: "DEPLOY & LIVE SIGNAL", icon: Zap },
];

const Workflower = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [scrollY, setScrollY] = useState(0);
  const [missionOpen, setMissionOpen] = useState(false);

  // ── LOGIC CORE: Tracking the specific sector for the Mission Workspace ──
  const [activeSector, setActiveSector] = useState("home");

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const ts = new Date().toISOString().slice(11, 19);
      const entries = ["CORE_STABLE", "SIGNAL_100%", "BUS_ACTIVE", "LINK_SECURE", "GLOBAL_SYNC_OK"];
      setLogs((p) => [...p, `[${ts}] ${entries[Math.floor(Math.random() * entries.length)]}`].slice(-12));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // ── UPDATED HANDLER: Launch mission with specific context ──
  const launchMission = (sector = "home") => {
    setActiveSector(sector);
    setMissionOpen(true);
  };

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
      <div
        className="fixed inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#00A3FF 1px, transparent 1px), linear-gradient(90deg, #00A3FF 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          transform: `translateY(${scrollY * 0.12}px) rotateX(10deg)`,
          willChange: "transform",
        }}
      />

      <motion.div
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col"
      >
        {/* ── HEADER ── */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-white/5 bg-black/60 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border border-[#00A3FF]/40 flex items-center justify-center bg-[#00A3FF]/10 shadow-[0_0_20px_rgba(0,163,255,0.3)]">
              <span className="text-[#00A3FF] font-black text-xl italic">N</span>
            </div>
            <div>
              <h1 className="text-lg font-black uppercase tracking-tighter italic leading-none">
                Naz<span className="text-[#00A3FF]">AI</span>
              </h1>
              <p className="text-[7px] text-white/40 tracking-[0.4em] uppercase font-bold mt-0.5">
                Global_Systems_v3.1
              </p>
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
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00A3FF] to-[#00E0FF] drop-shadow-[0_0_25px_#00A3FF]">
              NazAI
            </span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#10B981] to-[#39FF14]">
              One Prompt,{" "}
            </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF0055] to-[#7A0000] drop-shadow-[0_0_30px_rgba(255,0,85,0.5)]">
              Solutions Orchestrated
            </span>
          </h2>

          <div className="flex flex-wrap justify-center gap-8">
            <button
              onClick={() => launchMission("home")}
              className="group relative px-12 py-5 bg-[#39FF14] text-black font-black uppercase text-[11px] border-b-4 border-[#059669] hover:scale-105 transition-all overflow-hidden shadow-[0_0_40px_rgba(57,255,20,0.4)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite]" />
              START_MISSION_NOW
            </button>

            <button
              onClick={() => launchMission("archives")}
              className="group relative px-12 py-5 border-2 border-[#39FF14] text-[#39FF14] font-black uppercase text-[11px] hover:bg-[#39FF14]/10 backdrop-blur-md transition-all tracking-[0.2em] overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#39FF14]/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite]" />
              ACCESS_ARCHIVES
            </button>
          </div>
        </div>

        {/* ... (rest of features and diagnostics sections) ... */}

        {/* ── FOOTER ── */}
        <footer className="py-24 px-8 bg-[#030303] border-t border-white/5 relative overflow-hidden">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-20 relative z-10">
            <div className="space-y-8">
              <h2 className="text-2xl font-black uppercase tracking-tighter italic">
                Naz<span className="text-[#00A3FF]">AI</span>
              </h2>
              <p className="text-[11px] text-white/30 leading-loose uppercase tracking-[0.3em]">
                Autonomous_Logic_Deployment
                <br />
                Global_Sector_Alpha
                <br />© 2026_NazAI_Systems
              </p>
            </div>

            <div className="flex flex-col md:items-end gap-4 text-right">
              <p className="text-[8px] text-[#00A3FF]/20 uppercase tracking-[0.3em]">SUMY_UKRAINE_NODE_01</p>
            </div>
          </div>
        </footer>
      </motion.div>

      {/* ── FINAL INTEGRATION: Pass activeSector to the Mission Workspace ── */}
      <MissionWorkspace open={missionOpen} onClose={() => setMissionOpen(false)} initialSector={activeSector} />
    </motion.div>
  );
};

export default Workflower;
