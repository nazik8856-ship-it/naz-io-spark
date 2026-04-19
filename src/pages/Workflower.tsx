import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Cpu,
  Zap,
  Radio,
  MessageSquare,
  Globe,
  AlertTriangle,
  Send,
  Target,
  Settings2,
  Wallet,
  Megaphone,
  Code2,
  TrendingUp,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import MissionWorkspace from "@/components/mission/MissionWorkspace";

const NODES = [
  {
    id: "input",
    label: "INPUT SENSOR",
    desc: "Document validation & multi-source context capture",
    icon: Radio,
  },
  {
    id: "logic",
    label: "LOGIC GATE",
    desc: "Branching logic & multi-scenario simulation",
    icon: Cpu,
  },
  {
    id: "engine",
    label: "AUTO ENGINE",
    desc: "Multi-agent orchestration — agents working for you",
    icon: Activity,
  },
  {
    id: "exec",
    label: "EXECUTION",
    desc: "Live deployment of dashboards, code & automations",
    icon: Zap,
  },
];

const DOMAINS = [
  {
    icon: Target,
    title: "Strategy",
    summary: "Market research, SWOT, 5-year forecasting.",
    bullets: ["Competitive intelligence sweeps", "SWOT + PESTEL analysis", "5-year scenario forecasting"],
  },
  {
    icon: Settings2,
    title: "Operations",
    summary: "Workflow automation, CRM, HR processes.",
    bullets: ["End-to-end workflow automation", "CRM & ticketing orchestration", "HR onboarding pipelines"],
  },
  {
    icon: Wallet,
    title: "Finance",
    summary: "Cash flow modeling, tax optimization, contracts.",
    bullets: ["12/24/60-month cash-flow models", "Tax-strategy optimization", "Contract drafting & review"],
  },
  {
    icon: Megaphone,
    title: "Marketing",
    summary: "Lead gen agents, email sequences, SEO.",
    bullets: ["Autonomous lead-gen agents", "Multi-touch email sequences", "Programmatic SEO"],
  },
  {
    icon: Code2,
    title: "Tech",
    summary: "SaaS building, app deployment, API orchestration.",
    bullets: ["Full-stack SaaS scaffolding", "One-click app deployment", "API + webhook orchestration"],
  },
  {
    icon: TrendingUp,
    title: "Scaling",
    summary: "Hiring plans, international expansion, org design.",
    bullets: ["Hiring plans & comp bands", "International expansion playbooks", "Org-design optimization"],
  },
];

const TYPEWRITER_PROMPTS = [
  "Build and launch a complete AI-powered SaaS subscription platform for fitness coaches with marketing automation",
  "Create a full business strategy, financial projections, and daily operations dashboard for my e-commerce store",
  "Orchestrate a complete merger analysis + legal contracts + integration plan for two consulting firms",
];

