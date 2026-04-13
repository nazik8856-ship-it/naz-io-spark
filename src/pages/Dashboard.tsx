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
  { icon: Lightbulb, label: "Explain Concept" },
  { icon: Bug, label: "Debug Build" },
  { icon: HeartPulse, label: "Project Health" },
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
  glassBlur: 16,
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

const hexToRgba = (hex: string, alpha: number = 1): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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
  const [activeNav, setActiveNav] = useState<string>("Recently");
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
  const [activeColorPicker, setActiveColorPicker] = useState<"primary" | "secondary" | null>(null);

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
    root.style.setProperty("--bg-intensity", auraProfile.isLightMode ? "0.95" : "0.03");

    if (auraProfile.isLightMode) {
      root.style.setProperty("--nazai-text-color", "#0f172a");
      root.style.setProperty("--nazai-bg-base", "#f8fafc");
      root.style.setProperty("--nazai-border-light", "rgba(0,0,0,0.08)");
    } else {
      root.style.setProperty("--nazai-text-color", "#e2e8f0");
      root.style.setProperty("--nazai-bg-base", "#020617");
      root.style.setProperty("--nazai-border-light", "rgba(255,255,255,0.06)");
    }
  }, [auraProfile]);

  // Save profile when changed
  useEffect(() => {
    saveAuraProfile(auraProfile);
  }, [auraProfile]);

  // ── Derived State (Memoized) ────────────────────────────────────────────────────
  const activeTool = useMemo(() => findToolById(selectedModel), [selectedModel]);
  const isMediaMode = activeTool?.category.label === "CREATION";
  const glowRgba = activeTool?.category.glowRgba ?? getRgbFromHex(auraProfile.glowPrimary);
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
    if (activeNav !== "Home") {
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
    (mission: Mission, index: number) => {
      const theme = SECTION_THEMES[activeNav] || SECTION_THEMES["Home"];

      return (
        <motion.div
          key={mission.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03, duration: 0.2 }}
          whileHover={{
            backgroundColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.06)`,
            borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)`,
            boxShadow: `0 0 20px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)`,
          }}
          className="group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200"
          style={{
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.02)",
            border: `1px solid var(--nazai-border-light)`,
          }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)`,
              border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`,
            }}
          >
            <Zap size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ color: "var(--nazai-text-color)" }}>
              {mission.directive?.slice(0, 80) || "Untitled Mission"}
            </p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
              {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
              {mission.status !== "completed" && mission.status !== "active" && (
                <span className="ml-2 uppercase tracking-wider">{mission.status}</span>
              )}
            </p>
          </div>

          <ChevronRight
            size={14}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.5)` }}
          />
        </motion.div>
      );
    },
    [activeNav, auraProfile.glowPrimary, auraProfile.isLightMode],
  );

  const renderNavItem = useCallback(
    (item: (typeof NAV_ITEMS)[number]) => {
      const Icon = item.icon;
      const isActive = activeNav === item.label;
      const itemTheme = SECTION_THEMES[item.label] || SECTION_THEMES["Home"];

      return (
        <motion.button
          key={item.label}
          onClick={() => {
            if (item.label === "Settings") {
              setShowSettings(true);
            } else {
              setActiveNav(item.label);
            }
          }}
          title={item.label}
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 relative group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{ background: isActive ? undefined : "transparent" }}
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
    [activeNav],
  );

  // Settings View Component
  const SettingsView = () => (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      transition={springTransition}
      className="flex-1 overflow-y-auto px-6 py-8"
    >
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-[48px] font-black uppercase leading-none"
            style={{
              background: `linear-gradient(135deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            AURA STUDIO
          </h1>
          <div className="flex items-center justify-center gap-4 mt-4">
            <div className="h-[1px] w-12 bg-white/10" />
            <p className="text-[9px] tracking-[0.3em] uppercase font-mono text-white/40">DESIGN SYSTEM // REAL-TIME</p>
            <div className="h-[1px] w-12 bg-white/10" />
          </div>
        </div>

        {/* Color Section */}
        <div className="space-y-8">
          <div
            className="p-6 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
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
                    className="w-12 h-12 rounded-xl cursor-pointer transition-all hover:scale-105"
                    style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 20px ${auraProfile.glowPrimary}` }}
                    onClick={() => setActiveColorPicker("primary")}
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
                    className="w-12 h-12 rounded-xl cursor-pointer transition-all hover:scale-105"
                    style={{
                      background: auraProfile.glowSecondary,
                      boxShadow: `0 0 20px ${auraProfile.glowSecondary}`,
                    }}
                    onClick={() => setActiveColorPicker("secondary")}
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
          </div>

          {/* Sliders Section */}
          <div
            className="p-6 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <h3
              className="text-sm font-semibold mb-4 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Sliders size={16} /> ATMOSPHERIC_CONTROLS
            </h3>
            <div className="space-y-5">
              {/* Text Glow Intensity */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-[10px] tracking-[0.1em] font-mono text-white/40">TEXT_GLOW_INTENSITY</label>
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
              {/* Glass Blur */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-[10px] tracking-[0.1em] font-mono text-white/40">GLASS_THICKNESS (BLUR)</label>
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
          </div>

          {/* Mode Toggle & Reset */}
          <div
            className="p-6 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
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
                    FROSTED_QUARTZ_MODE
                  </div>
                  <div className="text-[9px] font-mono text-white/30 mt-1">
                    {auraProfile.isLightMode ? "LIGHT_ACTIVE" : "DARK_ACTIVE"}
                  </div>
                </div>
              </div>
              <Switch checked={auraProfile.isLightMode} onCheckedChange={toggleLightMode} />
            </div>
            <div className="mt-6 pt-6 border-t border-white/10">
              <motion.button
                onClick={resetAuraToDefault}
                className="w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
                whileHover={{ scale: 1.02, backgroundColor: "rgba(239,68,68,0.2)" }}
                whileTap={{ scale: 0.98 }}
              >
                <RotateCcw size={14} /> RESET_TO_DEFAULT_AURA
              </motion.button>
            </div>
          </div>

          {/* Preview Panel */}
          <div
            className="p-6 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <h3
              className="text-sm font-semibold mb-4 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Zap size={16} /> REAL-TIME_PREVIEW
            </h3>
            <div
              className="p-4 rounded-xl text-center transition-all"
              style={{
                background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${auraProfile.glowPrimary}40`,
                boxShadow: `0 0 ${auraProfile.textGlowIntensity * 30}px ${auraProfile.glowPrimary}20`,
              }}
            >
              <p
                className="text-[13px] font-mono"
                style={{
                  color: "var(--nazai-text-color)",
                  textShadow: `0 0 ${auraProfile.textGlowIntensity * 10}px ${auraProfile.glowPrimary}`,
                }}
              >
                NAZAI:// AURA_SYSTEM_ACTIVE
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <div
                  className="w-8 h-8 rounded-full"
                  style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 15px ${auraProfile.glowPrimary}` }}
                />
                <div
                  className="w-8 h-8 rounded-full"
                  style={{ background: auraProfile.glowSecondary, boxShadow: `0 0 15px ${auraProfile.glowSecondary}` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <motion.button
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
          ← RETURN_TO_DASHBOARD
        </motion.button>
      </div>
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
              className="text-[11px] tracking-[0.15em] font-mono"
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
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={springTransition}
                className="flex flex-col items-center w-full h-full"
              >
                {/* ── Messages ── */}
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

                {/* ═══════════════════════ GLASSMORPHIC INPUT CONTAINER ═══════════════════════ */}
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

                    {/* ── Footer inside input ── */}
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
                            border: webSearchActive
                              ? "1px solid rgba(59,130,246,0.4)"
                              : "1px solid rgba(255,255,255,0.06)",
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
                                    whileHover={{
                                      backgroundColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.12)`,
                                      x: 4,
                                    }}
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
            ) : (
              <motion.div
                key="folder"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={springTransition}
                className="flex flex-col w-full max-w-5xl flex-1 overflow-y-auto pt-4 pb-12 px-6"
              >
                {/* Terminal Header — Obsidian Version */}
                <div className="text-center mb-6 shrink-0 relative z-10">
                  <h1
                    className="text-[48px] font-black uppercase leading-none select-none inline-block"
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

                {/* Mission List (DB-backed) */}
                <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 px-1 pb-8">
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
                          return (
                            <Icon size={20} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.3)` }} />
                          );
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
                    filteredMissions.map(renderMissionItem)
                  )}
                </div>
              </motion.div>
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
                background: auraProfile.isLightMode ? "rgba(255,255,255,0.95)" : "rgba(2,6,23,0.97)",
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.15)`,
                borderRadius: 14,
                backdropFilter: `blur(${auraProfile.glassBlur}px)`,
                boxShadow: `0 0 60px rgba(0,0,0,0.7)`,
              }}
            >
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="text-[11px] tracking-[0.15em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  TOOLS
                </span>
              </div>
              <div className="p-3 flex flex-col gap-1">
                <motion.button
                  onClick={handleFileUpload}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors"
                  whileHover={{ backgroundColor: "rgba(255,255,255,0.04)", x: 4 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Paperclip size={15} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.5)` }} />
                  <div>
                    <div className="text-[12px]" style={{ color: "var(--nazai-text-color)" }}>
                      Add Files / Photos
                    </div>
                    <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                      Upload from your device
                    </div>
                  </div>
                </motion.button>

                <div className="mt-2 mb-1 px-3">
                  <span
                    className="text-[9px] tracking-[0.15em]"
                    style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)` }}
                  >
                    SKILLS
                  </span>
                </div>
                {SKILLS.map(({ icon: Icon, label }) => (
                  <motion.button
                    key={label}
                    onClick={() => handleSkillClick(label)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors"
                    whileHover={{ backgroundColor: "rgba(255,255,255,0.04)", x: 4 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Icon size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.45)` }} />
                    <span className="text-[12px]" style={{ color: "var(--nazai-text-color)" }}>
                      {label}
                    </span>
                  </motion.button>
                ))}

                <div className="mt-3 mb-1 px-3">
                  <span
                    className="text-[9px] tracking-[0.15em]"
                    style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)` }}
                  >
                    CONNECTORS
                  </span>
                </div>
                {[
                  { key: "supabase" as const, label: "Supabase", icon: Database, color: "#22c55e" },
                  { key: "vercel" as const, label: "Vercel", icon: Globe, color: "#ffffff" },
                  { key: "github" as const, label: "GitHub", icon: Github, color: "#ffffff" },
                ].map(({ key, label, icon: Icon, color }) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg transition-colors">
                    <div className="flex items-center gap-3">
                      <Icon size={14} style={{ color: `${color}60` }} />
                      <span className="text-[12px]" style={{ color: "var(--nazai-text-color)" }}>
                        {label}
                      </span>
                    </div>
                    <Switch
                      checked={connectorStatus[key]}
                      onCheckedChange={(checked) => handleConnectorToggle(key, checked)}
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
                background: auraProfile.isLightMode ? "rgba(255,255,255,0.95)" : "rgba(2,6,23,0.97)",
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.18)`,
                borderRadius: 14,
                backdropFilter: `blur(${auraProfile.glassBlur}px)`,
                boxShadow: `0 0 60px rgba(0,0,0,0.7), 0 0 40px rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.06)`,
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span className="text-[11px] tracking-[0.15em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  SELECT AI ENGINE
                </span>
                <motion.button
                  onClick={() => setDrawerOpen(false)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X size={14} style={{ color: "rgba(255,255,255,0.25)" }} />
                </motion.button>
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
                              border: `1px solid ${isActive ? cat.color : "rgba(255,255,255,0.1)"}`,
                              boxShadow: isActive
                                ? `0 0 14px rgba(${cat.glowRgba},0.3)`
                                : "inset 0 1px 1px 0 rgba(255,255,255,0.05)",
                            }}
                            whileHover={{ scale: 1.02, borderColor: isActive ? cat.color : "rgba(255,255,255,0.2)" }}
                            whileTap={{ scale: 0.98 }}
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
                              style={{ color: isActive ? cat.color : "var(--nazai-text-color)" }}
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
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setLogoutModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={springTransition}
              className="relative z-[101] w-full max-w-[400px] rounded-2xl p-8 text-center overflow-hidden"
              style={{
                background: auraProfile.isLightMode ? "rgba(255,255,255,0.95)" : "rgba(2, 6, 23, 0.95)",
                border: "1px solid rgba(239, 68, 68, 0.15)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(239, 68, 68, 0.05)",
              }}
            >
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
        :root {
          --glow-primary: #22c55e;
          --glow-primary-rgb: 34,197,94;
          --glow-secondary: #a855f7;
          --glow-secondary-rgb: 168,85,247;
          --text-glow-intensity: 0.5;
          --glass-blur: 16px;
          --bg-intensity: 0.03;
          --nazai-text-color: #e2e8f0;
          --nazai-bg-base: #020617;
          --nazai-border-light: rgba(255,255,255,0.06);
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
