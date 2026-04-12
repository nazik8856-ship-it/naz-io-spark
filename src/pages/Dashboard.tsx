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
  RotateCcw,
  Loader2,
  AlertTriangle,
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

type NavItem = {
  icon: React.ElementType;
  label: string;
  gradient: string;
  glowRgba: string;
  color: string;
};

const NAV_ITEMS: NavItem[] = [
  { icon: Home, label: "Home", gradient: "linear-gradient(135deg, #22c55e, #10b981)", glowRgba: "34,197,94", color: "#22c55e" },
  { icon: MessageSquare, label: "Workflows", gradient: "linear-gradient(135deg, #a855f7, #ec4899)", glowRgba: "168,85,247", color: "#a855f7" },
  { icon: History, label: "History", gradient: "linear-gradient(135deg, #f59e0b, #eab308)", glowRgba: "245,158,11", color: "#f59e0b" },
  { icon: Layers, label: "Integrations", gradient: "linear-gradient(135deg, #14b8a6, #06b6d4)", glowRgba: "20,184,166", color: "#14b8a6" },
  { icon: Clock, label: "Recently", gradient: "linear-gradient(135deg, #06b6d4, #3b82f6)", glowRgba: "6,182,212", color: "#06b6d4" },
  { icon: Archive, label: "Archives", gradient: "linear-gradient(135deg, #818cf8, #c084fc)", glowRgba: "129,140,248", color: "#818cf8" },
  { icon: Trash2, label: "Trash", gradient: "linear-gradient(135deg, #ef4444, #f97316)", glowRgba: "239,68,68", color: "#ef4444" },
  { icon: Settings, label: "Settings", gradient: "linear-gradient(135deg, #94a3b8, #64748b)", glowRgba: "148,163,184", color: "#94a3b8" },
];
const STYLES = ["Technical", "Creative", "Fast"] as const;

const SKILLS = [
  { icon: Lightbulb, label: "Explain Concept" },
  { icon: Bug, label: "Debug Build" },
  { icon: HeartPulse, label: "Project Health" },
];

const springTransition = { type: "spring" as const, damping: 28, stiffness: 350, mass: 0.8 };
const snappySpring = { type: "spring" as const, damping: 30, stiffness: 500, mass: 0.6 };

// ─── Mission type for workspace persistence ─────────────────────────────────────

