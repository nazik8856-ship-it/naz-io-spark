import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  User,
  LogOut,
  History,
  Zap,
  Shield,
  ChevronRight,
  Layers,
} from "lucide-react";

// ─── Tool Registry ─────────────────────────────────────────────────────────────

type ToolEntry = {
  id: string;
  name: string;
  subtitle: string;
  icon: React.ElementType;
  isMedia?: boolean;
};

type Category = {
  color: string;
  glowColor: string;
  label: string;
  tools: ToolEntry[];
};

const AI_CATEGORIES: Record<string, Category> = {
  LOGIC: {
    color: "#06b6d4",
    glowColor: "rgba(6, 182, 212, 0.6)",
    label: "LOGIC",
    tools: [
      {
        id: "google/gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        subtitle: "The Brain",
        icon: Brain,
      },
      {
        id: "anthropic/claude-4.6-sonnet",
        name: "Claude 4.6 Sonnet",
        subtitle: "The Architect",
        icon: Building2,
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        subtitle: "The Manager",
        icon: Briefcase,
      },
    ],
  },
  CREATION: {
    color: "#a855f7",
    glowColor: "rgba(168, 85, 247, 0.6)",
    label: "CREATION",
    tools: [
      {
        id: "google/gemini-3-flash-image",
        name: "Nano Banana 2.0",
        subtitle: "The Designer",
        icon: Image,
      },
      {
        id: "google/veo-3",
        name: "Google Veo 3",
        subtitle: "The Cinematographer",
        icon: Video,
        isMedia: true,
      },
      {
        id: "elevenlabs/lyria",
        name: "ElevenLabs Lyria",
        subtitle: "The Voice",
        icon: Mic,
        isMedia: true,
      },
    ],
  },
  RESEARCH: {
    color: "#22c55e",
    glowColor: "rgba(34, 197, 94, 0.6)",
    label: "RESEARCH",
    tools: [
      {
        id: "google/notebooklm",
        name: "NotebookLM",
        subtitle: "The Librarian",
        icon: BookOpen,
      },
      {
        id: "x-ai/grok-4.20",
        name: "Grok 4.20",
        subtitle: "The Trendsetter",
        icon: TrendingUp,
      },
    ],
  },
};

// ─── Helper: find tool by ID ────────────────────────────────────────────────────

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

// ─── Main Dashboard Component ──────────────────────────────────────────────────

