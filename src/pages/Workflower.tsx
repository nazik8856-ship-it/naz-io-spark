import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MagneticButton from "@/components/interactions/MagneticButton";
import SmoothScrollLink from "@/components/interactions/SmoothScrollLink";
import CursorTrail from "@/components/interactions/CursorTrail";
import NeuralFeedback from "@/components/interactions/NeuralFeedback";
import SubscriptionVacuum from "@/components/interactions/SubscriptionVacuum";
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
  Youtube,
  Music2,
  FileText,
  Mail,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import MissionWorkspace from "@/components/mission/MissionWorkspace";
// GuardianCanvas relocated into Dashboard → Settings → Brand-Snap Canvas (per UX simplification).

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
      // Authenticated — skip registration window, go straight to dashboard
      navigate("/dashboard");
    } else {
      // Not authenticated — show auth modal (once)
      setAuthModalOpen(true);
    }
  };

  const openAuthOrDashboard = () => {
    if (user) {
      navigate("/dashboard");
    } else {
      setAuthModalOpen(true);
    }
  };

  const handleAuthSuccess = () => {
    setAuthModalOpen(false);
    navigate("/dashboard");
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
        {/* HEADER — Sticky glassmorphism nav */}
        <header
          className="sticky top-0 z-50 border-b border-white/5"
          style={{
            background: "rgba(2,6,23,0.72)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
          }}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between px-4 md:px-8 py-3 gap-4">
            {/* Logo */}
            <a href="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-lg border border-[#06b6d4]/40 flex items-center justify-center bg-[#06b6d4]/10 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
                <span className="text-[#06b6d4] font-black text-lg italic" style={{ fontFamily: "'JetBrains Mono', monospace" }}>N</span>
              </div>
              <div className="leading-none">
                <h1 className="text-[15px] font-black tracking-tight italic text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
                  Naz<span className="text-[#06b6d4]">AI</span>
                </h1>
                <p className="text-[8px] text-white/40 tracking-[0.3em] uppercase font-bold mt-0.5" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  Neural OS
                </p>
              </div>
            </a>

            {/* Desktop nav links */}
            <nav className="hidden lg:flex items-center gap-0.5">
              {[
                { label: "Home", href: "#top", smooth: true },
                { label: "Features", href: "#domain-master", smooth: true },
                { label: "How It Works", href: "#operations", smooth: true },
                { label: "Examples", href: "#neural-feedback", smooth: true },
                { label: "Dashboard", href: "/dashboard", smooth: false, gated: true },
                { label: "Pricing", href: "/pricing", smooth: false },
                { label: "Blog", href: "/blog", smooth: false },
              ].map((item) =>
                item.smooth ? (
                  <SmoothScrollLink
                    key={item.label}
                    href={item.href}
                    className="px-3 py-2 text-[12.5px] font-medium text-white/65 hover:text-white transition-colors rounded-md hover:bg-white/[0.04]"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {item.label}
                  </SmoothScrollLink>
                ) : (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (item.gated && !user) {
                        setAuthModalOpen(true);
                      } else {
                        navigate(item.gated ? "/dashboard" : item.href);
                      }
                    }}
                    className="px-3 py-2 text-[12.5px] font-medium text-white/65 hover:text-white transition-colors rounded-md hover:bg-white/[0.04]"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {item.label}
                  </button>
                )
              )}
            </nav>

            {/* Right-side auth CTAs */}
            <div className="flex items-center gap-2 shrink-0">
              {user ? (
                <MagneticButton radius={80} strength={0.25}>
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="px-3.5 md:px-4 py-2 text-[12px] font-bold rounded-lg border border-[#06b6d4]/40 bg-[#06b6d4]/10 text-[#06b6d4] hover:bg-[#06b6d4]/20 hover:border-[#06b6d4]/60 transition-colors"
                    style={{ fontFamily: "'Inter', sans-serif", boxShadow: "0 0 18px rgba(6,182,212,0.18)" }}
                  >
                    Dashboard
                  </button>
                </MagneticButton>
              ) : (
                <>
                  <button
                    onClick={() => setAuthModalOpen(true)}
                    className="hidden sm:inline-flex px-3.5 py-2 text-[12px] font-semibold text-white/75 hover:text-white transition-colors rounded-md hover:bg-white/[0.04]"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    Sign In
                  </button>
                  <MagneticButton radius={90} strength={0.28}>
                    <button
                      onClick={() => launchMission("home")}
                      className="px-3.5 md:px-5 py-2 text-[12px] font-black uppercase tracking-wider rounded-lg bg-[#22c55e] text-black hover:shadow-[0_0_30px_rgba(34,197,94,0.6)] transition-shadow whitespace-nowrap"
                      style={{ fontFamily: "'Inter', sans-serif", boxShadow: "0 0 22px rgba(34,197,94,0.4)" }}
                    >
                      Start Free Mission
                    </button>
                  </MagneticButton>
                </>
              )}
            </div>
          </div>
        </header>

        <div id="top" />

        {/* HERO — TITAN ENTRANCE */}
        <div className="relative pt-20 pb-24 px-6 overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 50% 0%, rgba(34,197,94,0.18), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(0,163,255,0.10), transparent 70%)",
            }}
          />

          <motion.div
            className="relative max-w-5xl mx-auto text-center"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 1 },
              visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
            }}
          >
            {(() => {
              const item = {
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
              };
              return null;
            })()}

            {/* Eyebrow */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 rounded-full border border-[#22c55e]/30 bg-[#22c55e]/5"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shadow-[0_0_8px_#22c55e]" />
              <span className="text-[9px] tracking-[0.4em] text-[#22c55e] font-black uppercase">
                AI Business Operating System
              </span>
            </motion.div>

            {/* TITAN HEADLINE — heavy bold italic mono */}
            <motion.h1
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
              }}
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
            </motion.h1>

            {/* SUBHEADLINE */}
            <motion.p
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
              }}
              className="max-w-3xl mx-auto text-sm md:text-base text-white/60 leading-relaxed mb-10 font-medium"
            >
              From idea validation and financial modeling to full operations, AI agents, automation, strategy,
              and execution — <span className="text-white">NazAI orchestrates any business function end-to-end.</span>
            </motion.p>

            {/* COMMAND CONSOLE */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
              }}
              className="relative max-w-3xl mx-auto mb-8"
            >
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
            </motion.div>

            <motion.div
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
              }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <MagneticButton radius={110} strength={0.32}>
                <button
                  onClick={() => launchMission("home")}
                  className="group relative px-8 md:px-10 py-4 bg-[#22c55e] text-black font-black uppercase text-xs md:text-[13px] tracking-wider rounded-lg overflow-hidden transition-shadow hover:shadow-[0_0_60px_rgba(34,197,94,0.7)]"
                  style={{ boxShadow: "0 0 40px rgba(34,197,94,0.5), inset 0 -2px 0 rgba(0,0,0,0.3)" }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_1s_infinite]" />
                  <span className="relative flex items-center gap-2">
                    <Send size={14} />
                    Start Free Mission — Describe Any Business Task
                  </span>
                </button>
              </MagneticButton>
              <MagneticButton radius={90} strength={0.25}>
                <button
                  onClick={() => navigate("/pricing")}
                  className="px-8 py-4 border border-white/15 text-white/70 font-bold uppercase text-[11px] tracking-[0.2em] hover:bg-white/5 hover:text-white hover:border-[#22c55e]/40 transition-colors rounded-lg"
                >
                  View Plans
                </button>
              </MagneticButton>
            </motion.div>
          </motion.div>
        </div>

        {/* DOMAIN MASTER — 6 expandable glass cards */}
        <section id="domain-master" data-cursor-trail className="relative py-24 px-6 border-t border-white/5 scroll-mt-20">
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

        {/* NAZAI OPERATIONS — Mission Execution Blueprint Timeline */}
        <section id="operations" className="py-24 md:py-28 px-6 md:px-8 bg-black/40 border-y border-white/5 scroll-mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <span
                className="text-[10px] tracking-[0.5em] text-[#06b6d4] font-black uppercase block mb-4"
                style={{ fontFamily: "'JetBrains Mono', monospace", textShadow: "0 0 12px rgba(6,182,212,0.4)" }}
              >
                NazAI Operations
              </span>
              <h2
                className="text-3xl md:text-5xl font-black tracking-tighter text-white mb-4"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                The Mission Execution Blueprint.
              </h2>
              <p className="text-sm text-white/50 max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: "'Inter', sans-serif" }}>
                Four orchestrated stages that transform a single directive into a synchronized, vault-archived business asset.
              </p>
            </div>

            {/* Timeline */}
            <div className="relative">
              {/* Vertical connector (mobile) */}
              <div className="absolute left-6 top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-[#06b6d4]/40 to-transparent md:hidden" />
              {/* Horizontal connector (desktop) */}
              <div className="hidden md:block absolute top-7 left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-[#06b6d4]/30 to-transparent" />

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4 relative">
                {[
                  { stage: "01", title: "Neural Intake", desc: "Directly captures your vision through high-fidelity neural processing of text and assets." },
                  { stage: "02", title: "Domain Calibration", desc: "AI agents calibrate the mission against market-leading billion-dollar strategies." },
                  { stage: "03", title: "Asset Synthesis", desc: "Real-time generation of websites, branding, and codebases within the Brand-Snap Canvas." },
                  { stage: "04", title: "Vault Synchronization", desc: "Automatic archival of every version and mission into your private Dashboard Vault." },
                ].map((item, i) => (
                  <motion.div
                    key={item.stage}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-50px" }}
                    transition={{ duration: 0.5, delay: i * 0.08 }}
                    className="relative pl-16 md:pl-0 md:text-center"
                  >
                    {/* Stage marker */}
                    <div className="absolute left-0 md:left-1/2 md:-translate-x-1/2 top-0 md:relative md:mx-auto md:mb-5 w-12 h-12 md:w-14 md:h-14 rounded-full border border-[#06b6d4]/40 bg-[#020617] flex items-center justify-center shadow-[0_0_24px_rgba(6,182,212,0.25)] z-10">
                      <span
                        className="text-[10px] md:text-[11px] font-black text-[#06b6d4] tracking-tight"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        {item.stage}
                      </span>
                    </div>

                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 md:p-6 hover:border-[#06b6d4]/30 hover:bg-white/[0.04] transition-all backdrop-blur-sm">
                      <h3
                        className="text-base md:text-lg font-bold text-white mb-2 tracking-tight"
                        style={{ fontFamily: "'Inter', sans-serif" }}
                      >
                        {item.title}
                      </h3>
                      <p
                        className="text-[12px] md:text-[13px] text-white/55 leading-relaxed"
                        style={{ fontFamily: "'Inter', sans-serif" }}
                      >
                        {item.desc}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Brand-Snap Canvas now lives in Dashboard → Settings (less landing-page clutter, easier discovery in-app). */}

        {/* SYSTEM PULSE — Latest Updates */}
        <section className="py-20 md:py-24 px-6 md:px-8 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-10">
              <div className="w-2 h-2 rounded-full bg-[#06b6d4] shadow-[0_0_10px_#06b6d4] animate-pulse" />
              <span
                className="text-[10px] tracking-[0.5em] text-[#06b6d4] font-black uppercase"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                System Pulse
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-[#06b6d4]/30 to-transparent" />
            </div>

            <h3
              className="text-2xl md:text-3xl font-black tracking-tight text-white mb-8"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Latest Updates
            </h3>

            <div className="space-y-3">
              {[
                { version: "v2.5", title: "Titan Deployment", desc: "Mobile Z-Index and UI Shift resolved." },
                { version: "v2.4", title: "Neural Calibration", desc: "Enhanced Brand-Snap accuracy for canvas drops." },
                { version: "v2.3", title: "Vault Protocol", desc: "Improved search indexing for archived missions." },
              ].map((u, i) => (
                <motion.div
                  key={u.version}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="group relative flex items-center gap-4 p-4 md:p-5 rounded-xl border border-white/5 bg-white/[0.02] hover:border-[#06b6d4]/30 hover:bg-white/[0.04] transition-all"
                >
                  {/* Active pulse dot — ripple + tooltip on hover */}
                  <div className="relative shrink-0 group/dot">
                    <div className="w-2 h-2 rounded-full bg-[#06b6d4] shadow-[0_0_8px_#06b6d4]" />
                    <div className="absolute inset-0 w-2 h-2 rounded-full bg-[#06b6d4] animate-ping opacity-60" />
                    {/* Hover ripple */}
                    <motion.div
                      aria-hidden
                      className="absolute -inset-3 rounded-full pointer-events-none opacity-0 group-hover/dot:opacity-100"
                      animate={{ scale: [1, 1.6, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                      style={{ border: "1px solid rgba(6,182,212,0.45)" }}
                    />
                    {/* Tooltip */}
                    <div
                      className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 px-2 py-1 rounded-md border border-[#06b6d4]/40 bg-[#020617] text-[#06b6d4] text-[9px] font-bold tracking-[0.2em] uppercase whitespace-nowrap opacity-0 translate-y-1 group-hover/dot:opacity-100 group-hover/dot:translate-y-0 transition-all duration-200"
                      style={{ fontFamily: "'JetBrains Mono', monospace", boxShadow: "0 0 14px rgba(6,182,212,0.25)" }}
                    >
                      View Details
                    </div>
                  </div>

                  <span
                    className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded border border-[#06b6d4]/30 bg-[#06b6d4]/10 text-[#06b6d4]"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {u.version}
                  </span>

                  <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-baseline gap-1 md:gap-3">
                    <span
                      className="text-[13px] md:text-sm font-semibold text-white truncate"
                      style={{ fontFamily: "'Inter', sans-serif" }}
                    >
                      {u.title}
                    </span>
                    <span
                      className="text-[12px] text-white/50 truncate"
                      style={{ fontFamily: "'Inter', sans-serif" }}
                    >
                      {u.desc}
                    </span>
                  </div>

                  <span
                    className="hidden md:inline-block text-[9px] tracking-[0.25em] uppercase text-[#22c55e]/70 font-black shrink-0"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Active
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* NEURAL FEEDBACK — verified mission marquee */}
        <NeuralFeedback />

        {/* SUBSCRIPTION VACUUM — centripetal consolidation demo */}
        <SubscriptionVacuum />

        {/* (Diagnostics terminal removed — felt like a prototype. Replaced with calm CTA.) */}

        {/* FOOTER — Minimalist Obsidian */}
        <footer
          className="px-6 md:px-8 pt-16 pb-8 border-t border-white/5 relative overflow-hidden"
          style={{ background: "#020617" }}
        >
          {/* Single ambient glow */}
          <div className="absolute left-1/2 top-0 w-[400px] h-[200px] bg-[#06b6d4]/5 blur-[100px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

          <div className="max-w-6xl mx-auto relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_1fr] gap-10 md:gap-8 mb-12">
              {/* Brand + tagline */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg border border-[#06b6d4]/40 flex items-center justify-center bg-[#06b6d4]/10 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
                    <span
                      className="text-[#06b6d4] font-black text-lg italic"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      N
                    </span>
                  </div>
                  <h2
                    className="text-lg font-black tracking-tight text-white"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    Naz<span className="text-[#06b6d4]">AI</span>
                  </h2>
                </div>
                <p
                  className="text-[12px] text-white/50 leading-relaxed max-w-xs"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Built for the Future.
                </p>
                <p
                  className="text-[10px] tracking-[0.3em] uppercase text-[#06b6d4]/70 font-bold mt-1"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  AI Business OS
                </p>
              </div>

              {/* PRODUCT */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/40 mb-1"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Product
                </h4>
                {[
                  { label: "Domain Master", href: "#domain-master" },
                  { label: "Brand-Snap Canvas", href: "/dashboard?settings=brand-snap" },
                  { label: "Operations", href: "#operations" },
                ].map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-[13px] text-white/60 hover:text-[#06b6d4] transition-colors"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {item.label}
                  </a>
                ))}
              </div>

              {/* COMPANY */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/40 mb-1"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Company
                </h4>
                <a
                  href="https://www.youtube.com/@NazAI-n8b"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-white/60 hover:text-[#06b6d4] transition-colors"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  <Youtube size={13} />
                  YouTube
                </a>
                <a
                  href="https://www.tiktok.com/@nazai.ai.business"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-white/60 hover:text-[#06b6d4] transition-colors"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  <Music2 size={13} />
                  TikTok
                </a>
                <a
                  href="mailto:nazai8832@gmail.com"
                  className="flex items-center gap-2 text-[13px] text-white/60 hover:text-[#06b6d4] transition-colors"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  <Mail size={13} />
                  Contact
                </a>
              </div>

              {/* LEGAL */}
              <div className="flex flex-col gap-3">
                <h4
                  className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/40 mb-1"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Legal
                </h4>
                <a
                  href="/terms"
                  className="text-[13px] text-white/60 hover:text-[#06b6d4] transition-colors"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Terms
                </a>
                <a
                  href="/privacy"
                  className="text-[13px] text-white/60 hover:text-[#06b6d4] transition-colors"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Privacy Policy
                </a>
              </div>
            </div>

            {/* Bottom bar */}
            <div
              className="pt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[10px] tracking-[0.25em] uppercase"
              style={{
                borderTop: "1px solid rgba(255,255,255,0.05)",
                color: "rgba(148,163,184,0.5)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <span>© {new Date().getFullYear()} NazAI Systems</span>
              <span className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "#06b6d4", boxShadow: "0 0 6px #06b6d4" }}
                />
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

      {/* Cursor trail — only activates over zones marked data-cursor-trail */}
      <CursorTrail />
    </motion.div>
  );
};

export default Workflower;