interface WorkspaceMission {
  id: string;
  directive: string;
  status: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  attachment_urls: string[] | null;
}

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
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceMissions, setWorkspaceMissions] = useState<WorkspaceMission[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Session ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Workspace Persistence: Fetch missions from Supabase ────────────────────
  const fetchWorkspaceMissions = useCallback(async () => {
    if (!userId) return;
    setWorkspaceLoading(true);
    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setWorkspaceMissions(data as WorkspaceMission[]);
    }
    setWorkspaceLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchWorkspaceMissions();
  }, [fetchWorkspaceMissions]);

  // ── Workspace actions: archive, trash, restore, permanent delete ───────────
  const archiveMission = useCallback(async (missionId: string) => {
    const { error } = await supabase.from("missions").update({ status: "archived" }).eq("id", missionId);
    if (!error) await fetchWorkspaceMissions();
  }, [fetchWorkspaceMissions]);

  const trashMission = useCallback(async (missionId: string) => {
    const { error } = await supabase.from("missions").update({ status: "trashed" }).eq("id", missionId);
    if (!error) await fetchWorkspaceMissions();
  }, [fetchWorkspaceMissions]);

  const restoreMission = useCallback(async (missionId: string) => {
    const { error } = await supabase.from("missions").update({ status: "active" }).eq("id", missionId);
    if (!error) await fetchWorkspaceMissions();
  }, [fetchWorkspaceMissions]);

  const permanentDeleteMission = useCallback(async (missionId: string) => {
    const { error } = await supabase.from("missions").delete().eq("id", missionId);
    if (!error) await fetchWorkspaceMissions();
  }, [fetchWorkspaceMissions]);

  // ── Derived workspace data ─────────────────────────────────────────────────
  const activeMissions = workspaceMissions.filter((m) => m.status === "active" || m.status === "completed");
  const archivedMissions = workspaceMissions.filter((m) => m.status === "archived");
  const trashedMissions = workspaceMissions.filter((m) => m.status === "trashed");
  const recentMissions = activeMissions.slice(0, 10);

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

  const activeNavItem = NAV_ITEMS.find((n) => n.label === activeNav) ?? NAV_ITEMS[0];

  // Section-aware accent: on Home, use selected engine color; otherwise, use the nav item's theme
  const sectionGlow = activeNavItem.glowRgba;
  const sectionColor = activeNavItem.color;
  const glowRgba = activeNav === "Home" ? (activeTool?.category.glowRgba ?? sectionGlow) : sectionGlow;
  const borderColor = activeNav === "Home" ? (activeTool?.category.color ?? sectionColor) : sectionColor;

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
  const STYLED_SECTIONS = ["Recently", "Archives", "Trash"];
  const isStyledSection = STYLED_SECTIONS.includes(activeNav);

  // Determine which missions to show for each section
  function getMissionsForSection(): WorkspaceMission[] {
    switch (activeNav) {
      case "Recently":
        return recentMissions;
      case "Archives":
        return archivedMissions;
      case "Trash":
        return trashedMissions;
      default:
        return [];
    }
  }

  function renderMissionCard(mission: WorkspaceMission, index: number) {
    const navItem = activeNavItem;
    const isTrash = activeNav === "Trash";
    const isArchive = activeNav === "Archives";
    return (
      <motion.div
        key={mission.id}
        className="rounded-xl cursor-default group relative"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: `1px solid rgba(${navItem.glowRgba},0.15)`,
          boxShadow: "inset 0 1px 1px rgba(255,255,255,0.05)",
        }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...snappySpring, delay: index * 0.05 }}
        whileHover={{ y: -2, boxShadow: `0 4px 20px rgba(${navItem.glowRgba},0.12)` }}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] tracking-[0.12em] font-mono font-bold"
              style={{ color: navItem.color }}
            >
              MISSION_{mission.id.slice(0, 6).toUpperCase()}
            </span>
            <span
              className="text-[9px] tracking-[0.1em] px-2 py-0.5 rounded"
              style={{
                background: `rgba(${navItem.glowRgba},0.1)`,
                border: `1px solid rgba(${navItem.glowRgba},0.25)`,
                color: navItem.color,
              }}
            >
              {mission.status.toUpperCase()}
            </span>
          </div>
          <p
            className="text-[12px] leading-relaxed mb-3 line-clamp-2"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            {mission.directive.substring(0, 100)}{mission.directive.length > 100 ? "..." : ""}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
              {new Date(mission.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {isTrash ? (
                <>
                  <button
                    onClick={() => restoreMission(mission.id)}
                    className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                    title="Restore mission"
                  >
                    <RotateCcw size={12} style={{ color: "rgba(34,197,94,0.7)" }} />
                  </button>
                  <button
                    onClick={() => permanentDeleteMission(mission.id)}
                    className="p-1.5 rounded-md transition-colors hover:bg-red-500/10"
                    title="Delete permanently"
                  >
                    <AlertTriangle size={12} style={{ color: "rgba(239,68,68,0.7)" }} />
                  </button>
                </>
              ) : isArchive ? (
                <button
                  onClick={() => restoreMission(mission.id)}
                  className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                  title="Unarchive mission"
                >
                  <RotateCcw size={12} style={{ color: `rgba(${navItem.glowRgba},0.7)` }} />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => archiveMission(mission.id)}
                    className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                    title="Archive mission"
                  >
                    <Archive size={12} style={{ color: "rgba(129,140,248,0.7)" }} />
                  </button>
                  <button
                    onClick={() => trashMission(mission.id)}
                    className="p-1.5 rounded-md transition-colors hover:bg-red-500/10"
                    title="Move to trash"
                  >
                    <Trash2 size={12} style={{ color: "rgba(239,68,68,0.7)" }} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  function renderStyledSection() {
    const navItem = activeNavItem;
    const Icon = navItem.icon;
    const missions = getMissionsForSection();

    return (
      <motion.div
        key={activeNav}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
        className="flex flex-col items-center h-full w-full max-w-4xl mx-auto pt-8 overflow-y-auto scrollbar-thin"
      >
        {/* Section header */}
        <motion.div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: navItem.gradient,
            boxShadow: `0 0 40px rgba(${navItem.glowRgba},0.3), 0 0 80px rgba(${navItem.glowRgba},0.15)`,
            willChange: "transform",
          }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          <Icon size={26} className="text-white drop-shadow-lg" />
        </motion.div>
        <h2
          className="text-xl font-bold tracking-[0.1em] mb-1"
          style={{
            background: navItem.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {activeNav.toUpperCase()}
        </h2>
        <p className="text-[11px] tracking-[0.15em] mb-6" style={{ color: "rgba(255,255,255,0.25)" }}>
          {activeNav === "Trash" && "PERMANENTLY_DELETED ITEMS RESIDE HERE"}
          {activeNav === "Archives" && "ARCHIVED_MISSIONS // COLD_STORAGE"}
          {activeNav === "Recently" && "RECENT_ACTIVITY // TIMELINE_FEED"}
        </p>

        {/* Content: real data from Supabase */}
        {workspaceLoading ? (
          <div className="flex items-center gap-3 mt-8">
            <Loader2 size={18} className="animate-spin" style={{ color: navItem.color }} />
            <span className="text-[11px] tracking-[0.12em]" style={{ color: `rgba(${navItem.glowRgba},0.5)` }}>
              LOADING_DATA...
            </span>
          </div>
        ) : missions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 mt-8"
          >
            <Icon size={32} style={{ color: `rgba(${navItem.glowRgba},0.2)` }} />
            <p className="text-[12px] tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.25)" }}>
              {activeNav === "Trash" && "No trashed missions"}
              {activeNav === "Archives" && "No archived missions"}
              {activeNav === "Recently" && "No recent activity"}
            </p>
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.15)" }}>
              {activeNav === "Trash" && "Deleted items will appear here"}
              {activeNav === "Archives" && "Archive missions from Home to store them here"}
              {activeNav === "Recently" && "Start a mission to see activity"}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full pb-8">
            {missions.map((m, i) => renderMissionCard(m, i))}
          </div>
        )}
      </motion.div>
    );
  }

  function renderGenericSection() {
    const navItem = activeNavItem;
    return (
      <motion.div
        key={activeNav}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={snappySpring}
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
        transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
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
                        background: item.gradient,
                        opacity: 0.15,
                        boxShadow: `0 0 20px rgba(${item.glowRgba},0.3)`,
                      }}
                      transition={springTransition}
                    />
                  )}
                  <Icon
                    size={18}
                    className="relative z-10"
                    style={{
                      color: isActive ? item.color : "rgba(255,255,255,0.25)",
                      filter: isActive ? `drop-shadow(0 0 6px rgba(${item.glowRgba},0.6))` : "none",
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
      <AnimatePresence mode="wait">
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
              transition={snappySpring}
              className="fixed z-40 overflow-hidden"
              style={{
                bottom: "calc(60px + 70px)",
                left: "50%",
                transform: "translateX(-50%)",
                willChange: "transform, opacity",
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
      <AnimatePresence mode="wait">
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
              transition={snappySpring}
              className="fixed z-40 overflow-hidden"
              style={{
                bottom: "calc(60px + 70px)",
                left: "50%",
                transform: "translateX(-50%)",
                willChange: "transform, opacity",
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

      {/* ═══════════════════════ LOGOUT MODAL (Glass-morphic, Centered, Supabase Auth) ═══════════════════════ */}
      <AnimatePresence mode="wait">
        {logoutModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setLogoutModalOpen(false)}
              className="fixed inset-0 z-50"
              style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 20 }}
              transition={snappySpring}
              className="fixed z-50 flex flex-col items-center"
              style={{
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(420px, calc(100vw - 48px))",
                background: "rgba(2,6,23,0.85)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 16,
                backdropFilter: "blur(40px)",
                WebkitBackdropFilter: "blur(40px)",
                boxShadow: "0 0 80px rgba(0,0,0,0.8), 0 0 40px rgba(239,68,68,0.08), inset 0 1px 1px rgba(255,255,255,0.05)",
                padding: "32px 28px 24px",
              }}
            >
              <motion.div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  boxShadow: "0 0 30px rgba(239,68,68,0.1)",
                }}
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <LogOut size={22} className="text-red-400" />
              </motion.div>
              <h3 className="text-[14px] font-semibold tracking-[0.08em] text-white mb-2">SESSION_TERMINATION</h3>
              <p className="text-[12px] text-center leading-relaxed mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                Are you sure you want to terminate the session?
              </p>
              {userEmail && (
                <p className="text-[10px] font-mono mb-4" style={{ color: `rgba(${sectionGlow},0.4)` }}>
                  {userEmail}
                </p>
              )}
              <p className="text-[10px] font-mono mb-6 text-center" style={{ color: "rgba(239,68,68,0.45)" }}>
                All unsaved state will be purged from the workspace.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setLogoutModalOpen(false)}
                  className="flex-1 py-2.5 rounded-lg text-[12px] tracking-[0.08em] font-medium transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.5)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex-1 py-2.5 rounded-lg text-[12px] tracking-[0.08em] font-bold transition-all duration-200"
                  style={{
                    background: "rgba(239,68,68,0.15)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    color: "#ef4444",
                    boxShadow: "0 0 20px rgba(239,68,68,0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.25)";
                    e.currentTarget.style.boxShadow = "0 0 30px rgba(239,68,68,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.15)";
                    e.currentTarget.style.boxShadow = "0 0 20px rgba(239,68,68,0.1)";
                  }}
                >
                  Log Out
                </button>
              </div>
            </motion.div>
          </>
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
