import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
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

// ─── Sidebar Nav Items ──────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { icon: Home, label: "Home" },
  { icon: MessageSquare, label: "Workflows" },
  { icon: History, label: "History" },
  { icon: Layers, label: "Integrations" },
  { icon: Settings, label: "Settings" },
];

// ─── Component ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [activeNav, setActiveNav] = useState("Home");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const activeTool = findToolById(selectedModel);
  const isMediaMode = activeTool?.category.label === "CREATION";
  const glowRgba = activeTool?.category.glowRgba ?? "34,197,94";
  const borderColor = activeTool?.category.color ?? "#22c55e";

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSelectTool = useCallback((id: string) => {
    setSelectedModel(id);
    setDrawerOpen(false);
  }, []);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      {
        role: "ai",
        text: `[${activeTool?.tool.name ?? "NazAI"} // ${selectedModel ?? "default"}] — Node processing signal recognized. Executing workflow...`,
      },
    ]);
    setInput("");
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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-screen w-screen overflow-hidden font-mono"
      style={{ background: "#020617", color: "#e2e8f0" }}
    >
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
              onClick={handleSignOut}
              title="Sign out"
              className="w-10 h-10 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: `rgba(${glowRgba},0.35)` }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* ═══════════════════════ MAIN ═══════════════════════ */}
      <main className="flex flex-col flex-1 min-w-0 relative">
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0 backdrop-blur-md"
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
            <span className="text-[11px] tracking-[0.15em]" style={{ color: borderColor }}>
              NAZAI://
            </span>
            <span className="text-[11px]" style={{ color: `rgba(${glowRgba},0.45)` }}>
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
            <span className="text-[10px] tracking-[0.12em] font-mono" style={{ color: `rgba(${glowRgba},0.4)` }}>
              {new Date()
                .toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })
                .toUpperCase()}
            </span>
            <div className="flex items-center gap-2">
              <div
                className="w-[6px] h-[6px] rounded-full animate-status-pulse"
                style={{ background: borderColor, boxShadow: `0 0 6px ${borderColor}` }}
              />
              <span className="text-[9px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.4)` }}>
                SYNCHRONIZED
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-4">
          {activeNav === "Home" ? (
            <>
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
                      className="max-w-[78%] px-3.5 py-2.5 text-[13px] leading-relaxed font-mono"
                      style={{
                        borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                        background: msg.role === "user" ? `rgba(${glowRgba},0.08)` : "rgba(255,255,255,0.03)",
                        border:
                          msg.role === "user" ? `1px solid rgba(${glowRgba},0.2)` : "1px solid rgba(255,255,255,0.06)",
                        color: msg.role === "user" ? "#e2e8f0" : "rgba(255,255,255,0.7)",
                      }}
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </div>

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
                      className="text-[10px] tracking-[0.1em] px-2.5 py-1 rounded flex items-center gap-1.5 cursor-pointer ml-auto hover:brightness-125 transition-all"
                      style={{
                        background: `rgba(${activeTool.category.glowRgba},0.1)`,
                        border: `1px solid rgba(${activeTool.category.glowRgba},0.35)`,
                        color: activeTool.category.color,
                      }}
                      onClick={() => setSelectedModel(null)}
                      title="Deselect Engine"
                    >
                      {activeTool.tool.name}
                      <X size={10} />
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="w-full max-w-2xl mb-6 relative">
                <div
                  className="relative rounded-xl transition-all duration-300"
                  style={{
                    border: `1px solid rgba(${glowRgba},${activeTool ? "0.5" : "0.2"})`,
                    background: "rgba(255,255,255,0.025)",
                    boxShadow: activeTool
                      ? `0 0 0 1px rgba(${glowRgba},0.15), 0 0 24px rgba(${glowRgba},0.15)`
                      : "none",
                    animation: activeTool ? "border-pulse 2s ease-in-out infinite" : "none",
                    ["--glow-color" as string]: `rgba(${glowRgba},0.4)`,
                  }}
                >
                  <button
                    onClick={() => setDrawerOpen((v) => !v)}
                    className="absolute left-3 bottom-3.5 w-7 h-7 rounded-full flex items-center justify-center z-10 transition-all duration-200"
                    style={{
                      background: drawerOpen ? `rgba(${glowRgba},0.18)` : `rgba(${glowRgba},0.06)`,
                      border: `1px solid ${drawerOpen ? borderColor : `rgba(${glowRgba},0.25)`}`,
                      color: borderColor,
                    }}
                    title="Select AI Engine"
                  >
                    <motion.div animate={{ rotate: drawerOpen ? 45 : 0 }} transition={{ duration: 0.15 }}>
                      <Plus size={14} />
                    </motion.div>
                  </button>

                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      activeTool
                        ? `Mission for ${activeTool.tool.name}... (↵ to send)`
                        : "Describe your system mission... (↵ to send)"
                    }
                    rows={1}
                    className="w-full bg-transparent border-none outline-none resize-none font-mono text-[13px] leading-relaxed placeholder:text-white/20"
                    style={{ padding: "14px 48px 14px 52px", color: "#e2e8f0", caretColor: borderColor }}
                  />

                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="absolute right-3 bottom-3.5 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200"
                    style={{
                      background: input.trim() ? borderColor : "rgba(255,255,255,0.04)",
                      color: input.trim() ? "#020617" : "rgba(255,255,255,0.15)",
                      cursor: input.trim() ? "pointer" : "default",
                    }}
                  >
                    <Send size={13} />
                  </button>
                </div>

                <p
                  className="text-center text-[10px] mt-2 tracking-[0.08em]"
                  style={{ color: "rgba(255,255,255,0.15)" }}
                >
                  {selectedModel ? `SYSTEM_NODE // ${selectedModel}` : "NO ENGINE SELECTED — CLICK + TO CHOOSE"}
                </p>
              </div>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full text-center"
            >
              <p className="text-[13px] tracking-[0.2em] mb-2" style={{ color: borderColor }}>
                {activeNav.toUpperCase()}_SECTION
              </p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                System node currently under construction.
              </p>
            </motion.div>
          )}
        </div>

        <footer
          className="flex items-center justify-between px-6 py-2 shrink-0"
          style={{ borderTop: `1px solid rgba(${glowRgba},0.1)`, background: "rgba(2,6,23,0.92)" }}
        >
          <div className="flex items-center gap-2">
            <Shield size={10} style={{ color: `rgba(${glowRgba},0.45)` }} />
            <span className="text-[10px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.45)` }}>
              SECURE_NODE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-[5px] h-[5px] rounded-full animate-status-pulse"
              style={{ background: borderColor, boxShadow: `0 0 5px ${borderColor}` }}
            />
            <span className="text-[10px] tracking-[0.15em]" style={{ color: `rgba(${glowRgba},0.45)` }}>
              SYNCHRONIZED
            </span>
          </div>
        </footer>
      </main>

      {/* ═══════════════════════ AI TOOL DRAWER ═══════════════════════ */}
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

      <style>{`
        @keyframes border-pulse {
          0%, 100% { box-shadow: 0 0 0 1px var(--glow-color), 0 0 16px var(--glow-color); }
          50%       { box-shadow: 0 0 0 1px var(--glow-color), 0 0 30px var(--glow-color); }
        }
        @keyframes status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .animate-status-pulse { animation: status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        textarea::placeholder { color: rgba(255,255,255,0.18) !important; }
        textarea { scrollbar-width: none; }
        textarea::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
