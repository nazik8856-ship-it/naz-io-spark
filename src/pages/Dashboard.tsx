import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, Send, Brain, Building2, Briefcase, Image, Video, Mic,
  BookOpen, TrendingUp, Home, MessageSquare, Settings, LogOut,
  History, Zap, Shield, ChevronRight, Layers, PanelLeftClose, PanelLeft,
  Paperclip, Camera, Bug, HeartPulse, Lightbulb, Globe, Feather,
  Check, ChevronDown, Database, GitBranch, Cloud,
} from "lucide-react";

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
      { id: "google/gemini-3-flash-image", name: "Nano Banana 2.0", subtitle: "The Designer", icon: Image, isMedia: true },
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

// ─── Sidebar Nav Items ──────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { icon: Home, label: "Home" },
  { icon: MessageSquare, label: "Workflows" },
  { icon: History, label: "History" },
  { icon: Layers, label: "Integrations" },
  { icon: Settings, label: "Settings" },
];

// ─── Style Options ──────────────────────────────────────────────────────────────

const STYLE_OPTIONS = ["Technical", "Creative", "Fast"] as const;
type StyleOption = typeof STYLE_OPTIONS[number];

// ─── Skills ─────────────────────────────────────────────────────────────────────

const SKILLS = [
  { icon: Lightbulb, label: "Explain Concept" },
  { icon: Bug, label: "Debug Build" },
  { icon: HeartPulse, label: "Project Health" },
];

// ─── Connectors ─────────────────────────────────────────────────────────────────

const CONNECTORS = [
  { id: "supabase", label: "Supabase", icon: Database },
  { id: "vercel", label: "Vercel", icon: Cloud },
  { id: "github", label: "GitHub", icon: GitBranch },
];

