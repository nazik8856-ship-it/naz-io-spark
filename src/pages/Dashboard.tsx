import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
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
  Palette,
  Sun,
  Moon,
  RotateCcw,
  Sliders,
  Sparkles,
  FolderKanban,
  Target,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── Type Definitions ──────────────────────────────────────────────────────────────

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

type Mission = {
  id: string;
  user_id: string;
  directive: string;
  status: "pending" | "active" | "completed" | "archived" | "trashed";
  created_at: string;
  updated_at: string;
};

type Theme = {
  gradient: string;
  glowRgba: string;
  color: string;
};

type ConnectorStatus = {
  supabase: boolean;
  vercel: boolean;
  github: boolean;
};

type Style = "Technical" | "Creative" | "Fast";

type AuraProfile = {
  glowPrimary: string;
  glowSecondary: string;
  textGlowIntensity: number;
  glassBlur: number;
  isLightMode: boolean;
};

const APP_VERSION = `2.1.0-BENTO-${Date.now()}`;

// ─── Constants ─────────────────────────────────────────────────────────────────────

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

const NAV_ITEMS = [
  { icon: Home, label: "Home" },
  { icon: MessageSquare, label: "Workflows" },
  { icon: History, label: "History" },
  { icon: Layers, label: "Integrations" },
  { icon: Clock, label: "Recently" },
  { icon: Archive, label: "Archives" },
  { icon: Trash2, label: "Trash" },
  { icon: Settings, label: "Settings" },
] as const;

const SECTION_THEMES: Record<string, Theme> = {
  Home: { gradient: "linear-gradient(135deg, #22c55e, #10b981)", glowRgba: "34,197,94", color: "#22c55e" },
  Workflows: { gradient: "linear-gradient(135deg, #a855f7, #ec4899)", glowRgba: "168,85,247", color: "#a855f7" },
  History: { gradient: "linear-gradient(135deg, #f59e0b, #d97706)", glowRgba: "245,158,11", color: "#f59e0b" },
  Integrations: { gradient: "linear-gradient(135deg, #3b82f6, #06b6d4)", glowRgba: "59,130,246", color: "#3b82f6" },
  Recently: { gradient: "linear-gradient(135deg, #06b6d4, #3b82f6)", glowRgba: "6,182,212", color: "#06b6d4" },
  Archives: { gradient: "linear-gradient(135deg, #818cf8, #c084fc)", glowRgba: "129,140,248", color: "#818cf8" },
  Trash: { gradient: "linear-gradient(135deg, #ef4444, #f97316)", glowRgba: "239,68,68", color: "#ef4444" },
  Settings: { gradient: "linear-gradient(135deg, #6366f1, #a855f7)", glowRgba: "99,102,241", color: "#6366f1" },
};

const STYLES: readonly Style[] = ["Technical", "Creative", "Fast"] as const;

const SKILLS = [
  { icon: Lightbulb, label: "Explain Concept", description: "Deep dive into complex topics" },
  { icon: Bug, label: "Debug Build", description: "Identify and fix issues" },
  { icon: HeartPulse, label: "Project Health", description: "Analyze system vitality" },
];

const springTransition = { type: "spring" as const, damping: 25, stiffness: 400 };

const DEFAULT_AURA_PROFILE: AuraProfile = {
  glowPrimary: "#22c55e",
  glowSecondary: "#a855f7",
  textGlowIntensity: 0.5,
  glassBlur: 25,
  isLightMode: false,
};

// ─── Helper Functions ──────────────────────────────────────────────────────────────

const findToolById = (id: string | null): { tool: ToolEntry; category: Category } | null => {
  if (!id) return null;
  for (const cat of Object.values(AI_CATEGORIES)) {
    const found = cat.tools.find((t) => t.id === id);
    if (found) return { tool: found, category: cat };
  }
  return null;
};

const getDefaultTheme = (): Theme => SECTION_THEMES["Home"];

const getRgbFromHex = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