const Workflower = () => {
  const [scrollY, setScrollY] = useState(0);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [missionOpen, setMissionOpen] = useState(false);
  const [activeSector, setActiveSector] = useState("home");
  const [typedText, setTypedText] = useState("");
  const [promptIdx, setPromptIdx] = useState(0);
  const [expandedDomain, setExpandedDomain] = useState<number | null>(null);
  const consoleRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Typewriter cycling through complex prompts
  useEffect(() => {
    const target = TYPEWRITER_PROMPTS[promptIdx];
    let i = 0;
    setTypedText("");
    const typer = setInterval(() => {
      i++;
      setTypedText(target.slice(0, i));
      if (i >= target.length) {
        clearInterval(typer);
        setTimeout(() => setPromptIdx((p) => (p + 1) % TYPEWRITER_PROMPTS.length), 2400);
      }
    }, 28);
    return () => clearInterval(typer);
  }, [promptIdx]);

  const launchMission = (sector = "home") => {
    setActiveSector(sector);
    if (user) {
      // Authenticated — go directly to workspace
      navigate("/workspace");
    } else {
      // Not authenticated — show auth modal
      setAuthModalOpen(true);
    }
  };

  const handleAuthSuccess = () => {
    setAuthModalOpen(false);
    navigate("/workspace");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen w-full font-mono text-white selection:bg-[#39FF14] selection:text-black overflow-x-hidden"
      style={{ background: "linear-gradient(180deg, #0A192F 0%, #1A0B0B 100%)", backgroundAttachment: "fixed" }}
    >
      <style>{`@keyframes shimmer { 100% { transform: translateX(100%); } }`}</style>

      {/* 3D PARALLAX GRID */}
      <div
        className="fixed inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(#00A3FF 1px, transparent 1px), linear-gradient(90deg, #00A3FF 1px, transparent 1px)",
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
        {/* HEADER */}
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
                Global Systems
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-[#39FF14]/20 bg-[#39FF14]/5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#39FF14] animate-pulse" />
            <span className="text-[8px] text-[#39FF14] uppercase tracking-[0.2em] font-black">System_Active</span>
          </div>
        </header>

        {/* HERO — TITAN ENTRANCE */}
        <div className="relative pt-20 pb-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 50% 0%, rgba(34,197,94,0.18), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(0,163,255,0.10), transparent 70%)",
            }}
          />

          <div className="relative max-w-5xl mx-auto text-center">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 rounded-full border border-[#22c55e]/30 bg-[#22c55e]/5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shadow-[0_0_8px_#22c55e]" />
              <span className="text-[9px] tracking-[0.4em] text-[#22c55e] font-black uppercase">
                AI Business Operating System
              </span>
            </div>

            {/* TITAN HEADLINE — heavy bold italic mono */}
            <h1
              className="font-mono italic font-black tracking-tighter leading-[0.95] text-white text-4xl md:text-6xl lg:text-7xl mb-6"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
            >
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-[#22c55e] to-white drop-shadow-[0_0_25px_rgba(34,197,94,0.35)]">
                NazAI
              </span>{" "}
              — Your AI Business
              <br />
              Operating System.
              <br />
              <span className="text-white/80 text-3xl md:text-5xl lg:text-6xl">
                Handle Anything Business-Related
                <br />
                with <span className="text-[#22c55e] drop-shadow-[0_0_18px_rgba(34,197,94,0.6)]">One Prompt.</span>
              </span>
            </h1>

            {/* SUBHEADLINE */}
            <p className="max-w-3xl mx-auto text-sm md:text-base text-white/60 leading-relaxed mb-10 font-medium">
              From idea validation and financial modeling to full operations, AI agents, automation, strategy,
              and execution — <span className="text-white">NazAI orchestrates any business function end-to-end.</span>
            </p>

            {/* COMMAND CONSOLE */}
            <div className="relative max-w-3xl mx-auto mb-8">
              <div
                className="absolute -inset-px rounded-2xl pointer-events-none"
                style={{
                  background: "linear-gradient(120deg, transparent, rgba(34,197,94,0.6), transparent)",
                  filter: "blur(8px)",
                  opacity: 0.6,
                }}
              />
              <div
                className="relative rounded-2xl border border-[#22c55e]/30 bg-[#020617]/80 backdrop-blur-xl overflow-hidden"
                style={{ boxShadow: "0 0 60px rgba(34,197,94,0.15), inset 0 0 40px rgba(0,0,0,0.4)" }}
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-black/40">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_6px_#22c55e]" />
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                  </div>
                  <span className="text-[8px] tracking-[0.4em] uppercase text-white/40 font-bold">
                    nazai // command_console
                  </span>
                  <span className="text-[8px] text-[#22c55e] font-bold">● LIVE</span>
                </div>
                <div className="relative p-5 md:p-6 text-left min-h-[140px]">
                  <div className="text-[9px] tracking-[0.3em] text-white/30 mb-2 uppercase font-bold">
                    {'>'} describe any business task
                  </div>
                  <textarea
                    ref={consoleRef}
                    rows={3}
                    onClick={() => launchMission("home")}
                    onFocus={() => launchMission("home")}
                    readOnly
                    value={typedText}
                    className="w-full bg-transparent resize-none outline-none text-white text-sm md:text-base font-mono leading-relaxed cursor-pointer caret-[#22c55e]"
                  />
                  <span className="inline-block w-[8px] h-[18px] bg-[#22c55e] align-middle ml-0.5 animate-pulse shadow-[0_0_8px_#22c55e]" />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => launchMission("home")}
                className="group relative px-8 md:px-10 py-4 bg-[#22c55e] text-black font-black uppercase text-xs md:text-[13px] tracking-wider rounded-lg overflow-hidden transition-all hover:scale-[1.02] hover:shadow-[0_0_60px_rgba(34,197,94,0.7)]"
                style={{ boxShadow: "0 0 40px rgba(34,197,94,0.5), inset 0 -2px 0 rgba(0,0,0,0.3)" }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite]" />
                <span className="relative flex items-center gap-2">
                  <Send size={14} />
                  Start Free Mission — Describe Any Business Task
                </span>
              </button>
              <button
                onClick={() => launchMission("archives")}
                className="px-8 py-4 border border-white/15 text-white/70 font-bold uppercase text-[11px] tracking-[0.2em] hover:bg-white/5 hover:text-white hover:border-[#22c55e]/40 transition-all rounded-lg"
              >
                View Plans
              </button>
            </div>
          </div>
        </div>

        {/* DOMAIN MASTER — 6 expandable glass cards */}
        <section className="relative py-24 px-6 border-t border-white/5">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <span className="text-[10px] tracking-[0.5em] text-[#22c55e] font-black uppercase block mb-4">
                Domain Master
              </span>
              <h2 className="text-3xl md:text-5xl font-black tracking-tighter text-white mb-4 italic font-mono">
                NazAI Orchestrates Any Business Function.
              </h2>
              <p className="text-sm text-white/50 max-w-2xl mx-auto leading-relaxed">
                Unlike simple website builders, NazAI uses its{" "}
                <span className="text-[#22c55e]">Logic Gate</span> and{" "}
                <span className="text-[#22c55e]">Auto Engine</span> for deep reasoning across all business domains.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {DOMAINS.map((d, idx) => {
                const Icon = d.icon;
                const expanded = expandedDomain === idx;
                return (
                  <button
                    key={d.title}
                    onClick={() => setExpandedDomain(expanded ? null : idx)}
                    className="group text-left relative rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-xl p-6 transition-all duration-300 hover:border-[#22c55e]/40 hover:bg-white/[0.04]"
                    style={{
                      boxShadow: expanded
                        ? "0 0 40px rgba(34,197,94,0.25), inset 0 0 30px rgba(34,197,94,0.05)"
                        : "0 8px 30px rgba(0,0,0,0.4)",
                      borderColor: expanded ? "rgba(34,197,94,0.5)" : undefined,
                    }}
                  >
                    <div
                      className="absolute -inset-px rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        background: "linear-gradient(135deg, rgba(34,197,94,0.15), transparent 40%)",
                      }}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-4">
                        <div
                          className="w-11 h-11 rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/10 flex items-center justify-center"
                          style={{ boxShadow: "0 0 20px rgba(34,197,94,0.2)" }}
                        >
                          <Icon size={18} className="text-[#22c55e]" />
                        </div>
                        <ChevronDown
                          size={16}
                          className="text-white/30 transition-transform"
                          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                        />
                      </div>
                      <h3 className="text-lg font-black uppercase tracking-tight text-white mb-2 font-mono italic">
                        {d.title}
                      </h3>
                      <p className="text-xs text-white/50 leading-relaxed">{d.summary}</p>
                      <div
                        className="overflow-hidden transition-all"
                        style={{ maxHeight: expanded ? 200 : 0, opacity: expanded ? 1 : 0 }}
                      >
                        <ul className="mt-4 pt-4 border-t border-white/10 space-y-2">
                          {d.bullets.map((b) => (
                            <li key={b} className="flex items-start gap-2 text-[11px] text-white/70 font-mono">
                              <ArrowRight size={10} className="mt-1 text-[#22c55e] shrink-0" />
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>


        {/* FEATURES SECTION */}
        <section className="py-12 md:py-24 px-4 md:px-8 relative">
          <div className="max-w-6xl mx-auto flex flex-col items-center">
            <div className="flex flex-col items-center mb-0 z-20 w-full">
              <h2 className="text-white text-3xl md:text-6xl font-black uppercase tracking-[0.2em] md:tracking-[0.4em] mb-4 drop-shadow-[0_0_20px_rgba(255,255,255,0.3)] text-center">
                Our Features
              </h2>
              <div className="h-1 md:h-1.5 w-24 md:w-32 bg-[#00A3FF] rounded-full shadow-[0_0_15px_#00A3FF]" />
            </div>

            <div className="w-full -mt-8 md:-mt-12 min-h-[450px] md:h-[450px] rounded-3xl border border-white/10 bg-black/40 relative overflow-hidden backdrop-blur-lg shadow-2xl z-10 p-6 md:p-0">
              <svg className="absolute inset-0 w-full h-full hidden md:block">
                {[0, 1, 2].map((i) => (
                  <g key={i}>
                    <line x1={`${28 + i * 24}%`} y1="50%" x2={`${48 + i * 24}%`} y2="50%" stroke="#00A3FF" strokeWidth="1" strokeDasharray="5 5" opacity="0.2" />
                    <circle r="4" fill="#00A3FF" filter="drop-shadow(0 0 5px #00A3FF)">
                      <animateMotion dur="2s" repeatCount="indefinite" path={`M ${260 + i * 240} 225 L ${460 + i * 240} 225`} />
                    </circle>
                  </g>
                ))}
              </svg>

              <div className="relative md:absolute md:inset-0 flex flex-col md:flex-row items-center justify-around gap-6 md:gap-0 px-4 md:px-10 pt-16 md:pt-8 pb-8 md:pb-0">
                {NODES.map((node, i) => (
                  <div
                    key={i}
                    className="w-full md:w-auto flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 rounded-2xl border border-[#00A3FF]/20 bg-[#0A192F]/80 shadow-[0_0_40px_rgba(0,0,0,0.5)] transition-all hover:border-[#00A3FF]/60 group cursor-pointer"
                  >
                    <div className="w-12 h-12 md:w-14 md:h-14 rounded-full border border-[#00A3FF]/40 flex items-center justify-center bg-[#00A3FF]/10 group-hover:bg-[#00A3FF]/20 transition-colors">
                      <node.icon size={24} className="text-[#00A3FF]" />
                    </div>
                    <span className="text-[9px] md:text-[10px] font-black text-[#00A3FF] tracking-[0.2em] md:tracking-[0.3em] uppercase text-center">
                      {node.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* LOGIC ORCHESTRATION */}
        <section className="py-28 px-8 bg-black/60 border-y border-white/5">
          <div className="max-w-6xl mx-auto text-center">
            <h2 className="text-[11px] font-black uppercase tracking-[0.6em] text-[#00A3FF] mb-16 drop-shadow-[0_0_10px_rgba(0,163,255,0.4)]">
              LOGIC_ORCHESTRATION_CORE
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
              {NODES.map((node, i) => (
                <div key={i} className="group p-8 border border-white/5 bg-[#0A192F]/40 hover:border-[#00A3FF]/40 transition-all text-left">
                  <h3 className="text-xs font-black text-[#00A3FF] uppercase mb-6 tracking-widest border-l-2 border-[#39FF14] pl-3">
                    0{i + 1}_{node.label}
                  </h3>
                  <p className="text-[12px] text-white font-medium uppercase leading-relaxed tracking-wider">
                    {node.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* DIAGNOSTICS */}
        <section className="py-28 px-8">
          <div className="max-w-2xl mx-auto border border-[#00A3FF]/30 bg-black/80 p-12 rounded-3xl shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3 mb-10 border-b border-white/5 pb-6">
              <MessageSquare size={22} className="text-[#39FF14]" />
              <h2 className="text-sm font-black uppercase tracking-[0.5em] text-[#39FF14]">Diagnostics</h2>
            </div>
            <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
              <input type="text" placeholder="OPERATOR_CALLSIGN" className="w-full bg-white/5 border border-white/10 p-5 text-[11px] text-white placeholder:text-white font-medium focus:border-[#39FF14] outline-none transition-all" />
              <div className="relative">
                <textarea rows={5} placeholder="TRANSMIT_SYSTEM_ANOMALY..." className="w-full bg-white/5 border border-white/10 p-5 text-[11px] text-white placeholder:text-white font-medium focus:border-[#39FF14] outline-none transition-all resize-none" />
                <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded bg-[#FF0055]/10 border border-[#FF0055]/30">
                  <AlertTriangle size={14} className="text-[#FF0055]" />
                  <span className="text-[8px] text-[#FF0055] uppercase font-black tracking-tighter">Anomaly!</span>
                </div>
              </div>
              <button className="w-full py-5 bg-[#39FF14]/10 border border-[#39FF14]/40 text-[#39FF14] font-black uppercase text-[11px] tracking-[0.4em] hover:bg-[#39FF14] hover:text-black transition-all">
                TRANSMIT_TO_CORE
              </button>
            </form>
          </div>
        </section>

        {/* FOOTER — Architect's Footer (4-column glassmorphism) */}
        <footer className="py-20 px-8 bg-[#030303] border-t border-white/5 relative overflow-hidden">
          {/* Ambient glows */}
          <div className="absolute left-0 top-0 w-64 h-64 bg-[#00A3FF]/5 blur-[100px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
          <div className="absolute right-0 bottom-0 w-64 h-64 bg-[#22c55e]/5 blur-[100px] translate-x-1/2 translate-y-1/2 pointer-events-none" />

          <div className="max-w-6xl mx-auto relative z-10">
            {/* Brand row */}
            <div className="flex items-center gap-4 mb-12">
              <div className="relative">
                <div className="absolute inset-0 bg-[#00A3FF]/20 blur-md rounded-full animate-pulse" />
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10 text-[#00A3FF] drop-shadow-[0_0_8px_rgba(0,163,255,0.8)]">
                  <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" className="animate-[spin_20s_linear_infinite]" />
                  <path d="M12 28V12L28 28V12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
                </svg>
              </div>
              <h2
                className="text-2xl font-extrabold italic tracking-tight"
                style={{ fontFamily: "'JetBrains Mono', monospace", color: "#FFFFFF" }}
              >
                NAZ<span style={{ color: "#00A3FF", textShadow: "0 0 10px rgba(0,163,255,0.6)" }}>AI</span>
              </h2>
            </div>

            {/* 4-column grid */}
            <div
              className="grid grid-cols-2 md:grid-cols-4 gap-10 p-8 rounded-2xl"
              style={{
                background: "linear-gradient(180deg, rgba(11,31,58,0.4) 0%, rgba(2,6,23,0.6) 100%)",
                border: "1px solid rgba(255,255,255,0.05)",
                backdropFilter: "blur(12px)",
              }}
            >
              {/* FEATURES */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[11px] font-mono font-bold tracking-[0.3em] uppercase mb-1"
                  style={{ color: "#22c55e", textShadow: "0 0 8px rgba(34,197,94,0.4)" }}
                >
                  Features
                </h4>
                {["Neural Engine", "Market Logic", "Financial Gates", "Truth Vector"].map((label) => (
                  <a
                    key={label}
                    href="#"
                    className="text-sm transition-colors duration-200 hover:text-white"
                    style={{ color: "rgba(148,163,184,0.7)" }}
                  >
                    {label}
                  </a>
                ))}
              </div>

              {/* EXAMPLES */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[11px] font-mono font-bold tracking-[0.3em] uppercase mb-1"
                  style={{ color: "#22c55e", textShadow: "0 0 8px rgba(34,197,94,0.4)" }}
                >
                  Examples
                </h4>
                {["SaaS Blueprint", "Retail Scaling", "Gym Architecture", "Agency Playbook"].map((label) => (
                  <a
                    key={label}
                    href="#"
                    className="text-sm transition-colors duration-200 hover:text-white"
                    style={{ color: "rgba(148,163,184,0.7)" }}
                  >
                    {label}
                  </a>
                ))}
              </div>

              {/* RESOURCES */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[11px] font-mono font-bold tracking-[0.3em] uppercase mb-1"
                  style={{ color: "#22c55e", textShadow: "0 0 8px rgba(34,197,94,0.4)" }}
                >
                  Resources
                </h4>
                <a
                  href="https://www.youtube.com/@NazAI-n8b"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm transition-colors duration-200 hover:text-white"
                  style={{ color: "rgba(148,163,184,0.7)" }}
                >
                  <Youtube size={14} />
                  YouTube
                </a>
                <a
                  href="https://www.tiktok.com/@nazai.ai.business"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm transition-colors duration-200 hover:text-white"
                  style={{ color: "rgba(148,163,184,0.7)" }}
                >
                  <Music2 size={14} />
                  TikTok
                </a>
              </div>

              {/* LEGAL + CONTACT */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[11px] font-mono font-bold tracking-[0.3em] uppercase mb-1"
                  style={{ color: "#22c55e", textShadow: "0 0 8px rgba(34,197,94,0.4)" }}
                >
                  Legal
                </h4>
                <a
                  href="/terms"
                  className="flex items-center gap-2 text-sm transition-colors duration-200 hover:text-white"
                  style={{ color: "rgba(148,163,184,0.7)" }}
                >
                  <FileText size={14} />
                  Terms
                </a>
                <a
                  href="/privacy"
                  className="text-sm transition-colors duration-200 hover:text-white"
                  style={{ color: "rgba(148,163,184,0.7)" }}
                >
                  Privacy Policy
                </a>
                <a
                  href="mailto:nazai8832@gmail.com"
                  className="flex items-center gap-2 text-sm transition-colors duration-200 hover:text-white mt-1"
                  style={{ color: "rgba(148,163,184,0.55)" }}
                >
                  <Mail size={14} />
                  nazai8832@gmail.com
                </a>
              </div>
            </div>

            {/* Bottom bar */}
            <div
              className="mt-8 pt-4 flex items-center justify-between text-[10px] font-mono tracking-[0.25em] uppercase"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)", color: "rgba(148,163,184,0.5)" }}
            >
              <span>© {new Date().getFullYear()} NazAI Systems · Autonomous Logic Deployment</span>
              <span className="flex items-center gap-2">
                <Globe size={12} className="text-[#00A3FF]/60" />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
                System Operational
              </span>
            </div>
          </div>
        </footer>
      </motion.div>

      {/* Auth Modal */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      {/* Inline workspace (for when opened from within the page) */}
      <MissionWorkspace open={missionOpen} onClose={() => setMissionOpen(false)} initialSector={activeSector} />
    </motion.div>
  );
};

export default Workflower;