export default function Dashboard() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [activeNav, setActiveNav] = useState("Home");
  const [userEmail, setUserEmail] = useState<string | null>(null);
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

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-grow textarea ──────────────────────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const activeTool = findToolById(selectedModel);
  const isMediaMode = activeTool?.tool.isMedia === true;
  const borderColor = activeTool?.category.color ?? "#22c55e";
  const borderGlow = activeTool?.category.glowColor ?? "rgba(34, 197, 94, 0.3)";

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleSelectTool(id: string) {
    setSelectedModel(id);
    setDrawerOpen(false);
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      {
        role: "ai",
        text: `[${activeTool?.tool.name ?? "NazAI"} // ${selectedModel ?? "default"}] — Processing your workflow...`,
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
      style={{ background: "#020617", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
      className="flex h-screen w-screen overflow-hidden text-white"
    >
      {/* ══════════════════════════════════════════════════════════ SIDEBAR */}
      <aside
        style={{ borderRight: "1px solid rgba(34,197,94,0.15)", background: "#020617" }}
        className="flex flex-col items-center w-16 py-6 shrink-0 z-20"
      >
        {/* Logo */}
        <div className="mb-8">
          <Zap size={22} style={{ color: "#22c55e" }} />
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(({ icon: Icon, label }) => (
            <button
              key={label}
              onClick={() => setActiveNav(label)}
              title={label}
              style={{
                color: activeNav === label ? "#22c55e" : "rgba(34,197,94,0.4)",
                background: activeNav === label ? "rgba(34,197,94,0.08)" : "transparent",
                borderRadius: "8px",
                transition: "all 0.2s",
              }}
              className="w-10 h-10 flex items-center justify-center hover:text-green-400"
            >
              <Icon size={18} />
            </button>
          ))}
        </nav>

        {/* User / Sign-out */}
        <div className="flex flex-col items-center gap-2 mt-auto">
          {userEmail && (
            <div
              title={userEmail}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                color: "#22c55e",
              }}
            >
              {userEmail[0].toUpperCase()}
            </div>
          )}
          <button
            onClick={handleSignOut}
            title="Sign out"
            style={{ color: "rgba(34,197,94,0.4)" }}
            className="w-10 h-10 flex items-center justify-center hover:text-green-400"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════ MAIN */}
      <main className="flex flex-col flex-1 min-w-0 relative">
        {/* ── TOP HEADER ─────────────────────────────────────────────────── */}
        <header
          style={{
            borderBottom: "1px solid rgba(34,197,94,0.12)",
            background: "rgba(2,6,23,0.95)",
            backdropFilter: "blur(8px)",
          }}
          className="flex items-center justify-between px-6 py-3 shrink-0"
        >
          <div className="flex items-center gap-3">
            <span style={{ color: "#22c55e", fontSize: 11, letterSpacing: "0.15em" }}>NAZAI://</span>
            <span style={{ color: "rgba(34,197,94,0.5)", fontSize: 11 }}>HOME</span>
            <ChevronRight size={10} style={{ color: "rgba(34,197,94,0.3)" }} />
            {activeTool && (
              <span style={{ color: activeTool.category.color, fontSize: 11, letterSpacing: "0.1em" }}>
                {activeTool.tool.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "rgba(34,197,94,0.5)",
                fontFamily: "monospace",
              }}
            >
              {new Date()
                .toLocaleDateString("en-US", {
                  weekday: "short",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
                .toUpperCase()}
            </span>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 6px #22c55e",
                animation: "pulse 2s infinite",
              }}
            />
          </div>
        </header>

        {/* ── WORKSPACE ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-4">
          {/* Message Feed */}
          <div className="flex-1 w-full max-w-2xl overflow-y-auto py-8 space-y-4 scrollbar-thin">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    border: `1px solid rgba(34,197,94,0.3)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Zap size={20} style={{ color: "#22c55e" }} />
                </div>
                <div>
                  <p style={{ color: "rgba(34,197,94,0.7)", fontSize: 13, letterSpacing: "0.12em" }}>
                    WORKFLOW ANIMATOR READY
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 6 }}>
                    Select an AI engine below, then describe your workflow.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "78%",
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: msg.role === "user" ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
                    border: msg.role === "user" ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(255,255,255,0.07)",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: msg.role === "user" ? "#e2e8f0" : "rgba(255,255,255,0.75)",
                    fontFamily: "inherit",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* ── ACTIVE TOOL CHIP ─────────────────────────────────────────── */}
          {activeTool && (
            <div className="w-full max-w-2xl mb-2 flex items-center gap-2">
              {/* Media Mode Badge */}
              {isMediaMode && (
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.15em",
                    padding: "3px 10px",
                    borderRadius: 4,
                    background: "rgba(168,85,247,0.15)",
                    border: "1px solid rgba(168,85,247,0.5)",
                    color: "#a855f7",
                    boxShadow: "0 0 10px rgba(168,85,247,0.3)",
                    animation: "mediaGlow 1.5s ease-in-out infinite alternate",
                  }}
                >
                  ▶ MEDIA_GENERATION_MODE_ACTIVE
                </span>
              )}

              {/* Tool Chip */}
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  padding: "3px 10px",
                  borderRadius: 4,
                  background: `${activeTool.category.color}15`,
                  border: `1px solid ${activeTool.category.color}50`,
                  color: activeTool.category.color,
                  marginLeft: isMediaMode ? 0 : "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
                onClick={() => setSelectedModel(null)}
                title="Click to deselect"
              >
                {activeTool.tool.name}
                <X size={10} />
              </span>
            </div>
          )}

          {/* ── INPUT AREA ───────────────────────────────────────────────── */}
          <div className="w-full max-w-2xl mb-6">
            <div
              style={{
                border: `1px solid ${activeTool ? borderColor : "rgba(34,197,94,0.25)"}`,
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                boxShadow: activeTool ? `0 0 0 1px ${borderColor}30, 0 0 20px ${borderGlow}` : "none",
                transition: "all 0.3s ease",
                animation: activeTool ? "borderPulse 2s ease-in-out infinite" : "none",
                position: "relative",
              }}
            >
              {/* + Tool Button */}
              <button
                onClick={() => setDrawerOpen((v) => !v)}
                style={{
                  position: "absolute",
                  left: 12,
                  bottom: 14,
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: drawerOpen ? "rgba(34,197,94,0.2)" : "rgba(34,197,94,0.08)",
                  border: `1px solid ${drawerOpen ? "#22c55e" : "rgba(34,197,94,0.3)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  color: "#22c55e",
                  zIndex: 10,
                }}
                title="Select AI Engine"
              >
                {drawerOpen ? <X size={14} /> : <Plus size={14} />}
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeTool
                    ? `Ask ${activeTool.tool.name} anything... (↵ to send)`
                    : "Describe your workflow... (↵ to send)"
                }
                rows={1}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  padding: "14px 48px 14px 52px",
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "#e2e8f0",
                  fontFamily: "inherit",
                  caretColor: activeTool ? borderColor : "#22c55e",
                }}
              />

              {/* Send Button */}
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                style={{
                  position: "absolute",
                  right: 12,
                  bottom: 14,
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: input.trim() ? (activeTool ? borderColor : "#22c55e") : "rgba(255,255,255,0.05)",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: input.trim() ? "pointer" : "default",
                  transition: "all 0.2s",
                  color: input.trim() ? "#020617" : "rgba(255,255,255,0.2)",
                }}
              >
                <Send size={13} />
              </button>
            </div>

            {/* Hint */}
            <p
              style={{
                textAlign: "center",
                fontSize: 10,
                color: "rgba(255,255,255,0.18)",
                marginTop: 8,
                letterSpacing: "0.08em",
              }}
            >
              {selectedModel ? `ENGINE // ${selectedModel}` : "NO ENGINE SELECTED — CLICK + TO CHOOSE"}
            </p>
          </div>
        </div>

        {/* ── BOTTOM FOOTER ──────────────────────────────────────────────────── */}
        <footer
          style={{
            borderTop: "1px solid rgba(34,197,94,0.12)",
            background: "rgba(2,6,23,0.95)",
          }}
          className="flex items-center justify-between px-6 py-2 shrink-0"
        >
          <div className="flex items-center gap-2">
            <Shield size={10} style={{ color: "rgba(34,197,94,0.5)" }} />
            <span style={{ fontSize: 10, letterSpacing: "0.15em", color: "rgba(34,197,94,0.5)" }}>SECURE_NODE</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 5px #22c55e",
              }}
            />
            <span style={{ fontSize: 10, letterSpacing: "0.15em", color: "rgba(34,197,94,0.5)" }}>SYNCHRONIZED</span>
          </div>
        </footer>
      </main>

      {/* ══════════════════════════════════════════════════════════ AI TOOL DRAWER */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />

          {/* Drawer Panel — anchored above input, centered */}
          <div
            style={{
              position: "fixed",
              bottom: "calc(60px + 56px)",
              left: "50%",
              transform: "translateX(-50%)",
              width: "min(640px, calc(100vw - 128px))",
              background: "rgba(2,6,23,0.97)",
              border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 14,
              backdropFilter: "blur(20px)",
              boxShadow: "0 0 40px rgba(0,0,0,0.8), 0 0 60px rgba(34,197,94,0.05)",
              zIndex: 40,
              overflow: "hidden",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)" }}>
                SELECT AI ENGINE
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                style={{ color: "rgba(255,255,255,0.3)", cursor: "pointer" }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Categories */}
            <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
              {Object.entries(AI_CATEGORIES).map(([catKey, cat]) => (
                <div key={catKey}>
                  {/* Category Label */}
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.2em",
                      color: cat.color,
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 1,
                        background: cat.color,
                        opacity: 0.5,
                      }}
                    />
                    {cat.label}
                    <div
                      style={{
                        flex: 1,
                        height: 1,
                        background: `linear-gradient(90deg, ${cat.color}40, transparent)`,
                      }}
                    />
                  </div>

                  {/* Tool Grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${cat.tools.length}, 1fr)`,
                      gap: 8,
                    }}
                  >
                    {cat.tools.map((tool) => {
                      const Icon = tool.icon;
                      const isActive = selectedModel === tool.id;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => handleSelectTool(tool.id)}
                          style={{
                            background: isActive ? `${cat.color}18` : "rgba(255,255,255,0.03)",
                            border: `1px solid ${isActive ? cat.color : "rgba(255,255,255,0.08)"}`,
                            borderRadius: 10,
                            padding: "10px 12px",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "all 0.2s",
                            boxShadow: isActive ? `0 0 12px ${cat.glowColor}` : "none",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = `${cat.color}60`;
                              (e.currentTarget as HTMLButtonElement).style.background = `${cat.color}0a`;
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
                              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
                            }
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <Icon size={13} style={{ color: isActive ? cat.color : "rgba(255,255,255,0.4)" }} />
                            {tool.isMedia && (
                              <span
                                style={{
                                  fontSize: 8,
                                  letterSpacing: "0.1em",
                                  padding: "1px 5px",
                                  borderRadius: 3,
                                  background: "rgba(168,85,247,0.15)",
                                  border: "1px solid rgba(168,85,247,0.3)",
                                  color: "#a855f7",
                                }}
                              >
                                MEDIA
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: isActive ? cat.color : "#e2e8f0",
                              letterSpacing: "0.03em",
                              marginBottom: 2,
                            }}
                          >
                            {tool.name}
                          </div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em" }}>
                            {tool.subtitle}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════ GLOBAL STYLES */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');

        * { box-sizing: border-box; }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(34,197,94,0.2); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(34,197,94,0.4); }

        @keyframes borderPulse {
          0%, 100% { box-shadow: 0 0 0 1px currentColor, 0 0 16px var(--glow, rgba(34,197,94,0.3)); }
          50%       { box-shadow: 0 0 0 1px currentColor, 0 0 28px var(--glow, rgba(34,197,94,0.5)); }
        }

        @keyframes mediaGlow {
          from { box-shadow: 0 0 8px rgba(168,85,247,0.3); }
          to   { box-shadow: 0 0 18px rgba(168,85,247,0.7); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }

        textarea::placeholder { color: rgba(255,255,255,0.2); }
        textarea { scrollbar-width: none; }
        textarea::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