// ─── Component ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  // Core state
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string; simulated?: boolean }[]>([]);
  const [activeNav, setActiveNav] = useState("Home");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // + Menu state
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<"skills" | "connectors" | null>(null);

  // Engine drawer (separate from + menu)
  const [engineDrawerOpen, setEngineDrawerOpen] = useState(false);

  // Action footer state
  const [webSearchActive, setWebSearchActive] = useState(true);
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>("Technical");
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);

  // Connectors state
  const [connectorStatus, setConnectorStatus] = useState<Record<string, boolean>>({
    supabase: true,
    vercel: false,
    github: false,
  });

  // Reliability
  const [isLinked] = useState(true); // dummy linked state - always true
  const [processing, setProcessing] = useState(false);

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Derived state ───────────────────────────────────────────────────────────
  const activeTool = findToolById(selectedModel);
  const isMediaMode = activeTool?.category.label === "CREATION";
  const glowRgba = activeTool?.category.glowRgba ?? "34,197,94";
  const borderColor = activeTool?.category.color ?? "#22c55e";

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSelectTool = useCallback((id: string) => {
    setSelectedModel(id);
    setEngineDrawerOpen(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setIsTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 800);
  };

  // Simulation mode: stream mock response word-by-word after 10s timeout
  const streamSimulation = useCallback((msgIndex: number) => {
    const mockResponse = `[SIMULATION_MODE] // OFFLINE_DRAFT — System analysis complete. Architecture validated against production constraints. All dependency graphs resolved. Recommend proceeding with staged deployment pipeline. No critical vulnerabilities detected in current build matrix.`;
    const words = mockResponse.split(" ");
    let current = 0;

    const interval = setInterval(() => {
      if (current >= words.length) {
        clearInterval(interval);
        setProcessing(false);
        return;
      }
      current++;
      setMessages((prev) => {
        const copy = [...prev];
        copy[msgIndex] = {
          role: "ai",
          text: words.slice(0, current).join(" "),
          simulated: true,
        };
        return copy;
      });
    }, 60);
  }, []);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || processing) return;

    const userMsg = { role: "user" as const, text: trimmed };
    const aiMsg = {
      role: "ai" as const,
      text: `[${activeTool?.tool.name ?? "NazAI"} // ${selectedModel ?? "default"}] — Processing...`,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput("");
    setProcessing(true);

    // 10s timeout → simulation mode
    const aiMsgIndex = messages.length + 1;
    const timeout = setTimeout(() => {
      streamSimulation(aiMsgIndex);
    }, 10000);

    // If a real API resolves faster, clear the timeout (placeholder for real integration)
    return () => clearTimeout(timeout);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const toggleConnector = (id: string) => {
    setConnectorStatus((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden font-mono" style={{ background: "#020617", color: "#e2e8f0" }}>
      {/* Hidden file input */}
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
            {NAV_ITEMS.map(({ icon: Icon, label }) => (
              <button
                key={label}
                onClick={() => setActiveNav(label)}
                title={label}
                className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200"
                style={{
                  color: activeNav === label ? borderColor : `rgba(${glowRgba},0.35)`,
                  background: activeNav === label ? `rgba(${glowRgba},0.08)` : "transparent",
                }}
              >
                <Icon size={18} />
              </button>
            ))}
          </nav>
          <div className="flex flex-col items-center gap-2 mt-auto">
            {userEmail && (
              <div
                title={userEmail}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{ background: `rgba(${glowRgba},0.12)`, border: `1px solid rgba(${glowRgba},0.35)`, color: borderColor }}
              >
                {userEmail[0].toUpperCase()}
              </div>
            )}
            <button onClick={handleSignOut} title="Sign out" className="w-10 h-10 flex items-center justify-center rounded-lg transition-colors" style={{ color: `rgba(${glowRgba},0.35)` }}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* ═══════════════════════ MAIN ═══════════════════════ */}
      <main className="flex flex-col flex-1 min-w-0 relative">

        {/* ── HEADER ──────────────────────────────────────────── */}
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0 backdrop-blur-md"
          style={{ borderBottom: `1px solid rgba(${glowRgba},0.1)`, background: "rgba(2,6,23,0.92)" }}
        >
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarCollapsed((v) => !v)} className="mr-2 transition-colors" style={{ color: `rgba(${glowRgba},0.5)` }}>
              {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <span className="text-[11px] tracking-[0.15em]" style={{ color: borderColor }}>NAZAI://</span>
            <span className="text-[11px]" style={{ color: `rgba(${glowRgba},0.45)` }}>HOME</span>
            <ChevronRight size={10} style={{ color: `rgba(${glowRgba},0.25)` }} />
            {activeTool && (
              <span className="text-[11px] tracking-[0.1em]" style={{ color: activeTool.category.color }}>
                {activeTool.tool.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isLinked && (
              <div className="flex items-center gap-2">
                <div className="w-[6px] h-[6px] rounded-full animate-status-pulse" style={{ background: borderColor, boxShadow: `0 0 6px ${borderColor}` }} />
                <span className="text-[9px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.4)` }}>SYNCHRONIZED</span>
              </div>
            )}
          </div>
        </header>

        {/* ── WORKSPACE ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-4">

          {/* Message Feed */}
          <div className="flex-1 w-full max-w-2xl overflow-y-auto py-8 space-y-4 scrollbar-thin">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center select-none">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ border: `1px solid rgba(${glowRgba},0.25)`, background: `rgba(${glowRgba},0.05)` }}
                >
                  <Zap size={22} style={{ color: borderColor, filter: `drop-shadow(0 0 8px rgba(${glowRgba},0.5))` }} />
                </div>
                <div>
                  <p className="text-[13px] tracking-[0.12em]" style={{ color: `rgba(${glowRgba},0.6)` }}>WORKFLOW ANIMATOR READY</p>
                  <p className="text-[11px] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>Select an AI engine below, then describe your workflow.</p>
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
                  className="max-w-[78%] px-3.5 py-2.5 text-[13px] leading-relaxed font-mono"
                  style={{
                    borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: msg.role === "user"
                      ? `rgba(${glowRgba},0.08)`
                      : msg.simulated
                        ? "rgba(255,165,0,0.06)"
                        : "rgba(255,255,255,0.03)",
                    border: msg.role === "user"
                      ? `1px solid rgba(${glowRgba},0.2)`
                      : msg.simulated
                        ? "1px solid rgba(255,165,0,0.2)"
                        : "1px solid rgba(255,255,255,0.06)",
                    color: msg.role === "user" ? "#e2e8f0" : msg.simulated ? "#fbbf24" : "rgba(255,255,255,0.7)",
                  }}
                >
                  {msg.text}
                </div>
              </motion.div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* ── ACTIVE TOOL CHIP + MEDIA BADGE ──────────────── */}
          <AnimatePresence>
            {activeTool && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="w-full max-w-2xl mb-2 flex items-center gap-2"
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
                  className="text-[10px] tracking-[0.1em] px-2.5 py-1 rounded flex items-center gap-1.5 cursor-pointer ml-auto"
                  style={{
                    background: `rgba(${activeTool.category.glowRgba},0.1)`,
                    border: `1px solid rgba(${activeTool.category.glowRgba},0.35)`,
                    color: activeTool.category.color,
                  }}
                  onClick={() => setSelectedModel(null)}
                  title="Click to deselect"
                >
                  {activeTool.tool.name}
                  <X size={10} />
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── GLASSMORPHIC INPUT CONTAINER ──────────────────── */}
          <div className="w-full max-w-2xl mb-6 relative">

            {/* + Menu Popover */}
            <AnimatePresence>
              {plusMenuOpen && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => { setPlusMenuOpen(false); setPlusSubmenu(null); }}
                    className="fixed inset-0 z-30"
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.96 }}
                    transition={{ type: "spring", damping: 26, stiffness: 400 }}
                    className="absolute z-40 left-0 bottom-full mb-2"
                    style={{
                      width: 260,
                      background: "rgba(2,6,23,0.97)",
                      border: `1px solid rgba(${glowRgba},0.15)`,
                      borderRadius: 12,
                      backdropFilter: "blur(24px)",
                      boxShadow: `0 12px 48px rgba(0,0,0,0.6), 0 0 20px rgba(${glowRgba},0.04)`,
                    }}
                  >
                    {plusSubmenu === null && (
                      <div className="py-1.5">
                        {/* Add Files */}
                        <button
                          onClick={() => { fileInputRef.current?.click(); setPlusMenuOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[12px] transition-colors hover:bg-white/[0.04]"
                          style={{ color: "#e2e8f0" }}
                        >
                          <Paperclip size={14} style={{ color: `rgba(${glowRgba},0.5)` }} />
                          Add files or photos
                        </button>

                        <div className="mx-3 my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

                        {/* Skills submenu */}
                        <button
                          onClick={() => setPlusSubmenu("skills")}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] transition-colors hover:bg-white/[0.04]"
                          style={{ color: "#e2e8f0" }}
                        >
                          <span className="flex items-center gap-3">
                            <Camera size={14} style={{ color: `rgba(${glowRgba},0.5)` }} />
                            Skills
                          </span>
                          <ChevronRight size={12} style={{ color: "rgba(255,255,255,0.2)" }} />
                        </button>

                        {/* Connectors submenu */}
                        <button
                          onClick={() => setPlusSubmenu("connectors")}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] transition-colors hover:bg-white/[0.04]"
                          style={{ color: "#e2e8f0" }}
                        >
                          <span className="flex items-center gap-3">
                            <Layers size={14} style={{ color: `rgba(${glowRgba},0.5)` }} />
                            Connectors
                          </span>
                          <ChevronRight size={12} style={{ color: "rgba(255,255,255,0.2)" }} />
                        </button>
                      </div>
                    )}

                    {plusSubmenu === "skills" && (
                      <div className="py-1.5">
                        <button
                          onClick={() => setPlusSubmenu(null)}
                          className="w-full flex items-center gap-2 px-4 py-2 text-[11px] transition-colors hover:bg-white/[0.04]"
                          style={{ color: "rgba(255,255,255,0.35)" }}
                        >
                          <ChevronRight size={10} className="rotate-180" />
                          Back
                        </button>
                        <div className="mx-3 my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                        {SKILLS.map((skill) => (
                          <button
                            key={skill.label}
                            onClick={() => { setPlusMenuOpen(false); setPlusSubmenu(null); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-[12px] transition-colors hover:bg-white/[0.04]"
                            style={{ color: "#e2e8f0" }}
                          >
                            <skill.icon size={14} style={{ color: borderColor }} />
                            {skill.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {plusSubmenu === "connectors" && (
                      <div className="py-1.5">
                        <button
                          onClick={() => setPlusSubmenu(null)}
                          className="w-full flex items-center gap-2 px-4 py-2 text-[11px] transition-colors hover:bg-white/[0.04]"
                          style={{ color: "rgba(255,255,255,0.35)" }}
                        >
                          <ChevronRight size={10} className="rotate-180" />
                          Back
                        </button>
                        <div className="mx-3 my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                        {CONNECTORS.map((conn) => (
                          <button
                            key={conn.id}
                            onClick={() => toggleConnector(conn.id)}
                            className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] transition-colors hover:bg-white/[0.04]"
                            style={{ color: "#e2e8f0" }}
                          >
                            <span className="flex items-center gap-3">
                              <conn.icon size={14} style={{ color: connectorStatus[conn.id] ? borderColor : "rgba(255,255,255,0.3)" }} />
                              {conn.label}
                            </span>
                            <div
                              className="w-8 h-[18px] rounded-full flex items-center transition-all duration-200 px-0.5"
                              style={{
                                background: connectorStatus[conn.id] ? `rgba(${glowRgba},0.25)` : "rgba(255,255,255,0.08)",
                                border: `1px solid ${connectorStatus[conn.id] ? borderColor : "rgba(255,255,255,0.12)"}`,
                              }}
                            >
                              <div
                                className="w-3 h-3 rounded-full transition-all duration-200"
                                style={{
                                  background: connectorStatus[conn.id] ? borderColor : "rgba(255,255,255,0.25)",
                                  transform: connectorStatus[conn.id] ? "translateX(14px)" : "translateX(0)",
                                  boxShadow: connectorStatus[conn.id] ? `0 0 6px ${borderColor}` : "none",
                                }}
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            {/* Main glassmorphic container */}
            <div
              className="relative rounded-2xl transition-all duration-300 overflow-hidden"
              style={{
                border: `2px solid rgba(${glowRgba},${isTyping ? "0.7" : activeTool ? "0.4" : "0.15"})`,
                background: "rgba(255,255,255,0.02)",
                backdropFilter: "blur(20px)",
                boxShadow: isTyping
                  ? `0 0 0 1px rgba(${glowRgba},0.2), 0 0 40px rgba(${glowRgba},0.2), 0 0 80px rgba(${glowRgba},0.06)`
                  : activeTool
                    ? `0 0 0 1px rgba(${glowRgba},0.1), 0 0 24px rgba(${glowRgba},0.12)`
                    : "0 4px 24px rgba(0,0,0,0.3)",
                animation: activeTool && !isTyping ? "border-pulse 2.5s ease-in-out infinite" : "none",
                ["--glow-color" as string]: `rgba(${glowRgba},0.4)`,
              }}
            >
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={activeTool ? `Ask ${activeTool.tool.name} anything...` : "Describe your system mission..."}
                className="w-full bg-transparent border-none outline-none resize-none font-mono text-[13px] leading-relaxed placeholder:text-white/15"
                style={{
                  padding: "20px 20px 8px 20px",
                  color: "#e2e8f0",
                  caretColor: borderColor,
                  minHeight: 100,
                }}
              />

              {/* ── ACTION FOOTER (inside container) ────────────── */}
              <div
                className="flex items-center justify-between px-3 py-2.5"
                style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
              >
                {/* Left: + button & engine tags */}
                <div className="flex items-center gap-2">
                  {/* + Button */}
                  <button
                    onClick={() => { setPlusMenuOpen((v) => !v); setPlusSubmenu(null); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
                    style={{
                      background: plusMenuOpen ? `rgba(${glowRgba},0.15)` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${plusMenuOpen ? borderColor : "rgba(255,255,255,0.08)"}`,
                      color: plusMenuOpen ? borderColor : "rgba(255,255,255,0.35)",
                    }}
                    title="Tools & Files"
                  >
                    <motion.div animate={{ rotate: plusMenuOpen ? 45 : 0 }} transition={{ duration: 0.15 }}>
                      <Plus size={15} />
                    </motion.div>
                  </button>

                  {/* Engine selector button */}
                  <button
                    onClick={() => setEngineDrawerOpen((v) => !v)}
                    className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[10px] tracking-[0.08em] transition-all duration-200"
                    style={{
                      background: activeTool ? `rgba(${activeTool.category.glowRgba},0.1)` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${activeTool ? `rgba(${activeTool.category.glowRgba},0.3)` : "rgba(255,255,255,0.08)"}`,
                      color: activeTool ? activeTool.category.color : "rgba(255,255,255,0.35)",
                    }}
                  >
                    {activeTool ? activeTool.tool.name : "Select Engine"}
                    <ChevronDown size={10} />
                  </button>
                </div>

                {/* Right: Web Search, Style, Send */}
                <div className="flex items-center gap-2">
                  {/* Web Search toggle */}
                  <button
                    onClick={() => setWebSearchActive((v) => !v)}
                    className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[10px] tracking-[0.06em] transition-all duration-200"
                    style={{
                      background: webSearchActive ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${webSearchActive ? "rgba(59,130,246,0.35)" : "rgba(255,255,255,0.08)"}`,
                      color: webSearchActive ? "#3b82f6" : "rgba(255,255,255,0.3)",
                    }}
                  >
                    <Globe size={11} />
                    Web
                    {webSearchActive && <Check size={10} />}
                  </button>

                  {/* Style selector */}
                  <div className="relative">
                    <button
                      onClick={() => setStyleDropdownOpen((v) => !v)}
                      className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[10px] tracking-[0.06em] transition-all duration-200"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.4)",
                      }}
                    >
                      <Feather size={11} />
                      {selectedStyle}
                      <ChevronDown size={10} />
                    </button>

                    <AnimatePresence>
                      {styleDropdownOpen && (
                        <>
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setStyleDropdownOpen(false)}
                            className="fixed inset-0 z-30"
                          />
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            className="absolute bottom-full right-0 mb-2 z-40 py-1"
                            style={{
                              width: 140,
                              background: "rgba(2,6,23,0.97)",
                              border: `1px solid rgba(${glowRgba},0.15)`,
                              borderRadius: 8,
                              backdropFilter: "blur(20px)",
                              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                            }}
                          >
                            {STYLE_OPTIONS.map((s) => (
                              <button
                                key={s}
                                onClick={() => { setSelectedStyle(s); setStyleDropdownOpen(false); }}
                                className="w-full text-left px-3 py-2 text-[11px] transition-colors hover:bg-white/[0.04] flex items-center justify-between"
                                style={{ color: selectedStyle === s ? borderColor : "#e2e8f0" }}
                              >
                                {s}
                                {selectedStyle === s && <Check size={10} />}
                              </button>
                            ))}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || processing}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300"
                    style={{
                      background: input.trim() ? borderColor : "rgba(255,255,255,0.04)",
                      color: input.trim() ? "#020617" : "rgba(255,255,255,0.12)",
                      cursor: input.trim() && !processing ? "pointer" : "default",
                      boxShadow: input.trim() ? `0 0 16px rgba(${glowRgba},0.4)` : "none",
                    }}
                  >
                    <Send size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Hint */}
            <p className="text-center text-[10px] mt-2 tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.12)" }}>
              {selectedModel ? `ENGINE // ${selectedModel}` : "SHIFT+ENTER for new line · ENTER to send"}
            </p>
          </div>
        </div>

        {/* ── FOOTER ─────────────────────────────────────────── */}
        <footer
          className="flex items-center justify-between px-6 py-2 shrink-0"
          style={{ borderTop: `1px solid rgba(${glowRgba},0.1)`, background: "rgba(2,6,23,0.92)" }}
        >
          <div className="flex items-center gap-2">
            <Shield size={10} style={{ color: `rgba(${glowRgba},0.45)` }} />
            <span className="text-[10px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.45)` }}>SECURE_NODE</span>
          </div>
          <div className="flex items-center gap-4">
            {/* Connector status chips */}
            {CONNECTORS.filter((c) => connectorStatus[c.id]).map((c) => (
              <div key={c.id} className="flex items-center gap-1.5">
                <div className="w-[5px] h-[5px] rounded-full" style={{ background: borderColor, boxShadow: `0 0 4px ${borderColor}` }} />
                <span className="text-[9px] tracking-[0.1em]" style={{ color: `rgba(${glowRgba},0.4)` }}>{c.label.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </footer>
      </main>

      {/* ═══════════════════════ ENGINE DRAWER ═══════════════════════ */}
      <AnimatePresence>
        {engineDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEngineDrawerOpen(false)}
              className="fixed inset-0 z-30"
              style={{ background: "rgba(0,0,0,0.4)" }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ type: "spring", damping: 28, stiffness: 350 }}
              className="fixed z-40 overflow-hidden"
              style={{
                bottom: "calc(60px + 56px)",
                left: "50%",
                transform: "translateX(-50%)",
                width: "min(640px, calc(100vw - 128px))",
                background: "rgba(2,6,23,0.97)",
                border: `1px solid rgba(${glowRgba},0.18)`,
                borderRadius: 14,
                backdropFilter: "blur(24px)",
                boxShadow: `0 0 60px rgba(0,0,0,0.7), 0 0 40px rgba(${glowRgba},0.06)`,
              }}
            >
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="text-[11px] tracking-[0.15em]" style={{ color: "rgba(255,255,255,0.35)" }}>SELECT AI ENGINE</span>
                <button onClick={() => setEngineDrawerOpen(false)} style={{ color: "rgba(255,255,255,0.25)" }}><X size={14} /></button>
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
                      <span className="text-[9px] tracking-[0.2em]" style={{ color: cat.color }}>{cat.label}</span>
                      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${cat.color}40, transparent)` }} />
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
                            className="text-left rounded-[10px] p-2.5 transition-all duration-200 group"
                            style={{
                              background: isActive ? `rgba(${cat.glowRgba},0.1)` : "rgba(255,255,255,0.02)",
                              border: `1px solid ${isActive ? cat.color : "rgba(255,255,255,0.06)"}`,
                              boxShadow: isActive ? `0 0 14px rgba(${cat.glowRgba},0.3)` : "none",
                            }}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon size={13} style={{ color: isActive ? cat.color : "rgba(255,255,255,0.35)" }} />
                              {tool.isMedia && (
                                <span className="text-[8px] tracking-[0.1em] px-1.5 py-px rounded" style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)", color: "#a855f7" }}>
                                  MEDIA
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-semibold tracking-[0.03em] mb-0.5" style={{ color: isActive ? cat.color : "#e2e8f0" }}>{tool.name}</div>
                            <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{tool.subtitle}</div>
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

      {/* ═══════════════════════ GLOBAL KEYFRAMES ═══════════════════════ */}
      <style>{`
        @keyframes border-pulse {
          0%, 100% { box-shadow: 0 0 0 1px var(--glow-color), 0 0 16px var(--glow-color); }
          50%       { box-shadow: 0 0 0 1px var(--glow-color), 0 0 30px var(--glow-color); }
        }
        textarea::placeholder { color: rgba(255,255,255,0.15) !important; }
        textarea { scrollbar-width: none; }
        textarea::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
