import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  X,
  Send,
  Brain,
  Building2,
  Briefcase,
  Image,
  Video,
  Mic,
  BookOpen,
  TrendingUp,
  Home,
  MessageSquare,
  Settings,
  LogOut,
  History,
  Zap,
  Shield,
  ChevronRight,
  Layers,
  PanelLeftClose,
  PanelLeft,
  Paperclip,
  Lightbulb,
  Bug,
  HeartPulse,
  Database,
  Globe,
  Github,
  Search,
  CheckCircle2,
  Feather,
  ChevronDown,
  Archive,
  Trash2,
  Clock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── Tool Registry ──────────────────────────────────────────────────────────────

type ToolEntry = {
  id: string;
  name: string;
  subtitle: string;
  icon: React.ElementType;
  isMedia?: boolean;
};

type Category = {
  color: string;
  glowRgba: string;
  label: string;
  tools: ToolEntry[];
};

const AI_CATEGORIES: Record<string, Category> = {
  LOGIC: {
    color: "#22c55e",
    glowRgba: "34,197,94",
    label: "LOGIC",
    tools: [
      { id: "google/gemini-3.1-pro", name: "Gemini 3.1 Pro", subtitle: "The Brain", icon: Brain },
      { id: "anthropic/claude-4.6-sonnet", name: "Claude 4.6 Sonnet", subtitle: "The Architect", icon: Building2 },
      { id: "openai/gpt-5.4", name: "GPT-5.4", subtitle: "The Manager", icon: Briefcase },
    ],
  },
  CREATION: {
    color: "#a855f7",
    glowRgba: "168,85,247",
    label: "CREATION",
    tools: [
      {
        id: "google/gemini-3-flash-image",
        name: "Nano Banana 2.0",
        subtitle: "The Designer",
        icon: Image,
        isMedia: true,
      },
      { id: "google/veo-3", name: "Google Veo 3", subtitle: "The Cinematographer", icon: Video, isMedia: true },
      { id: "elevenlabs/lyria", name: "ElevenLabs Lyria", subtitle: "The Voice", icon: Mic, isMedia: true },
    ],
  },
  RESEARCH: {
    color: "#06b6d4",
    glowRgba: "6,182,212",
    label: "RESEARCH",
    tools: [
      { id: "google/notebooklm", name: "NotebookLM", subtitle: "The Librarian", icon: BookOpen },
      { id: "x-ai/grok-4.20", name: "Grok 4.20", subtitle: "The Trendsetter", icon: TrendingUp },
    ],
  },
};

function findToolById(id: string | null): { tool: ToolEntry; category: Category } | null {
  if (!id) return null;
  for (const cat of Object.values(AI_CATEGORIES)) {
    const found = cat.tools.find((t) => t.id === id);
    if (found) return { tool: found, category: cat };
  }
  return null;
}

// ─── Nav Items with Unique Gradients ────────────────────────────────────────────

const NAV_ITEMS = [
  { icon: Home, label: "Home" },
  { icon: MessageSquare, label: "Workflows" },
  { icon: History, label: "History" },
  { icon: Layers, label: "Integrations" },
  { icon: Clock, label: "Recently" },
  { icon: Archive, label: "Archives" },
  { icon: Trash2, label: "Trash" },
  { icon: Settings, label: "Settings" },
];

const SECTION_THEMES: Record<string, { gradient: string; glowRgba: string }> = {
  Home: { gradient: "linear-gradient(135deg, #22c55e, #10b981)", glowRgba: "34,197,94" },
  Workflows: { gradient: "linear-gradient(135deg, #a855f7, #ec4899)", glowRgba: "168,85,247" },
  History: { gradient: "linear-gradient(135deg, #f59e0b, #d97706)", glowRgba: "245,158,11" },
  Integrations: { gradient: "linear-gradient(135deg, #3b82f6, #06b6d4)", glowRgba: "59,130,246" },
  Recently: { gradient: "linear-gradient(135deg, #06b6d4, #3b82f6)", glowRgba: "6,182,212" },
  Archives: { gradient: "linear-gradient(135deg, #818cf8, #c084fc)", glowRgba: "129,140,248" },
  Trash: { gradient: "linear-gradient(135deg, #ef4444, #f97316)", glowRgba: "239,68,68" },
  Settings: { gradient: "linear-gradient(135deg, #6366f1, #a855f7)", glowRgba: "99,102,241" },
};

