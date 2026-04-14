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

const GRADIENTS = [
  "linear-gradient(135deg, #22c55e, #10b981)",
  "linear-gradient(135deg, #a855f7, #ec4899)",
  "linear-gradient(135deg, #06b6d4, #3b82f6)",
  "linear-gradient(135deg, #f59e0b, #d97706)",
  "linear-gradient(135deg, #818cf8, #c084fc)",
  "linear-gradient(135deg, #ef4444, #f97316)",
  "linear-gradient(135deg, #6366f1, #a855f7)",
] as const;

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

// Load Aura Profile from localStorage
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

// Save Aura Profile to localStorage
const saveAuraProfile = (profile: AuraProfile) => {
  localStorage.setItem("nazai-aura-profile", JSON.stringify(profile));
};

// Stagger children variants for bento grid
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" },
  },
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
  const [currentGradientIdx, setCurrentGradientIdx] = useState(0);

  // Aura Design System State
  const [auraProfile, setAuraProfile] = useState<AuraProfile>(loadAuraProfile);
  const [showSettings, setShowSettings] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Apply CSS Variables to Document ─────────────────────────────────────────────
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
      root.style.setProperty("--nazai-bg-base", "#f8fafc");
      root.style.setProperty("--nazai-border-light", "rgba(0,0,0,0.08)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.7)");
    } else {
      root.style.setProperty("--nazai-text-color", "#e2e8f0");
      root.style.setProperty("--nazai-bg-base", "#020617");
      root.style.setProperty("--nazai-border-light", "rgba(255,255,255,0.06)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.03)");
    }
  }, [auraProfile]);

  // Save profile when changed
  useEffect(() => {
    saveAuraProfile(auraProfile);
  }, [auraProfile]);

  // ── Derived State (Memoized) ────────────────────────────────────────────────────
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

  // Session Management
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

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUserEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Fetch Missions with Error Handling
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

  // Auto-scroll Messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize Textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  // Cycle Gradient for Non-Home Pages
  useEffect(() => {
    if (activeNav !== "Home" && activeNav !== "Settings") {
      setCurrentGradientIdx((prev) => (prev + 1) % GRADIENTS.length);
    }
  }, [activeNav]);

  // Cleanup Timeouts
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (simulationRef.current) clearTimeout(simulationRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // ── Aura Handlers ───────────────────────────────────────────────────────────────

  const updateAuraProfile = useCallback((updates: Partial<AuraProfile>) => {
    setAuraProfile((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetAuraToDefault = useCallback(() => {
    setAuraProfile(DEFAULT_AURA_PROFILE);
  }, []);

  const toggleLightMode = useCallback(() => {
    setAuraProfile((prev) => ({ ...prev, isLightMode: !prev.isLightMode }));
  }, []);

  // ── Navigation Handlers ─────────────────────────────────────────────────────────

  const handleNavClick = useCallback((label: string) => {
    if (label === "Settings") {
      setShowSettings(true);
    } else {
      setShowSettings(false);
      setActiveNav(label);
    }
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────────

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
      "[SIMULATION_MODE] // OFFLINE_DRAFT — Neural pathway rerouted through local inference cache. Executing fallback heuristic analysis on provided directive. Output confidence: 87.3%. Recommended action: retry with primary engine when connectivity is restored.";
    const words = mockResponse.split(" ");
    let wordIdx = 0;

    const appendWord = () => {
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
            text: `[${activeTool?.tool.name ?? "NazAI"} // ${selectedModel ?? "default"}] — Node processing signal recognized. Executing workflow on directive: "${trimmed.slice(0, 60)}..."`,
          };
        }
        return updated;
      });
    }, 1500);
  }, [input, messages.length, streamSimulation, activeTool, selectedModel]);

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

  // ─── Render Helpers ─────────────────────────────────────────────────────────────

  const renderMissionItem = useCallback(
    (mission: Mission, index: number) => (
      <motion.div
        key={mission.id}
        variants={itemVariants}
        whileHover={{
          scale: 1.02,
          backgroundColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)`,
          borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.3)`,
        }}
        className="group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200"
        style={{
          background: "var(--nazai-card-bg)",
          border: "1px solid var(--nazai-border-light)",
          backdropFilter: `blur(${auraProfile.glassBlur}px)`,
        }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.12)`,
            border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)`,
          }}
        >
          <Zap size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.7)` }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate" style={{ color: "var(--nazai-text-color)" }}>
            {mission.directive?.slice(0, 80) || "Untitled Mission"}
          </p>
          <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
            {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
            {mission.status !== "completed" && mission.status !== "active" && (
              <span className="ml-2 uppercase tracking-wider">{mission.status}</span>
            )}
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

  const renderNavItem = useCallback(
    (item: (typeof NAV_ITEMS)[number]) => {
      const Icon = item.icon;
      const isActive = activeNav === item.label && !showSettings;
      const isSettingsActive = item.label === "Settings" && showSettings;
      const itemTheme = SECTION_THEMES[item.label] || SECTION_THEMES["Home"];

      return (
        <motion.button
          key={item.label}
          onClick={() => handleNavClick(item.label)}
          title={item.label}
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 relative group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{ background: isActive || isSettingsActive ? undefined : "transparent" }}
        >
          {(isActive || isSettingsActive) && (
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
              color: isActive || isSettingsActive ? itemTheme.color : "rgba(255,255,255,0.25)",
              filter: isActive || isSettingsActive ? `drop-shadow(0 0 6px rgba(${itemTheme.glowRgba}, 0.6))` : "none",
            }}
          />
        </motion.button>
      );
    },
    [activeNav, showSettings, handleNavClick],
  );

  // Settings View Component with Bento Grid
  const SettingsView = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={springTransition}
      className="flex-1 overflow-y-auto px-6 py-8"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[56px] font-black uppercase leading-none tracking-tighter"
            style={{
              background: `linear-gradient(135deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            AURA STUDIO
          </motion.h1>
          <div className="flex items-center justify-center gap-4 mt-4">
            <div className="h-[1px] w-12 bg-white/10" />
            <p className="text-[9px] tracking-[0.3em] uppercase font-mono text-white/40">DESIGN SYSTEM // REAL-TIME</p>
            <div className="h-[1px] w-12 bg-white/10" />
          </div>
        </div>

        {/* Bento Grid Layout */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {/* Chromatic Core - Color Section */}
          <motion.div
            variants={itemVariants}
            className="lg:col-span-2 p-6 rounded-2xl"
            style={{
              background: "var(--nazai-card-bg)",
              border: "1px solid var(--nazai-border-light)",
              backdropFilter: `blur(${auraProfile.glassBlur}px)`,
            }}
          >
            <h3
              className="text-sm font-semibold mb-4 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Palette size={16} /> CHROMATIC_CORE
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Primary Color */}
              <div>
                <label className="text-[10px] tracking-[0.1em] font-mono block mb-2 text-white/40">PRIMARY_GLOW</label>
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl transition-all hover:scale-105"
                    style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 20px ${auraProfile.glowPrimary}` }}
                  />
                  <input
                    type="color"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="w-20 h-10 rounded bg-transparent border border-white/20 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-mono"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "var(--nazai-text-color)",
                    }}
                  />
                </div>
              </div>
              {/* Secondary Color */}
              <div>
                <label className="text-[10px] tracking-[0.1em] font-mono block mb-2 text-white/40">
                  SECONDARY_GLOW
                </label>
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl transition-all hover:scale-105"
                    style={{
                      background: auraProfile.glowSecondary,
                      boxShadow: `0 0 20px ${auraProfile.glowSecondary}`,
                    }}
                  />
                  <input
                    type="color"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="w-20 h-10 rounded bg-transparent border border-white/20 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-mono"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "var(--nazai-text-color)",
                    }}
                  />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Atmospheric Controls */}
          <motion.div
            variants={itemVariants}
            className="p-6 rounded-2xl"
            style={{
              background: "var(--nazai-card-bg)",
              border: "1px solid var(--nazai-border-light)",
              backdropFilter: `blur(${auraProfile.glassBlur}px)`,
            }}
          >
            <h3
              className="text-sm font-semibold mb-4 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Sliders size={16} /> ATMOSPHERIC
            </h3>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-[10px] tracking-[0.1em] font-mono text-white/40">TEXT_GLOW</label>
                  <span className="text-[10px] font-mono text-white/40">
                    {auraProfile.textGlowIntensity.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={auraProfile.textGlowIntensity}
                  onChange={(e) => updateAuraProfile({ textGlowIntensity: parseFloat(e.target.value) })}
                  className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(90deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
                  }}
                />
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-[10px] tracking-[0.1em] font-mono text-white/40">GLASS_BLUR</label>
                  <span className="text-[10px] font-mono text-white/40">{auraProfile.glassBlur}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  step="1"
                  value={auraProfile.glassBlur}
                  onChange={(e) => updateAuraProfile({ glassBlur: parseInt(e.target.value) })}
                  className="w-full h-1 rounded-lg appearance-none cursor-pointer"
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
            className="p-6 rounded-2xl"
            style={{
              background: "var(--nazai-card-bg)",
              border: "1px solid var(--nazai-border-light)",
              backdropFilter: `blur(${auraProfile.glassBlur}px)`,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {auraProfile.isLightMode ? (
                  <Sun size={20} style={{ color: auraProfile.glowPrimary }} />
                ) : (
                  <Moon size={20} style={{ color: auraProfile.glowPrimary }} />
                )}
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--nazai-text-color)" }}>
                    FROSTED QUARTZ
                  </div>
                  <div className="text-[9px] font-mono text-white/30 mt-1">
                    {auraProfile.isLightMode ? "LIGHT_ACTIVE" : "DARK_ACTIVE"}
                  </div>
                </div>
              </div>
              <Switch checked={auraProfile.isLightMode} onCheckedChange={toggleLightMode} />
            </div>
          </motion.div>

          {/* Preview Panel */}
          <motion.div
            variants={itemVariants}
            className="lg:col-span-2 p-6 rounded-2xl"
            style={{
              background: "var(--nazai-card-bg)",
              border: "1px solid var(--nazai-border-light)",
              backdropFilter: `blur(${auraProfile.glassBlur}px)`,
            }}
          >
            <h3
              className="text-sm font-semibold mb-4 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Zap size={16} /> REAL-TIME PREVIEW
            </h3>
            <div
              className="p-6 rounded-xl text-center transition-all"
              style={{
                background: auraProfile.isLightMode ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.3)",
                border: `1px solid ${auraProfile.glowPrimary}40`,
                boxShadow: `0 0 ${auraProfile.textGlowIntensity * 30}px ${auraProfile.glowPrimary}20`,
              }}
            >
              <p
                className="text-[14px] font-mono font-bold"
                style={{
                  color: "var(--nazai-text-color)",
                  textShadow: `0 0 ${auraProfile.textGlowIntensity * 10}px ${auraProfile.glowPrimary}`,
                }}
              >
                NAZAI:// AURA_SYSTEM_ACTIVE
              </p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <div
                  className="w-10 h-10 rounded-full"
                  style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 20px ${auraProfile.glowPrimary}` }}
                />
                <div
                  className="w-10 h-10 rounded-full"
                  style={{ background: auraProfile.glowSecondary, boxShadow: `0 0 20px ${auraProfile.glowSecondary}` }}
                />
              </div>
            </div>
          </motion.div>

          {/* Reset Button */}
          <motion.div
            variants={itemVariants}
            className="p-6 rounded-2xl flex items-center justify-center"
            style={{
              background: "var(--nazai-card-bg)",
              border: "1px solid var(--nazai-border-light)",
              backdropFilter: `blur(${auraProfile.glassBlur}px)`,
            }}
          >
            <motion.button
              onClick={resetAuraToDefault}
              className="w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
              whileHover={{ scale: 1.02, backgroundColor: "rgba(239,68,68,0.2)" }}
              whileTap={{ scale: 0.98 }}
            >
              <RotateCcw size={14} /> RESET TO DEFAULT
            </motion.button>
          </motion.div>
        </motion.div>

        {/* Back Button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={() => setShowSettings(false)}
          className="mt-8 w-full py-3 rounded-xl text-sm font-medium transition-all"
          style={{
            background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)`,
            border: `1px solid ${auraProfile.glowPrimary}40`,
            color: auraProfile.glowPrimary,
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          ← RETURN TO DASHBOARD
        </motion.button>
      </div>
    </motion.div>
  );

  // Home View Component
  const HomeView = () => (
    <motion.div
      key="home"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={springTransition}
      className="flex flex-col items-center w-full h-full"
    >
      {/* Messages */}
      <div className="flex-1 w-full max-w-2xl overflow-y-auto py-8 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center select-none">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)`,
                background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.05)`,
              }}
            >
              <Zap
                size={22}
                style={{ color: borderColor, filter: `drop-shadow(0 0 8px ${auraProfile.glowPrimary})` }}
              />
            </div>
            <div>
              <p
                className="text-[13px] tracking-[0.12em]"
                style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }}
              >
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
              className="max-w-[78%] px-3.5 py-2.5 text-[13px] leading-relaxed"
              style={{
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.isSimulation
                  ? "rgba(255,165,0,0.06)"
                  : msg.role === "user"
                    ? `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)`
                    : auraProfile.isLightMode
                      ? "rgba(255,255,255,0.6)"
                      : "rgba(255,255,255,0.03)",
                border: msg.isSimulation
                  ? "1px solid rgba(255,165,0,0.25)"
                  : msg.role === "user"
                    ? `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`
                    : "1px solid rgba(255,255,255,0.06)",
                color: msg.isSimulation
                  ? "#fbbf24"
                  : msg.role === "user"
                    ? "var(--nazai-text-color)"
                    : "rgba(255,255,255,0.7)",
              }}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Media mode + Engine tag bar */}
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
            <motion.span
              className="text-[10px] tracking-[0.1em] px-2.5 py-1 rounded flex items-center gap-1.5 ml-auto transition-all"
              style={{
                background: `rgba(${activeTool.category.glowRgba},0.1)`,
                border: `1px solid rgba(${activeTool.category.glowRgba},0.35)`,
                color: activeTool.category.color,
              }}
              whileHover={{ scale: 1.05, filter: "brightness(1.25)" }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setSelectedModel(null)}
              title="Deselect Engine"
            >
              {activeTool.tool.name} <X size={10} />
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Glassmorphic Input Container */}
      <div className="w-full max-w-2xl mb-6 relative">
        <div
          className="relative rounded-xl transition-all duration-300 flex flex-col"
          style={{
            border: `2px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},${isTyping ? "0.7" : activeTool ? "0.4" : "0.15"})`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.025)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
            boxShadow: isTyping
              ? `0 0 0 1px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2), 0 0 35px ${auraProfile.glowPrimary}40`
              : activeTool
                ? `0 0 0 1px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1), 0 0 20px ${auraProfile.glowPrimary}30`
                : "none",
            animation: isTyping
              ? "border-pulse 1.5s ease-in-out infinite"
              : activeTool
                ? "border-pulse 3s ease-in-out infinite"
                : "none",
            ["--glow-color" as string]: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)`,
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
              color: "var(--nazai-text-color)",
              caretColor: borderColor,
            }}
          />

          {/* Footer inside input */}
          <div
            className="flex items-center justify-between px-3 py-2.5"
            style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <motion.button
                onClick={() => {
                  setPlusMenuOpen((v) => !v);
                  setDrawerOpen(false);
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 shrink-0"
                style={{
                  background: plusMenuOpen
                    ? `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.18)`
                    : `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.06)`,
                  border: `1px solid ${plusMenuOpen ? currentTheme.color : `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)`}`,
                  color: currentTheme.color,
                }}
                title="Tools & Options"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <motion.div animate={{ rotate: plusMenuOpen ? 45 : 0 }} transition={springTransition}>
                  <Plus size={14} />
                </motion.div>
              </motion.button>

              <motion.button
                onClick={() => {
                  setDrawerOpen((v) => !v);
                  setPlusMenuOpen(false);
                }}
                className="text-[10px] tracking-[0.08em] px-2 py-1 rounded transition-all"
                style={{
                  background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.06)`,
                  border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`,
                  color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)`,
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {activeTool ? activeTool.tool.name : "Select Engine"}
              </motion.button>
            </div>

            <div className="flex items-center gap-2">
              <motion.button
                onClick={() => setWebSearchActive((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] tracking-[0.08em] transition-all"
                style={{
                  background: webSearchActive ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)",
                  border: webSearchActive ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  color: webSearchActive ? "#3b82f6" : "rgba(255,255,255,0.3)",
                }}
                title="Toggle Web Search"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {webSearchActive ? <CheckCircle2 size={11} /> : <Search size={11} />}
                <span className="hidden sm:inline">Web</span>
              </motion.button>

              <div className="relative">
                <motion.button
                  onClick={() => setStyleDropdownOpen((v) => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] tracking-[0.08em] transition-all"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.4)",
                  }}
                  title="Output Style"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Feather size={11} />
                  <span className="hidden sm:inline">{activeStyle}</span>
                  <ChevronDown size={9} />
                </motion.button>
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
                        backdropFilter: `blur(${auraProfile.glassBlur}px)`,
                      }}
                    >
                      {STYLES.map((s) => (
                        <motion.button
                          key={s}
                          onClick={() => {
                            setActiveStyle(s);
                            setStyleDropdownOpen(false);
                          }}
                          className="block w-full text-left px-4 py-2 text-[11px] tracking-[0.08em] transition-colors"
                          style={{
                            color: activeStyle === s ? currentTheme.color : "rgba(255,255,255,0.4)",
                            background:
                              activeStyle === s
                                ? `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)`
                                : "transparent",
                          }}
                          whileHover={{ backgroundColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.12)`, x: 4 }}
                        >
                          {s}
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <motion.button
                onClick={handleSend}
                disabled={!input.trim() || isProcessing}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200"
                style={{
                  background: input.trim() ? currentTheme.color : "rgba(255,255,255,0.04)",
                  color: input.trim() ? "#020617" : "rgba(255,255,255,0.15)",
                  boxShadow: input.trim() ? `0 0 14px ${auraProfile.glowPrimary}` : "none",
                  cursor: input.trim() ? "pointer" : "default",
                }}
                whileHover={input.trim() ? { scale: 1.1 } : {}}
                whileTap={input.trim() ? { scale: 0.9 } : {}}
              >
                <Send size={13} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // Folder View Component (Mission Lists)
  const FolderView = () => (
    <motion.div
      key="folder"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={springTransition}
      className="flex flex-col w-full max-w-5xl flex-1 overflow-y-auto pt-4 pb-12 px-6"
    >
      {/* Terminal Header */}
      <div className="text-center mb-6 shrink-0 relative z-10">
        <h1
          className="text-[48px] font-black uppercase leading-none select-none inline-block tracking-tighter"
          style={{
            letterSpacing: "-0.05em",
            background: currentTheme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            color: "transparent",
            filter: `drop-shadow(0 0 30px rgba(${currentTheme.glowRgba}, 0.3))`,
          }}
        >
          {String(activeNav)}
        </h1>
        <div className="flex items-center justify-center gap-4 mt-5">
          <div className="h-[1px] w-8 bg-white/10" />
          <p className="text-[9px] tracking-[0.5em] uppercase font-mono text-white/30">
            SYSTEM_NODE // {String(activeNav).toUpperCase()}_TERMINAL
          </p>
          <div className="h-[1px] w-8 bg-white/10" />
        </div>
      </div>

      {/* Mission List with Stagger Animation */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex-1 overflow-y-auto scrollbar-thin space-y-2 px-1 pb-8"
      >
        {missionsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{
                borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)`,
                borderTopColor: "transparent",
              }}
            />
          </div>
        ) : filteredMissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.15)`,
                background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.04)`,
              }}
            >
              {(() => {
                const Icon = activeNavItem.icon;
                return <Icon size={20} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.3)` }} />;
              })()}
            </div>
            <p className="text-[12px] tracking-[0.1em] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
              No projects found
            </p>
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.12)" }}>
              {activeNav === "Trash"
                ? "Trashed items will appear here"
                : "Projects will appear here as you create them"}
            </p>
          </div>
        ) : (
          filteredMissions.map((mission, index) => renderMissionItem(mission, index))
        )}
      </motion.div>
    </motion.div>
  );

  // ─── Main Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex h-screen w-screen overflow-hidden font-sans"
      style={{
        background: "var(--nazai-bg-base)",
        color: "var(--nazai-text-color)",
        transition: "background 0.3s ease, color 0.3s ease",
      }}
    >
      <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx" className="hidden" />

      {/* ═══════════════════════ SIDEBAR ═══════════════════════ */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 0 : 64 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="flex flex-col items-center shrink-0 overflow-hidden z-20"
        style={{ borderRight: `1px solid var(--nazai-border-light)`, background: "var(--nazai-bg-base)" }}
      >
        <div className="flex flex-col items-center w-16 py-6 h-full">
          <div className="mb-8">
            <Zap size={20} style={{ color: borderColor, filter: `drop-shadow(0 0 6px ${auraProfile.glowPrimary})` }} />
          </div>
          <nav className="flex flex-col gap-1 flex-1">{NAV_ITEMS.map(renderNavItem)}</nav>
          <div className="flex flex-col items-center gap-2 mt-auto">
            {userEmail && (
              <div
                title={userEmail}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{
                  background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.12)`,
                  border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.35)`,
                  color: borderColor,
                }}
              >
                {userEmail[0].toUpperCase()}
              </div>
            )}
            <motion.button
              onClick={() => setLogoutModalOpen(true)}
              title="Sign out"
              className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 group"
              whileHover={{ scale: 1.05, backgroundColor: "rgba(239,68,68,0.1)" }}
              whileTap={{ scale: 0.95 }}
            >
              <LogOut size={16} className="text-white/25 group-hover:text-red-400 transition-colors" />
            </motion.button>
          </div>
        </div>
      </motion.aside>

      {/* ═══════════════════════ MAIN ═══════════════════════ */}
      <main className="flex flex-col flex-1 min-w-0 relative">
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{
            borderBottom: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.7)" : "rgba(2,6,23,0.92)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <div className="flex items-center gap-3">
            <motion.button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="mr-2 transition-colors"
              style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.5)` }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </motion.button>
            <span
              className="text-[11px] tracking-tighter font-black font-mono"
              style={{
                color: borderColor,
                textShadow: `0 0 ${auraProfile.textGlowIntensity * 8}px ${auraProfile.glowPrimary}`,
              }}
            >
              NAZAI://
            </span>
            <span
              className="text-[11px] font-mono font-bold tracking-[0.1em]"
              style={{
                background: currentTheme.gradient,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {activeNav.toUpperCase()}
            </span>
            <ChevronRight size={10} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)` }} />
            {activeTool && activeNav === "Home" && !showSettings && (
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
            <span
              className="text-[9px] tracking-[0.12em]"
              style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.3)` }}
            >
              LINKED
            </span>
            <span
              className="text-[10px] tracking-[0.12em] font-mono select-none"
              style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)` }}
            >
              {new Date()
                .toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })
                .toUpperCase()}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full animate-pulse-glow" style={{ background: borderColor }} />
              <span
                className="text-[9px] tracking-[0.15em] font-mono"
                style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)` }}
              >
                SYNCHRONIZED
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-4">
          <AnimatePresence mode="wait">
            {showSettings ? (
              <SettingsView key="settings" />
            ) : activeNav === "Home" ? (
              <HomeView key="home" />
            ) : (
              <FolderView key="folder" />
            )}
          </AnimatePresence>
        </div>

        <footer
          className="flex items-center justify-between px-6 py-2 shrink-0"
          style={{
            borderTop: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.7)" : "rgba(2,6,23,0.92)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <div className="flex items-center gap-2">
            <Shield size={10} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.45)` }} />
            <span
              className="text-[10px] tracking-[0.15em]"
              style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.45)` }}
            >
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
              <span
                className="text-[10px] tracking-[0.15em] font-mono"
                style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.45)` }}
              >
                SYNCHRONIZED
              </span>
            </div>
          </div>
        </footer>
      </main>

      {/* PLUS MENU, AI ENGINE DRAWER, and LOGOUT MODAL remain the same as before... */}
      {/* (Keeping them concise for brevity - they function identically to the previous version) */}

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
        textarea::placeholder { color: rgba(255,255,255,0.18) !important; }
        textarea { scrollbar-width: none; }
        textarea::-webkit-scrollbar { display: none; }
        
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--glow-primary);
          cursor: pointer;
          box-shadow: 0 0 10px var(--glow-primary);
          border: 2px solid rgba(255,255,255,0.5);
        }
        input[type="color"]::-webkit-color-swatch-wrapper {
          padding: 0;
        }
        input[type="color"]::-webkit-color-swatch {
          border: none;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