const loadAuraProfile = (): AuraProfile => {
  const saved = localStorage.getItem("nazai-aura-profile");
  if (saved) {
    try {
      return { ...DEFAULT_AURA_PROFILE, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_AURA_PROFILE;
    }
  }
  return DEFAULT_AURA_PROFILE;
};

const saveAuraProfile = (profile: AuraProfile) => {
  localStorage.setItem("nazai-aura-profile", JSON.stringify(profile));
};

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

// ─── Component ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();

  // ── State ───────────────────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string; isSimulation?: boolean }[]>([]);
  const [activeNav, setActiveNav] = useState<string>("Home");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [webSearchActive, setWebSearchActive] = useState(false);
  const [activeStyle, setActiveStyle] = useState<Style>("Technical");
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus>({
    supabase: true,
    vercel: false,
    github: false,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(true);

  // Aura Design System State
  const [auraProfile, setAuraProfile] = useState<AuraProfile>(loadAuraProfile);

  // ── Refs ────────────────────────────────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Apply CSS Variables ─────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    const primaryRgb = getRgbFromHex(auraProfile.glowPrimary);
    const secondaryRgb = getRgbFromHex(auraProfile.glowSecondary);

    root.style.setProperty("--glow-primary", auraProfile.glowPrimary);
    root.style.setProperty("--glow-primary-rgb", primaryRgb);
    root.style.setProperty("--glow-secondary", auraProfile.glowSecondary);
    root.style.setProperty("--glow-secondary-rgb", secondaryRgb);
    root.style.setProperty("--text-glow-intensity", auraProfile.textGlowIntensity.toString());
    root.style.setProperty("--glass-blur", `${auraProfile.glassBlur}px`);

    if (auraProfile.isLightMode) {
      root.style.setProperty("--nazai-text-color", "#0f172a");
      root.style.setProperty("--nazai-bg-base", "#f1f5f9");
      root.style.setProperty("--nazai-border-light", "rgba(0,0,0,0.08)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.8)");
    } else {
      root.style.setProperty("--nazai-text-color", "#e2e8f0");
      root.style.setProperty("--nazai-bg-base", "#020617");
      root.style.setProperty("--nazai-border-light", "rgba(255,255,255,0.06)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.03)");
    }
  }, [auraProfile]);

  // ── Version Check ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const storedVersion = localStorage.getItem("last_run_version");
    if (storedVersion !== APP_VERSION) {
      localStorage.removeItem("nazai-aura-profile");
      localStorage.removeItem("nazai-mission-cache");
      localStorage.removeItem("nazai_version");
      localStorage.setItem("last_run_version", APP_VERSION);
      if (storedVersion) {
        window.location.reload();
        return;
      }
    }
  }, []);

  useEffect(() => {
    saveAuraProfile(auraProfile);
  }, [auraProfile]);

  // ── Derived State ───────────────────────────────────────────────────────────────
  const activeTool = useMemo(() => findToolById(selectedModel), [selectedModel]);
  const isMediaMode = activeTool?.category.label === "CREATION";
  const borderColor = activeTool?.category.color ?? auraProfile.glowPrimary;
  const activeNavItem = NAV_ITEMS.find((n) => n.label === activeNav) ?? NAV_ITEMS[0];
  const currentTheme = SECTION_THEMES[activeNav] ?? getDefaultTheme();

  const filteredMissions = useMemo(() => {
    switch (activeNav) {
      case "Trash":
        return missions.filter((m) => m.status === "trashed");
      case "Archives":
        return missions.filter((m) => m.status === "archived");
      case "Recently":
        return missions.filter((m) => m.status !== "trashed").slice(0, 10);
      case "History":
        return missions.filter((m) => m.status === "completed");
      case "Workflows":
        return missions.filter((m) => m.status === "pending" || m.status === "active");
      default:
        return missions.filter((m) => m.status !== "trashed");
    }
  }, [activeNav, missions]);

  // ── Effects ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    const getSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (isMounted) {
        setUserEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      }
    };
    getSession();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (isMounted) {
        setUserEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
        if (event === "SIGNED_IN") {
          setActiveNav("Home");
          setMessages([]);
        }
      }
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setMissions([]);
      setMissionsLoading(false);
      return;
    }
    let isMounted = true;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const fetchMissions = async () => {
      setMissionsLoading(true);
      try {
        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (abortController.signal.aborted) return;
        if (error) throw error;
        if (isMounted && data) setMissions(data as Mission[]);
      } catch (error) {
        console.error("Failed to fetch missions:", error);
        if (isMounted) setMissions([]);
      } finally {
        if (isMounted) setMissionsLoading(false);
      }
    };
    fetchMissions();
    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (simulationRef.current) clearTimeout(simulationRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────────
  const updateAuraProfile = useCallback((updates: Partial<AuraProfile>) => {
    setAuraProfile((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetAuraToDefault = useCallback(() => {
    setAuraProfile(DEFAULT_AURA_PROFILE);
  }, []);

  const toggleLightMode = useCallback(() => {
    setAuraProfile((prev) => ({ ...prev, isLightMode: !prev.isLightMode }));
  }, []);

  const handleNavClick = useCallback((label: string) => {
    setActiveNav(label);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setIsTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 800);
  }, []);

  const handleSelectTool = useCallback((id: string) => {
    setSelectedModel(id);
    setDrawerOpen(false);
  }, []);

  const streamSimulation = useCallback((msgIndex: number) => {
    const mockResponse =
      "[SIMULATION_MODE] // OFFLINE_DRAFT — Neural pathway rerouted through local inference cache. Executing fallback heuristic analysis on provided directive. Output confidence: 87.3%.";
    const words = mockResponse.split(" ");
    let wordIdx = 0;
    const appendWord = () => {
      if (wordIdx >= words.length) return;
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[msgIndex]) {
          updated[msgIndex] = { ...updated[msgIndex], text: words.slice(0, wordIdx + 1).join(" "), isSimulation: true };
        }
        return updated;
      });
      wordIdx++;
      simulationRef.current = setTimeout(appendWord, 60);
    };
    appendWord();
  }, []);

  const handleSend = useCallback(() => {
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
            text: `[${activeTool?.tool.name ?? "NazAI"}] — Executing workflow: "${trimmed.slice(0, 60)}..."`,
          };
        }
        return updated;
      });
    }, 1500);
  }, [input, messages.length, streamSimulation, activeTool]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSignOut = useCallback(async () => {
    setLogoutModalOpen(false);
    await supabase.auth.signOut();
    navigate("/");
  }, [navigate]);

  const handleFileUpload = useCallback(() => {
    fileInputRef.current?.click();
    setPlusMenuOpen(false);
  }, []);

  const handleSkillClick = useCallback((label: string) => {
    const command = `/${label.toLowerCase().replace(/\s/g, "-")}`;
    setInput((v) => (v ? `${v}\n${command}` : command));
    setPlusMenuOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleConnectorToggle = useCallback((key: keyof ConnectorStatus, checked: boolean) => {
    setConnectorStatus((prev) => ({ ...prev, [key]: checked }));
  }, []);

  // ─── Render Components ──────────────────────────────────────────────────────────

  const renderNavItem = useCallback(
    (item: (typeof NAV_ITEMS)[number]) => {
      const Icon = item.icon;
      const isActive = activeNav === item.label;
      const itemTheme = SECTION_THEMES[item.label] || SECTION_THEMES["Home"];
      return (
        <motion.button
          key={item.label}
          onClick={() => handleNavClick(item.label)}
          title={item.label}
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 relative group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isActive && (
            <motion.div
              layoutId="nav-active-bg"
              className="absolute inset-0 rounded-lg"
              style={{
                background: itemTheme.gradient,
                opacity: 0.15,
                boxShadow: `0 0 20px rgba(${itemTheme.glowRgba}, 0.3)`,
              }}
              transition={springTransition}
            />
          )}
          <Icon
            size={18}
            className="relative z-10"
            style={{
              color: isActive ? itemTheme.color : "rgba(255,255,255,0.25)",
              filter: isActive ? `drop-shadow(0 0 6px rgba(${itemTheme.glowRgba}, 0.6))` : "none",
            }}
          />
        </motion.button>
      );
    },
    [activeNav, handleNavClick],
  );

  const renderMissionItem = useCallback(
    (mission: Mission, index: number) => (
      <motion.div
        key={mission.id}
        variants={itemVariants}
        whileHover={{ scale: 1.01, backgroundColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)` }}
        className="group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200"
        style={{
          background: "var(--nazai-card-bg)",
          border: "1px solid var(--nazai-border-light)",
          backdropFilter: `blur(${auraProfile.glassBlur}px)`,
        }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.12)` }}
        >
          <Zap size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.7)` }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate" style={{ color: "var(--nazai-text-color)" }}>
            {mission.directive?.slice(0, 80) || "Untitled Mission"}
          </p>
          <p className="text-[10px] font-mono mt-0.5 text-white/30">
            {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
          </p>
        </div>
        <ChevronRight
          size={14}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }}
        />
      </motion.div>
    ),
    [auraProfile.glowPrimary, auraProfile.glassBlur],
  );

  // Settings View
  const SettingsView = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={springTransition}
      className="flex-1 overflow-y-auto px-6 py-8"
    >
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1
            className="text-5xl font-black uppercase tracking-tighter"
            style={{
              background: `linear-gradient(135deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            AURA STUDIO
          </h1>
          <p className="text-[10px] tracking-[0.3em] uppercase font-mono text-white/40 mt-3">
            DESIGN SYSTEM // REAL-TIME
          </p>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 gap-5"
        >
          {/* Colors */}
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Palette size={16} /> CHROMATIC CORE
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">PRIMARY GLOW</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-10 h-10 rounded-xl"
                    style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 15px ${auraProfile.glowPrimary}` }}
                  />
                  <input
                    type="color"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="w-16 h-9 rounded bg-transparent border border-white/20"
                  />
                  <input
                    type="text"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10"
                    style={{ color: "var(--nazai-text-color)" }}
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">SECONDARY GLOW</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-10 h-10 rounded-xl"
                    style={{
                      background: auraProfile.glowSecondary,
                      boxShadow: `0 0 15px ${auraProfile.glowSecondary}`,
                    }}
                  />
                  <input
                    type="color"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="w-16 h-9 rounded bg-transparent border border-white/20"
                  />
                  <input
                    type="text"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10"
                    style={{ color: "var(--nazai-text-color)" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Controls */}
          <motion.div
            variants={itemVariants}
            className="p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Sliders size={16} /> ATMOSPHERIC
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[9px] font-mono text-white/40 mb-1">
                  <span>TEXT GLOW</span>
                  <span>{auraProfile.textGlowIntensity.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={auraProfile.textGlowIntensity}
                  onChange={(e) => updateAuraProfile({ textGlowIntensity: parseFloat(e.target.value) })}
                  className="w-full h-1 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
                  }}
                />
              </div>
              <div>
                <div className="flex justify-between text-[9px] font-mono text-white/40 mb-1">
                  <span>GLASS BLUR</span>
                  <span>{auraProfile.glassBlur}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  step="1"
                  value={auraProfile.glassBlur}
                  onChange={(e) => updateAuraProfile({ glassBlur: parseInt(e.target.value) })}
                  className="w-full h-1 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
                  }}
                />
              </div>
            </div>
          </motion.div>

          {/* Mode Toggle */}
          <motion.div
            variants={itemVariants}
            className="p-5 rounded-xl flex items-center justify-between"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <div className="flex items-center gap-2">
              {auraProfile.isLightMode ? (
                <Sun size={18} style={{ color: auraProfile.glowPrimary }} />
              ) : (
                <Moon size={18} style={{ color: auraProfile.glowPrimary }} />
              )}
              <div>
                <div className="text-sm font-semibold">Frosted Quartz</div>
                <div className="text-[9px] font-mono text-white/30">{auraProfile.isLightMode ? "LIGHT" : "DARK"}</div>
              </div>
            </div>
            <Switch checked={auraProfile.isLightMode} onCheckedChange={toggleLightMode} />
          </motion.div>

          {/* Preview */}
          <motion.div
            variants={itemVariants}
            className="p-5 rounded-xl text-center"
            style={{ background: "var(--nazai-card-bg)", border: `1px solid ${auraProfile.glowPrimary}40` }}
          >
            <p
              className="text-xs font-mono font-bold"
              style={{
                color: "var(--nazai-text-color)",
                textShadow: `0 0 ${auraProfile.textGlowIntensity * 8}px ${auraProfile.glowPrimary}`,
              }}
            >
              NAZAI:// AURA ACTIVE
            </p>
            <div className="flex justify-center gap-2 mt-2">
              <div
                className="w-6 h-6 rounded-full"
                style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 12px ${auraProfile.glowPrimary}` }}
              />
              <div
                className="w-6 h-6 rounded-full"
                style={{ background: auraProfile.glowSecondary, boxShadow: `0 0 12px ${auraProfile.glowSecondary}` }}
              />
            </div>
          </motion.div>

          {/* Reset */}
          <motion.div variants={itemVariants} className="md:col-span-2">
            <motion.button
              onClick={resetAuraToDefault}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <RotateCcw size={14} /> RESET TO DEFAULT
            </motion.button>
          </motion.div>
        </motion.div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          onClick={() => setActiveNav("Home")}
          className="mt-6 w-full py-2.5 rounded-xl text-sm font-medium"
          style={{
            background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)`,
            border: `1px solid ${auraProfile.glowPrimary}40`,
            color: auraProfile.glowPrimary,
          }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          ← RETURN TO DASHBOARD
        </motion.button>
      </div>
    </motion.div>
  );

  // Home View
  const HomeView = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center w-full h-full"
    >
      <div className="flex-1 w-full max-w-2xl overflow-y-auto py-6 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)` }}
            >
              <Zap size={22} style={{ color: borderColor }} />
            </div>
            <div>
              <p
                className="text-xs tracking-wide"
                style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }}
              >
                WORKFLOW ANIMATOR READY
              </p>
              <p className="text-[10px] mt-1 text-white/30">Select an AI engine, then describe your mission.</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[78%] px-3 py-2 text-xs"
              style={{
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background:
                  msg.role === "user" ? `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` : "var(--nazai-card-bg)",
                border: `1px solid var(--nazai-border-light)`,
                color: "var(--nazai-text-color)",
              }}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {activeTool && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full max-w-2xl mb-2 flex justify-end"
        >
          <span
            className="text-[9px] px-2 py-1 rounded-full flex items-center gap-1"
            style={{
              background: `rgba(${activeTool.category.glowRgba},0.15)`,
              border: `1px solid rgba(${activeTool.category.glowRgba},0.3)`,
              color: activeTool.category.color,
            }}
          >
            {activeTool.tool.name} <X size={10} className="cursor-pointer" onClick={() => setSelectedModel(null)} />
          </span>
        </motion.div>
      )}

      <div className="w-full max-w-2xl mb-4" key={`input-${activeNav}`}>
        <motion.div
          className="relative rounded-xl flex flex-col"
          animate={{
            boxShadow: isTyping
              ? `0 0 20px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4), 0 0 40px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.15)`
              : `0 0 15px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2), 0 0 30px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)`,
          }}
          transition={{ duration: 1.5, repeat: isTyping ? 0 : Infinity, repeatType: "reverse" as const }}
          style={{
            border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.35)`,
            background: "var(--nazai-card-bg)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={activeTool ? `Mission for ${activeTool.tool.name}...` : "Describe your mission..."}
            rows={1}
            className="w-full bg-transparent border-none outline-none resize-none font-mono text-xs p-3 min-h-[80px]"
            style={{ color: "var(--nazai-text-color)" }}
          />
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/10">
            <div className="flex gap-1 relative z-[60]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPlusMenuOpen((v) => !v);
                  setDrawerOpen(false);
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` }}
              >
                <Plus size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerOpen((v) => !v);
                  setPlusMenuOpen(false);
                }}
                className="text-[9px] px-2 py-1 rounded"
                style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)` }}
              >
                {activeTool ? activeTool.tool.name : "Select Engine"}
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isProcessing}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: input.trim() ? currentTheme.color : "rgba(255,255,255,0.1)" }}
            >
              <Send size={11} style={{ color: input.trim() ? "#020617" : "white" }} />
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  // Folder View
  const FolderView = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col w-full max-w-4xl flex-1 overflow-y-auto pt-4 pb-8 px-4"
    >
      <div className="text-center mb-5">
        <h1
          className="text-3xl font-black uppercase tracking-tighter"
          style={{
            background: currentTheme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {activeNav}
        </h1>
        <p className="text-[8px] tracking-[0.3em] font-mono text-white/30 mt-2">
          SYSTEM_NODE // {activeNav.toUpperCase()}_TERMINAL
        </p>
      </div>
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-2">
        {missionsLoading ? (
          <div className="flex justify-center py-12">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)` }}
            />
          </div>
        ) : filteredMissions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[11px] font-mono text-white/30">No missions found in {activeNav.toLowerCase()}</p>
          </div>
        ) : (
          filteredMissions.map(renderMissionItem)
        )}
      </motion.div>
    </motion.div>
  );

  // ─── Main Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ background: "var(--nazai-bg-base)", color: "var(--nazai-text-color)" }}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" />

      {/* Sidebar */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 0 : 56 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col items-center shrink-0 overflow-hidden z-20"
        style={{ borderRight: `1px solid var(--nazai-border-light)`, background: "var(--nazai-bg-base)" }}
      >
        <div className="flex flex-col items-center w-14 py-4 h-full">
          <div className="mb-6">
            <Zap size={18} style={{ color: borderColor }} />
          </div>
          <nav className="flex flex-col gap-1 flex-1">{NAV_ITEMS.map(renderNavItem)}</nav>
          <div className="flex flex-col items-center gap-2 mt-auto">
            {userEmail && (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold"
                style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.15)`, color: borderColor }}
              >
                {userEmail[0].toUpperCase()}
              </div>
            )}
            <button
              onClick={() => setLogoutModalOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10"
            >
              <LogOut size={14} className="text-white/30 hover:text-red-400" />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex flex-col flex-1 min-w-0 relative">
        <header
          className="flex items-center justify-between px-4 py-2 shrink-0"
          style={{
            borderBottom: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.6)" : "rgba(2,6,23,0.8)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <div className="flex items-center gap-2">
            <button onClick={() => setSidebarCollapsed((v) => !v)} className="text-white/40">
              {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <span
              className="text-[10px] font-mono font-black tracking-tighter"
              style={{
                color: borderColor,
                textShadow: `0 0 ${auraProfile.textGlowIntensity * 6}px ${auraProfile.glowPrimary}`,
              }}
            >
              NAZAI://
            </span>
            <span
              className="text-[10px] font-mono font-bold"
              style={{
                background: currentTheme.gradient,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {activeNav.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: borderColor }} />
            <span className="text-[8px] font-mono tracking-wider text-white/30">SYNCHRONIZED</span>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-3">
          <AnimatePresence mode="wait">
            {activeNav === "Settings" ? (
              <SettingsView key="settings" />
            ) : activeNav === "Home" ? (
              <HomeView key="home" />
            ) : (
              <FolderView key={`folder-${activeNav}`} />
            )}
          </AnimatePresence>
        </div>

        <footer
          className="flex items-center justify-between px-4 py-1.5 shrink-0 text-[8px] font-mono tracking-wider text-white/30"
          style={{
            borderTop: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.6)" : "rgba(2,6,23,0.8)",
          }}
        >
          <span>SECURE_NODE</span>
          <div className="flex gap-3">
            <span>DB:ON</span>
            <span>AI:READY</span>
          </div>
        </footer>
      </main>

      {/* Plus Menu Modal */}
      <AnimatePresence>
        {plusMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPlusMenuOpen(false)}
              className="fixed inset-0 z-[55] bg-black/40"
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={springTransition}
              className="fixed z-[60] bottom-28 left-1/2 -translate-x-1/2 w-[90vw] max-w-xs rounded-xl overflow-hidden p-3 space-y-2"
              style={{
                background: "var(--nazai-card-bg)",
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`,
                backdropFilter: `blur(${auraProfile.glassBlur}px)`,
              }}
            >
              <div className="text-[8px] font-mono text-white/40 mb-1">SKILLS</div>
              {SKILLS.map((skill) => (
                <button
                  key={skill.label}
                  onClick={() => handleSkillClick(skill.label)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/5 transition-colors"
                >
                  <skill.icon size={12} style={{ color: auraProfile.glowPrimary }} />
                  <div>
                    <div className="text-[10px] font-medium" style={{ color: "var(--nazai-text-color)" }}>{skill.label}</div>
                    <div className="text-[8px] text-white/30">{skill.description}</div>
                  </div>
                </button>
              ))}
              <div className="text-[8px] font-mono text-white/40 mt-2 mb-1">ACTIONS</div>
              <button
                onClick={handleFileUpload}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/5 transition-colors"
              >
                <Paperclip size={12} style={{ color: auraProfile.glowPrimary }} />
                <div className="text-[10px] font-medium" style={{ color: "var(--nazai-text-color)" }}>Attach File</div>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* AI Drawer Modal */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-30 bg-black/40"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={springTransition}
              className="fixed z-40 bottom-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md rounded-xl overflow-hidden"
              style={{
                background: "var(--nazai-card-bg)",
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`,
                backdropFilter: `blur(${auraProfile.glassBlur}px)`,
              }}
            >
              <div className="px-4 py-2 border-b border-white/10">
                <span className="text-[10px] font-mono text-white/40">SELECT AI ENGINE</span>
              </div>
              <div className="p-3 space-y-3">
                {Object.entries(AI_CATEGORIES).map(([catKey, cat]) => (
                  <div key={catKey}>
                    <div className="text-[8px] font-mono mb-1" style={{ color: cat.color }}>
                      {cat.label}
                    </div>
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cat.tools.length}, 1fr)` }}>
                      {cat.tools.map((tool) => (
                        <button
                          key={tool.id}
                          onClick={() => handleSelectTool(tool.id)}
                          className="p-2 rounded-lg text-left transition-all"
                          style={{
                            background:
                              selectedModel === tool.id ? `rgba(${cat.glowRgba},0.15)` : "rgba(255,255,255,0.03)",
                            border: `1px solid ${selectedModel === tool.id ? cat.color : "rgba(255,255,255,0.1)"}`,
                          }}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            <tool.icon
                              size={10}
                              style={{ color: selectedModel === tool.id ? cat.color : "white/40" }}
                            />
                            <span className="text-[9px] font-semibold">{tool.name}</span>
                          </div>
                          <div className="text-[8px] text-white/30">{tool.subtitle}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Logout Modal */}
      <AnimatePresence>
        {logoutModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-sm w-full rounded-xl p-6 text-center"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <LogOut size={32} className="mx-auto mb-3 text-red-500" />
              <h3 className="text-sm font-bold mb-1">System Termination</h3>
              <p className="text-xs text-white/50 mb-4">Are you sure you want to log out?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setLogoutModalOpen(false)}
                  className="flex-1 py-2 rounded-lg text-xs bg-white/5 border border-white/10"
                >
                  Stay
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex-1 py-2 rounded-lg text-xs bg-red-500/20 border border-red-500/40 text-red-400"
                >
                  Terminate
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        :root {
          --glow-primary: #22c55e;
          --glow-primary-rgb: 34,197,94;
          --glow-secondary: #a855f7;
          --glow-secondary-rgb: 168,85,247;
          --text-glow-intensity: 0.5;
          --glass-blur: 25px;
          --nazai-text-color: #e2e8f0;
          --nazai-bg-base: #020617;
          --nazai-border-light: rgba(255,255,255,0.06);
          --nazai-card-bg: rgba(255,255,255,0.03);
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .animate-pulse { animation: pulse 2s ease-in-out infinite; }
        textarea::placeholder { color: rgba(255,255,255,0.2); }
        input[type="range"] { -webkit-appearance: none; background: transparent; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--glow-primary); cursor: pointer; box-shadow: 0 0 8px var(--glow-primary); border: 2px solid rgba(255,255,255,0.5); }
        input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        input[type="color"]::-webkit-color-swatch { border: none; border-radius: 8px; }
      `}</style>
    </div>
  );
}