const STYLES = ["Technical", "Creative", "Fast"] as const;

const SKILLS = [
  { icon: Lightbulb, label: "Explain Concept" },
  { icon: Bug, label: "Debug Build" },
  { icon: HeartPulse, label: "Project Health" },
];

const springTransition = { type: "spring" as const, damping: 25, stiffness: 400 };
// ─── Component ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string; isSimulation?: boolean }[]>([]);
  const [activeNav, setActiveNav] = useState("Home");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [webSearchActive, setWebSearchActive] = useState(false);
  const [activeStyle, setActiveStyle] = useState<(typeof STYLES)[number]>("Technical");
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  const [connectorStatus, setConnectorStatus] = useState({ supabase: true, vercel: false, github: false });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLinked] = useState(true);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Session ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const activeTool = findToolById(selectedModel);
  const isMediaMode = activeTool?.category.label === "CREATION";
  const glowRgba = activeTool?.category.glowRgba ?? "34,197,94";
  const borderColor = activeTool?.category.color ?? "#22c55e";

  const activeNavItem = NAV_ITEMS.find((n) => n.label === activeNav) ?? NAV_ITEMS[0];

  // ── Typing detection ───────────────────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    setIsTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 800);
  }

  // ── Simulation mode ────────────────────────────────────────────────────────
  function streamSimulation(msgIndex: number) {
    const mockResponse =
      "[SIMULATION_MODE] // OFFLINE_DRAFT — Neural pathway rerouted through local inference cache. Executing fallback heuristic analysis on provided directive. Output confidence: 87.3%. Recommended action: retry with primary engine when connectivity is restored.";
    const words = mockResponse.split(" ");
    let wordIdx = 0;

    function appendWord() {
      if (wordIdx >= words.length) return;
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[msgIndex]) {
          updated[msgIndex] = {
            ...updated[msgIndex],
            text: words.slice(0, wordIdx + 1).join(" "),
            isSimulation: true,
          };
        }
        return updated;
      });
      wordIdx++;
      simulationRef.current = setTimeout(appendWord, 60);
    }
    appendWord();
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSelectTool = useCallback((id: string) => {
    setSelectedModel(id);
    setDrawerOpen(false);
  }, []);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;

    const aiMsgIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: "user", text: trimmed }, { role: "ai", text: "Processing..." }]);
    setInput("");
    setIsProcessing(true);

    const timeout = setTimeout(() => {
      setIsProcessing(false);
      streamSimulation(aiMsgIndex);
    }, 10000);

    setTimeout(() => {
      clearTimeout(timeout);
      setIsProcessing(false);
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[aiMsgIndex]) {
          updated[aiMsgIndex] = {
            ...updated[aiMsgIndex],
            text: `[${activeTool?.tool.name ?? "NazAI"} // ${selectedModel ?? "default"}] — Node processing signal recognized. Executing workflow on directive: "${trimmed.slice(0, 60)}..."`,
          };
        }
        return updated;
      });
    }, 1500);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSignOut() {
    setLogoutModalOpen(false);
    await supabase.auth.signOut();
    navigate("/");
  }

  // ── Styled section pages ───────────────────────────────────────────────────
  const STYLED_SECTIONS = ["Recently", "Archives", "Trash", "History", "Integrations", "Settings"];
  const isStyledSection = STYLED_SECTIONS.includes(activeNav);

  function renderStyledSection() {
    const navItem = NAV_ITEMS.find((n) => n.label === activeNav)!;
    const theme = SECTION_THEMES[activeNav] || SECTION_THEMES["Home"];
    const Icon = navItem.icon;

    const sectionDetails: Record<string, { subtitle: string; hint: string }> = {
      Trash: { subtitle: "PERMANENTLY_DELETED ITEMS", hint: "Items here are purged every 30 days." },
      Archives: { subtitle: "COLD_STORAGE // ARCHIVED", hint: "Move workflows here to keep your desk clean." },
      Recently: { subtitle: "TIMELINE_FEED // ACTIVE", hint: "Your last 24 hours of neural activity." },
      History: { subtitle: "HISTORICAL_RECORDS // LOGS", hint: "A full audit trail of every AI interaction." },
      Integrations: { subtitle: "EXTERNAL_NODES // API", hint: "Connect your workflows to the outside world." },
      Settings: { subtitle: "SYSTEM_CORE // PREFERENCES", hint: "Configure your neural interface parameters." },
    };

    const details = sectionDetails[activeNav] || {
      subtitle: "SECTION_ID // NULL",
      hint: "No active data found in this node.",
    };

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springTransition}
        className="flex flex-col items-center justify-center h-full text-center px-6"
      >
        {/* 1. The Central Pulsing Node */}
        <motion.div
          className="w-24 h-24 rounded-[2rem] flex items-center justify-center mb-8 relative"
          style={{
            background: theme.gradient,
            boxShadow: `0 0 60px rgba(${theme.glowRgba}, 0.25), inset 0 0 20px rgba(255,255,255,0.2)`,
          }}
          animate={{
            rotate: [0, 5, -5, 0],
            scale: [1, 1.05, 1],
          }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="absolute inset-0 rounded-[2rem] animate-pulse"
            style={{ border: `2px solid rgba(${theme.glowRgba}, 0.5)` }}
          />
          <Icon size={40} className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
        </motion.div>

        {/* 2. Enhanced Typography */}
        <div className="flex justify-center w-full mb-6">
          <div className="flex flex-col items-center">
            <motion.h2
              initial={{ letterSpacing: "0.1em", opacity: 0 }}
              animate={{ letterSpacing: "0.25em", opacity: 1 }}
              className="text-3xl font-black mb-3 select-none"
              style={{
                background: theme.gradient,
                display: "table",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
              }}
            >
              {activeNav.toUpperCase()}
            </motion.h2>
            <p className="text-[10px] font-mono tracking-[0.3em] text-white/30 uppercase mb-2">{details.subtitle}</p>
            <div className="h-[1px] w-12 bg-white/10 mb-4" />
            <p className="text-[13px] text-white/50 max-w-[280px] leading-relaxed italic">"{details.hint}"</p>
          </div>
        </div>

        {/* 3. Empty State Cards with Hover Effects */}
        <div className="flex flex-wrap justify-center gap-4">
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              whileHover={{ y: -5, backgroundColor: "rgba(255,255,255,0.04)" }}
              className="w-52 h-32 rounded-2xl glass-edge flex flex-col justify-between p-4 cursor-help"
              style={{
                background: "rgba(255,255,255,0.01)",
                border: `1px solid rgba(${theme.glowRgba}, 0.1)`,
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springTransition, delay: i * 0.1 }}
            >
              <div className="space-y-2">
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    className="h-full"
                    style={{ background: theme.gradient }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.random() * 60 + 20}%` }}
                    transition={{ duration: 1.5, delay: 0.5 }}
                  />
                </div>
                <div className="w-2/3 h-1.5 rounded-full bg-white/5" />
              </div>
              <div className="flex justify-between items-center">
                <div className="w-8 h-8 rounded-lg bg-white/5" />
                <div className="text-[9px] font-mono text-white/20">#00{i}_NULL</div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    );
  }
  function renderGenericSection() {
    const navItem = NAV_ITEMS.find((n) => n.label === activeNav)!;
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center h-full text-center"
      >
        <p
          className="text-[13px] tracking-[0.2em] mb-2 font-bold"
          style={{
            background: navItem.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {activeNav.toUpperCase()}_SECTION
        </p>
        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          System node currently under construction.
        </p>
      </motion.div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-screen w-screen overflow-hidden font-sans"
      style={{ background: "#020617", color: "#e2e8f0" }}
    >
      <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx" className="hidden" />

      {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 0 : 64 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="flex flex-col items-center shrink-0 overflow-hidden z-20"
        style={{ borderRight: `1px solid rgba(${glowRgba},0.12)`, background: "#020617" }}
      >
        <div className="flex flex-col items-center w-16 py-6 h-full">
          <div className="mb-8">
            <Zap size={20} style={{ color: borderColor, filter: `drop-shadow(0 0 6px rgba(${glowRgba},0.6))` }} />
          </div>
          <nav className="flex flex-col gap-1 flex-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.label;

              // LOOKUP: Get the theme data based on the item label
              const itemTheme = SECTION_THEMES[item.label] || SECTION_THEMES["Home"];

              return (
                <button
                  key={item.label}
                  onClick={() => setActiveNav(item.label)}
                  title={item.label}
                  className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 relative group"
                  style={{
                    background: isActive ? undefined : "transparent",
                  }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active-bg"
                      className="absolute inset-0 rounded-lg"
                      style={{
                        background: itemTheme.gradient, // Changed from item.gradient
                        opacity: 0.15,
                        boxShadow: `0 0 20px rgba(${itemTheme.glowRgba}, 0.3)`, // Changed from item.glowRgba
                      }}
                      transition={springTransition}
                    />
                  )}
                  <Icon
                    size={18}
                    className="relative z-10"
                    style={{
                      color: isActive ? (itemTheme as any).color || "#fff" : "rgba(255,255,255,0.25)",
                      filter: isActive ? `drop-shadow(0 0 6px rgba(${itemTheme.glowRgba}, 0.6))` : "none",
                    }}
                  />
                </button>
              );
            })}
          </nav>
          <div className="flex flex-col items-center gap-2 mt-auto">
            {userEmail && (
              <div
                title={userEmail}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{
                  background: `rgba(${glowRgba},0.12)`,
                  border: `1px solid rgba(${glowRgba},0.35)`,
                  color: borderColor,
                }}
              >
                {userEmail[0].toUpperCase()}
              </div>
            )}
            <button
              onClick={() => setLogoutModalOpen(true)}
              title="Sign out"
              className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-red-500/10 group"
            >
              <LogOut size={16} className="text-white/25 group-hover:text-red-400 transition-colors" />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* ═══════════════════════ MAIN ═══════════════════════ */}
      <main className="flex flex-col flex-1 min-w-0 relative">
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0 backdrop-blur-md glass-edge"
          style={{ borderBottom: `1px solid rgba(${glowRgba},0.1)`, background: "rgba(2,6,23,0.92)" }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="mr-2 transition-colors"
              style={{ color: `rgba(${glowRgba},0.5)` }}
            >
              {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <span className="text-[11px] tracking-[0.15em] font-mono" style={{ color: borderColor }}>
              NAZAI://
            </span>
            <span
              className="text-[11px] font-mono font-bold tracking-[0.1em]"
              style={{
                background: activeNavItem.gradient,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {activeNav.toUpperCase()}
            </span>
            <ChevronRight size={10} style={{ color: `rgba(${glowRgba},0.25)` }} />
            {activeTool && activeNav === "Home" && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-[11px] tracking-[0.1em]"
                style={{ color: activeTool.category.color }}
              >
                {activeTool.tool.name}
              </motion.span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isLinked && (
              <span className="text-[9px] tracking-[0.12em]" style={{ color: `rgba(${glowRgba},0.3)` }}>
                LINKED
              </span>
            )}
            <span
              className="text-[10px] tracking-[0.12em] font-mono select-none"
              style={{ color: `rgba(${glowRgba},0.4)` }}
            >
              {new Date()
                .toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })
                .toUpperCase()}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full animate-pulse-glow" style={{ background: borderColor }} />
              <span className="text-[9px] tracking-[0.15em] font-mono" style={{ color: `rgba(${glowRgba},0.4)` }}>
                SYNCHRONIZED
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-4">
          {activeNav === "Home" ? (
            <>
              {/* ── Messages ── */}
              <div className="flex-1 w-full max-w-2xl overflow-y-auto py-8 space-y-4 scrollbar-thin">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-6 text-center select-none">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{ border: `1px solid rgba(${glowRgba},0.25)`, background: `rgba(${glowRgba},0.05)` }}
                    >
                      <Zap
                        size={22}
                        style={{ color: borderColor, filter: `drop-shadow(0 0 8px rgba(${glowRgba},0.5))` }}
                      />
                    </div>
                    <div>
                      <p className="text-[13px] tracking-[0.12em]" style={{ color: `rgba(${glowRgba},0.6)` }}>
                        WORKFLOW ANIMATOR READY
                      </p>
                      <p className="text-[11px] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>
                        Select an AI engine below, then describe your mission.
                      </p>
                    </div>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className="max-w-[78%] px-3.5 py-2.5 text-[13px] leading-relaxed glass-edge"
                      style={{
                        borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                        background: msg.isSimulation
                          ? "rgba(255,165,0,0.06)"
                          : msg.role === "user"
                            ? `rgba(${glowRgba},0.08)`
                            : "rgba(255,255,255,0.03)",
                        border: msg.isSimulation
                          ? "1px solid rgba(255,165,0,0.25)"
                          : msg.role === "user"
                            ? `1px solid rgba(${glowRgba},0.2)`
                            : "1px solid rgba(255,255,255,0.06)",
                        color: msg.isSimulation ? "#fbbf24" : msg.role === "user" ? "#e2e8f0" : "rgba(255,255,255,0.7)",
                      }}
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* ── Media mode + Engine tag bar ── */}
              <AnimatePresence>
                {activeTool && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="w-full max-w-2xl mb-2 flex items-center gap-2 flex-wrap"
                  >
                    {isMediaMode && (
                      <span
                        className="text-[9px] tracking-[0.15em] px-2.5 py-1 rounded animate-media-glow"
                        style={{
                          background: "rgba(168,85,247,0.12)",
                          border: "1px solid rgba(168,85,247,0.45)",
                          color: "#a855f7",
                        }}
                      >
                        ▶ MEDIA_GENERATION_MODE_ACTIVE
                      </span>
                    )}
                    <span
                      className="text-[10px] tracking-[0.1em] px-2.5 py-1 rounded flex items-center gap-1.5 cursor-pointer ml-auto hover:brightness-125 transition-all"
                      style={{
                        background: `rgba(${activeTool.category.glowRgba},0.1)`,
                        border: `1px solid rgba(${activeTool.category.glowRgba},0.35)`,
                        color: activeTool.category.color,
                      }}
                      onClick={() => setSelectedModel(null)}
                      title="Deselect Engine"
                    >
                      {activeTool.tool.name} <X size={10} />
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ═══════════════════════ GLASSMORPHIC INPUT CONTAINER ═══════════════════════ */}
              <div className="w-full max-w-2xl mb-6 relative">
                <div
                  className="relative rounded-xl transition-all duration-300 flex flex-col"
                  style={{
                    border: `2px solid rgba(${glowRgba},${isTyping ? "0.7" : activeTool ? "0.4" : "0.15"})`,
                    background: "rgba(255,255,255,0.025)",
                    backdropFilter: "blur(16px)",
                    boxShadow: isTyping
                      ? `0 0 0 1px rgba(${glowRgba},0.2), 0 0 35px rgba(${glowRgba},0.25)`
                      : activeTool
                        ? `0 0 0 1px rgba(${glowRgba},0.1), 0 0 20px rgba(${glowRgba},0.12)`
                        : "none",
                    animation: isTyping
                      ? "border-pulse 1.5s ease-in-out infinite"
                      : activeTool
                        ? "border-pulse 3s ease-in-out infinite"
                        : "none",
                    ["--glow-color" as string]: `rgba(${glowRgba},0.4)`,
                  }}
                >
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      activeTool
                        ? `Mission for ${activeTool.tool.name}... (↵ to send)`
                        : "Describe your system mission... (↵ to send)"
                    }
                    rows={1}
                    className="w-full bg-transparent border-none outline-none resize-none font-mono text-[13px] leading-relaxed placeholder:text-white/18"
                    style={{
                      padding: "16px 16px 8px 16px",
                      minHeight: "140px",
                      color: "#e2e8f0",
                      caretColor: borderColor,
                    }}
                  />

                  {/* ── Footer inside input ── */}
                  <div
                    className="flex items-center justify-between px-3 py-2.5 glass-edge"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          setPlusMenuOpen((v) => !v);
                          setDrawerOpen(false);
                        }}
                        className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 shrink-0"
                        style={{
                          background: plusMenuOpen ? `rgba(${glowRgba},0.18)` : `rgba(${glowRgba},0.06)`,
                          border: `1px solid ${plusMenuOpen ? borderColor : `rgba(${glowRgba},0.25)`}`,
                          color: borderColor,
                        }}
                        title="Tools & Options"
                      >
                        <motion.div animate={{ rotate: plusMenuOpen ? 45 : 0 }} transition={springTransition}>
                          <Plus size={14} />
                        </motion.div>
                      </button>

                      <button
                        onClick={() => {
                          setDrawerOpen((v) => !v);
                          setPlusMenuOpen(false);
                        }}
                        className="text-[10px] tracking-[0.08em] px-2 py-1 rounded transition-all"
                        style={{
                          background: `rgba(${glowRgba},0.06)`,
                          border: `1px solid rgba(${glowRgba},0.2)`,
                          color: `rgba(${glowRgba},0.6)`,
                        }}
                      >
                        {activeTool ? activeTool.tool.name : "Select Engine"}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setWebSearchActive((v) => !v)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] tracking-[0.08em] transition-all"
                        style={{
                          background: webSearchActive ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)",
                          border: webSearchActive
                            ? "1px solid rgba(59,130,246,0.4)"
                            : "1px solid rgba(255,255,255,0.06)",
                          color: webSearchActive ? "#3b82f6" : "rgba(255,255,255,0.3)",
                        }}
                        title="Toggle Web Search"
                      >
                        {webSearchActive ? <CheckCircle2 size={11} /> : <Search size={11} />}
                        <span className="hidden sm:inline">Web</span>
                      </button>

                      <div className="relative">
                        <button
                          onClick={() => setStyleDropdownOpen((v) => !v)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] tracking-[0.08em] transition-all"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.4)",
                          }}
                          title="Output Style"
                        >
                          <Feather size={11} />
                          <span className="hidden sm:inline">{activeStyle}</span>
                          <ChevronDown size={9} />
                        </button>
                        <AnimatePresence>
                          {styleDropdownOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: 4, scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.96 }}
                              transition={springTransition}
                              className="absolute bottom-full right-0 mb-1 rounded-lg overflow-hidden z-50"
                              style={{
                                background: "rgba(2,6,23,0.97)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                backdropFilter: "blur(16px)",
                              }}
                            >
                              {STYLES.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => {
                                    setActiveStyle(s);
                                    setStyleDropdownOpen(false);
                                  }}
                                  className="block w-full text-left px-4 py-2 text-[11px] tracking-[0.08em] transition-colors"
                                  style={{
                                    color: activeStyle === s ? borderColor : "rgba(255,255,255,0.4)",
                                    background: activeStyle === s ? `rgba(${glowRgba},0.08)` : "transparent",
                                  }}
                                >
                                  {s}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <button
                        onClick={handleSend}
                        disabled={!input.trim() || isProcessing}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200"
                        style={{
                          background: input.trim() ? borderColor : "rgba(255,255,255,0.04)",
                          color: input.trim() ? "#020617" : "rgba(255,255,255,0.15)",
                          boxShadow: input.trim() ? `0 0 14px rgba(${glowRgba},0.5)` : "none",
                          cursor: input.trim() ? "pointer" : "default",
                        }}
                      >
                        <Send size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                <p
                  className="text-center text-[10px] mt-2 tracking-[0.08em] font-mono"
                  style={{ color: "rgba(255,255,255,0.15)" }}
                >
                  {selectedModel ? `SYSTEM_NODE // ${selectedModel}` : "NO ENGINE SELECTED — CLICK + TO CHOOSE"}
                </p>
              </div>
            </>
          ) : isStyledSection ? (
            renderStyledSection()
          ) : (
            renderGenericSection()
          )}
        </div>

        <footer
          className="flex items-center justify-between px-6 py-2 shrink-0 glass-edge"
          style={{ borderTop: `1px solid rgba(${glowRgba},0.1)`, background: "rgba(2,6,23,0.92)" }}
        >
          <div className="flex items-center gap-2">
            <Shield size={10} style={{ color: `rgba(${glowRgba},0.45)` }} />
            <span className="text-[10px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.45)` }}>
              SECURE_NODE
            </span>
          </div>
          <div className="flex items-center gap-4">
            {connectorStatus.supabase && (
              <span className="text-[9px] tracking-[0.1em]" style={{ color: "rgba(34,197,94,0.4)" }}>
                DB:ON
              </span>
            )}
            {connectorStatus.vercel && (
              <span className="text-[9px] tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.3)" }}>
                VERCEL:ON
              </span>
            )}
            {connectorStatus.github && (
              <span className="text-[9px] tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.3)" }}>
                GH:ON
              </span>
            )}
            <div className="flex items-center gap-2">
              <div className="w-[5px] h-[5px] rounded-full animate-pulse-glow" style={{ background: borderColor }} />
              <span className="text-[10px] tracking-[0.15em] font-mono" style={{ color: `rgba(${glowRgba},0.45)` }}>
                SYNCHRONIZED
              </span>
            </div>
          </div>
        </footer>
      </main>

      {/* ═══════════════════════ PLUS MENU (Spring) ═══════════════════════ */}
      <AnimatePresence>
        {plusMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPlusMenuOpen(false)}
              className="fixed inset-0 z-30"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.92 }}
              transition={springTransition}
              className="fixed z-40 overflow-hidden"
              style={{
                bottom: "calc(60px + 70px)",
                left: "50%",
                transform: "translateX(-50%)",
                width: "min(380px, calc(100vw - 64px))",
                background: "rgba(2,6,23,0.97)",
                border: `1px solid rgba(${glowRgba},0.15)`,
                borderRadius: 14,
                backdropFilter: "blur(24px)",
                boxShadow: `0 0 60px rgba(0,0,0,0.7)`,
              }}
            >
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="text-[11px] tracking-[0.15em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  TOOLS
                </span>
              </div>
              <div className="p-3 flex flex-col gap-1">
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-white/[0.04]"
                >
                  <Paperclip size={15} style={{ color: `rgba(${glowRgba},0.5)` }} />
                  <div>
                    <div className="text-[12px]" style={{ color: "#e2e8f0" }}>
                      Add Files / Photos
                    </div>
                    <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                      Upload from your device
                    </div>
                  </div>
                </button>

                <div className="mt-2 mb-1 px-3">
                  <span className="text-[9px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.4)` }}>
                    SKILLS
                  </span>
                </div>
                {SKILLS.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setInput((v) => (v ? v + "\n" : "") + `/${label.toLowerCase().replace(/\s/g, "-")}`);
                      setPlusMenuOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <Icon size={14} style={{ color: `rgba(${glowRgba},0.45)` }} />
                    <span className="text-[12px]" style={{ color: "#e2e8f0" }}>
                      {label}
                    </span>
                  </button>
                ))}

                <div className="mt-3 mb-1 px-3">
                  <span className="text-[9px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.4)` }}>
                    CONNECTORS
                  </span>
                </div>
                {[
                  { key: "supabase" as const, label: "Supabase", icon: Database, color: "#22c55e" },
                  { key: "vercel" as const, label: "Vercel", icon: Globe, color: "#ffffff" },
                  { key: "github" as const, label: "GitHub", icon: Github, color: "#ffffff" },
                ].map(({ key, label, icon: Icon, color }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={14} style={{ color: `${color}60` }} />
                      <span className="text-[12px]" style={{ color: "#e2e8f0" }}>
                        {label}
                      </span>
                    </div>
                    <Switch
                      checked={connectorStatus[key]}
                      onCheckedChange={(checked) => setConnectorStatus((prev) => ({ ...prev, [key]: checked }))}
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ═══════════════════════ AI ENGINE DRAWER (Spring) ═══════════════════════ */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-30"
              style={{ background: "rgba(0,0,0,0.4)" }}
            />
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.92 }}
              transition={springTransition}
              className="fixed z-40 overflow-hidden"
              style={{
                bottom: "calc(60px + 70px)",
                left: "50%",
                transform: "translateX(-50%)",
                width: "min(640px, calc(100vw - 96px))",
                background: "rgba(2,6,23,0.97)",
                border: `1px solid rgba(${glowRgba},0.18)`,
                borderRadius: 14,
                backdropFilter: "blur(24px)",
                boxShadow: `0 0 60px rgba(0,0,0,0.7), 0 0 40px rgba(${glowRgba},0.06)`,
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span className="text-[11px] tracking-[0.15em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  SELECT AI ENGINE
                </span>
                <button onClick={() => setDrawerOpen(false)} style={{ color: "rgba(255,255,255,0.25)" }}>
                  <X size={14} />
                </button>
              </div>
              <div className="p-4 flex flex-col gap-5">
                {Object.entries(AI_CATEGORIES).map(([catKey, cat], catIdx) => (
                  <motion.div
                    key={catKey}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: catIdx * 0.06, duration: 0.25 }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-4 h-px opacity-50" style={{ background: cat.color }} />
                      <span className="text-[9px] tracking-[0.2em]" style={{ color: cat.color }}>
                        {cat.label}
                      </span>
                      <div
                        className="flex-1 h-px"
                        style={{ background: `linear-gradient(90deg, ${cat.color}40, transparent)` }}
                      />
                    </div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cat.tools.length}, 1fr)` }}>
                      {cat.tools.map((tool, toolIdx) => {
                        const Icon = tool.icon;
                        const isActive = selectedModel === tool.id;
                        return (
                          <motion.button
                            key={tool.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: catIdx * 0.06 + toolIdx * 0.04, duration: 0.2 }}
                            onClick={() => handleSelectTool(tool.id)}
                            className="text-left rounded-[10px] p-2.5 transition-all duration-200 group interactive-border"
                            style={{
                              background: isActive ? `rgba(${cat.glowRgba},0.1)` : "rgba(255,255,255,0.02)",
                              border: `1px solid ${isActive ? cat.color : "rgba(255,255,255,0.1)"}`,
                              boxShadow: isActive
                                ? `0 0 14px rgba(${cat.glowRgba},0.3)`
                                : "inset 0 1px 1px 0 rgba(255,255,255,0.05)",
                            }}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon size={13} style={{ color: isActive ? cat.color : "rgba(255,255,255,0.35)" }} />
                              {tool.isMedia && (
                                <span
                                  className="text-[8px] tracking-[0.1em] px-1.5 py-px rounded"
                                  style={{
                                    background: "rgba(168,85,247,0.12)",
                                    border: "1px solid rgba(168,85,247,0.25)",
                                    color: "#a855f7",
                                  }}
                                >
                                  MEDIA
                                </span>
                              )}
                            </div>
                            <div
                              className="text-[11px] font-semibold tracking-[0.03em] mb-0.5"
                              style={{ color: isActive ? cat.color : "#e2e8f0" }}
                            >
                              {tool.name}
                            </div>
                            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                              {tool.subtitle}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ═══════════════════════ LOGOUT MODAL (Spring) ═══════════════════════ */}
      <AnimatePresence>
        {logoutModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden">
            {/* 1. Backdrop - Using flex-centering instead of absolute translate */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setLogoutModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />

            {/* 2. Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={springTransition}
              className="relative z-[101] w-full max-w-[400px] rounded-2xl p-8 text-center glass-edge overflow-hidden"
              style={{
                background: "rgba(2, 6, 23, 0.95)",
                border: "1px solid rgba(239, 68, 68, 0.15)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(239, 68, 68, 0.05)",
              }}
            >
              {/* Animated Icon Container */}
              <motion.div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
                style={{
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                }}
                animate={{
                  boxShadow: ["0 0 0px rgba(239,68,68,0)", "0 0 20px rgba(239,68,68,0.2)", "0 0 0px rgba(239,68,68,0)"],
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <LogOut size={24} className="text-red-500" />
              </motion.div>

              <h3 className="text-[11px] font-mono tracking-[0.3em] text-red-500/80 mb-2 uppercase">
                System_Termination
              </h3>

              <h2 className="text-xl font-bold text-white mb-3">Ready to log out?</h2>

              <p className="text-[13px] leading-relaxed mb-8 text-white/40 px-4">
                All active neural session state will be{" "}
                <span className="text-red-400/80 font-medium italic">purged from local cache.</span>
              </p>

              <div className="flex gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setLogoutModalOpen(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 text-[13px] font-medium hover:bg-white/10 transition-colors"
                >
                  Stay
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02, backgroundColor: "rgba(239, 68, 68, 0.8)" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSignOut}
                  className="flex-1 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-[13px] font-bold hover:text-white transition-all shadow-lg shadow-red-500/5"
                >
                  Terminate
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes border-pulse {
          0%, 100% { box-shadow: 0 0 0 1px var(--glow-color), 0 0 16px var(--glow-color); }
          50%       { box-shadow: 0 0 0 1px var(--glow-color), 0 0 35px var(--glow-color); }
        }
        @keyframes pulse-glow {
          0%, 100% { transform: scale(1); box-shadow: 0 0 4px currentColor; opacity: 1; }
          50% { transform: scale(1.2); box-shadow: 0 0 12px currentColor, 0 0 20px currentColor; opacity: 0.7; }
        }
        .animate-pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
        .animate-media-glow { animation: media-glow 2s ease-in-out infinite; }
        @keyframes media-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(168,85,247,0.3); }
          50% { box-shadow: 0 0 18px rgba(168,85,247,0.5); }
        }
        .glass-edge {
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: inset 0 1px 1px 0 rgba(255,255,255,0.05);
        }
        .interactive-border {
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .interactive-border:hover {
          border-color: rgba(255,255,255,0.3) !important;
          box-shadow: 0 0 15px rgba(255,255,255,0.03), inset 0 1px 1px 0 rgba(255,255,255,0.05) !important;
        }
        textarea::placeholder { color: rgba(255,255,255,0.18) !important; }
        textarea { scrollbar-width: none; }
        textarea::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
