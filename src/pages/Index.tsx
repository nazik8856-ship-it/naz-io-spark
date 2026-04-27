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
  Youtube,
  Music2,
  Mail,
  FileText,
  Menu,
  Wand2,
  ArrowRight,
  Sparkles,
  HardDrive,
  XCircle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── DEPLOYMENT VERSION ──────────────────────────────────────────────────────────
const DEPLOYMENT_ID = "NAZAI_V2_FINAL_BENTO";

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
  glowPrimary: "#06b6d4",
  glowSecondary: "#3b82f6",
  textGlowIntensity: 0.3,
  glassBlur: 16,
  isLightMode: false,
};

// Feature Cards Data
const FEATURE_CARDS = [
  {
    icon: Wand2,
    title: "Brand-Snap Canvas",
    description: "Drag & drop assets. AI Guardian auto-fixes branding.",
    color: "#06b6d4",
  },
  {
    icon: Archive,
    title: "Archives & History",
    description: "All your past missions saved and searchable.",
    color: "#3b82f6",
  },
  {
    icon: Clock,
    title: "Recent Projects",
    description: "Generations appear instantly in your Dashboard.",
    color: "#8b5cf6",
  },
  {
    icon: Settings,
    title: "Smart Settings + Trash",
    description: "Full control, recovery, and deep customization.",
    color: "#ec4899",
  },
];

// Workflow Steps
const WORKFLOW_STEPS = [
  { icon: FileText, title: "Input", description: "Describe your creative mission" },
  { icon: Brain, title: "Neural Analysis", description: "AI processes your request" },
  { icon: Sparkles, title: "Asset Generation", description: "Content is created instantly" },
  { icon: HardDrive, title: "Dashboard Vault", description: "Auto-synced to your private space" },
];

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Cache Nuke Effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    const lastVersion = localStorage.getItem("last_version");
    if (lastVersion !== DEPLOYMENT_ID) {
      localStorage.clear();
      localStorage.setItem("last_version", DEPLOYMENT_ID);
      window.location.reload();
    }
  }, []);

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
  const [showSettings, setShowSettings] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Apply CSS Variables to Document ────────────────────────────────────────────
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
      root.style.setProperty("--nazai-text-color", "#1e293b");
      root.style.setProperty("--nazai-bg-base", "#f1f5f9");
      root.style.setProperty("--nazai-border-light", "rgba(0,0,0,0.08)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.9)");
    } else {
      root.style.setProperty("--nazai-text-color", "#e2e8f0");
      root.style.setProperty("--nazai-bg-base", "#0a0a0f");
      root.style.setProperty("--nazai-border-light", "rgba(255,255,255,0.08)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.05)");
    }
  }, [auraProfile]);

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
    if (label === "Settings") {
      setShowSettings(true);
    } else {
      setShowSettings(false);
      setActiveNav(label);
    }
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
      "Processing your request through NazAI's neural network. Analysis complete. Here's what I've generated based on your mission...";
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
        >
          {(isActive || isSettingsActive) && (
            <motion.div
              layoutId="nav-active-bg"
              className="absolute inset-0 rounded-lg"
              style={{
                background: itemTheme.gradient,
                opacity: 0.12,
              }}
              transition={springTransition}
            />
          )}
          <Icon
            size={18}
            className="relative z-10 transition-colors"
            style={{
              color: isActive || isSettingsActive ? itemTheme.color : "rgba(255,255,255,0.3)",
            }}
          />
        </motion.button>
      );
    },
    [activeNav, showSettings, handleNavClick],
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
        }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` }}
        >
          <Zap size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.7)` }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--nazai-text-color)" }}>
            {mission.directive?.slice(0, 80) || "Untitled Mission"}
          </p>
          <p className="text-xs mt-0.5" style={{ opacity: 0.5, color: "var(--nazai-text-color)" }}>
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
    [auraProfile.glowPrimary],
  );

  // Landing Page Navigation Component
  const LandingNav = () => (
    <div
      className="fixed top-0 w-full z-50 backdrop-blur-md border-b"
      style={{
        background: "rgba(10, 10, 15, 0.8)",
        borderColor: "rgba(255,255,255,0.05)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Zap size={24} style={{ color: auraProfile.glowPrimary }} />
            <span className="font-bold text-lg text-white">NazAI</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#" className="text-sm text-white/70 hover:text-white transition">Home</a>
            <a href="#features" className="text-sm text-white/70 hover:text-white transition">Features</a>
            <a href="#how-it-works" className="text-sm text-white/70 hover:text-white transition">Examples</a>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/auth")}
              className="px-5 py-1.5 rounded-lg text-sm font-medium transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]"
              style={{
                background: auraProfile.glowPrimary,
                color: "#ffffff",
              }}
            >
              Go to Dashboard
            </motion.button>
          </div>

          {/* Mobile Menu Button */}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-white">
            <Menu size={24} />
          </button>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden py-4 border-t"
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <div className="flex flex-col gap-3">
                <a href="#" className="text-sm text-white/70 py-1">Home</a>
                <a href="#features" className="text-sm text-white/70 py-1">Features</a>
                <a href="#how-it-works" className="text-sm text-white/70 py-1">Examples</a>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate("/auth")}
                  className="px-4 py-2 rounded-lg text-sm font-medium mt-2"
                  style={{
                    background: auraProfile.glowPrimary,
                    color: "#ffffff",
                  }}
                >
                  Go to Dashboard
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  // Hero Section Component
  const HeroSection = () => (
    <section className="pt-32 pb-20 px-4 text-center">
      <div className="max-w-4xl mx-auto">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-5xl md:text-7xl font-bold mb-6 tracking-tight text-white"
        >
          Create with{" "}
          <span style={{ color: auraProfile.glowPrimary }}>Multi-Model AI</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-lg md:text-xl mb-4 text-white/70 max-w-2xl mx-auto"
        >
          Gemini, Claude, GPT, and creative tools — unified in one powerful workspace.
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-sm mb-8 font-medium"
          style={{ color: auraProfile.glowPrimary }}
        >
          Sign in → Access your Dashboard with Recent Projects, Archives & Trash
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <motion.button
            whileHover={{ scale: 1.02, filter: "brightness(1.2)" }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/auth")}
            className="px-8 py-3 rounded-xl text-base font-medium transition-all shadow-[0_0_25px_rgba(6,182,212,0.3)]"
            style={{
              background: auraProfile.glowPrimary,
              color: "#ffffff",
            }}
          >
            Get Started
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02, filter: "brightness(1.2)" }}
            whileTap={{ scale: 0.98 }}
            className="px-8 py-3 rounded-xl text-base font-medium border transition-all text-white/80"
            style={{
              borderColor: "rgba(255,255,255,0.2)",
            }}
          >
            View Examples
          </motion.button>
        </motion.div>
      </div>
    </section>
  );

  // Features Section
  const FeaturesSection = () => (
    <section id="features" className="py-20 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-bold text-center mb-4 text-white"
        >
          Platform Features
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-center mb-12 text-white/50 max-w-2xl mx-auto"
        >
          Everything you need to create, manage, and scale your AI workflows
        </motion.p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURE_CARDS.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: -8 }}
              className="p-6 rounded-xl transition-all duration-300 cursor-pointer"
              style={{
                background: "var(--nazai-card-bg)",
                border: "1px solid var(--nazai-border-light)",
              }}
            >
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                style={{ background: `${card.color}20` }}
              >
                <card.icon size={24} style={{ color: card.color }} />
              </div>
              <h3 className="text-lg font-semibold mb-2 text-white">
                {card.title}
              </h3>
              <p className="text-sm text-white/60">
                {card.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );

  // How It Works Section
  const HowItWorksSection = () => (
    <section id="how-it-works" className="py-20 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-bold text-center mb-4 text-white"
        >
          How NazAI Works
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-center mb-4 text-white/50"
        >
          Every mission is automatically synced to your private dashboard for total control.
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="text-center mb-12 text-xs font-mono"
          style={{ color: auraProfile.glowPrimary, opacity: 0.7 }}
        >
          NEURAL WORKFLOW // 4-CORE PROCESSING
        </motion.p>
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {WORKFLOW_STEPS.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="flex-1 text-center"
            >
              <div className="relative">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: `${auraProfile.glowPrimary}20`, border: `2px solid ${auraProfile.glowPrimary}` }}
                >
                  <step.icon size={28} style={{ color: auraProfile.glowPrimary }} />
                </div>
                {index < WORKFLOW_STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(50%+2rem)] w-[calc(100%-4rem)] h-0.5">
                    <ArrowRight
                      size={20}
                      className="absolute -right-4 top-1/2 -translate-y-1/2"
                      style={{ color: auraProfile.glowPrimary, opacity: 0.5 }}
                    />
                  </div>
                )}
              </div>
              <h3 className="text-lg font-semibold mb-2 text-white">
                {step.title}
              </h3>
              <p className="text-sm text-white/60">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
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
          <p className="text-xs tracking-wider uppercase font-mono text-muted-foreground mt-3">
            DESIGN SYSTEM // REAL-TIME
          </p>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 gap-5"
        >
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Palette size={16} /> Color Palette
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono block mb-1 text-muted-foreground">Primary Color</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-10 h-10 rounded-xl border"
                    style={{ background: auraProfile.glowPrimary, borderColor: "var(--nazai-border-light)" }}
                  />
                  <input
                    type="color"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="w-16 h-9 rounded bg-transparent border"
                    style={{ borderColor: "var(--nazai-border-light)" }}
                  />
                  <input
                    type="text"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded text-xs bg-transparent border"
                    style={{ borderColor: "var(--nazai-border-light)", color: "var(--nazai-text-color)" }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-mono block mb-1 text-muted-foreground">Secondary Color</label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-10 h-10 rounded-xl border"
                    style={{ background: auraProfile.glowSecondary, borderColor: "var(--nazai-border-light)" }}
                  />
                  <input
                    type="color"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="w-16 h-9 rounded bg-transparent border"
                    style={{ borderColor: "var(--nazai-border-light)" }}
                  />
                  <input
                    type="text"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded text-xs bg-transparent border"
                    style={{ borderColor: "var(--nazai-border-light)", color: "var(--nazai-text-color)" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Sliders size={16} /> Appearance
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-mono text-muted-foreground mb-1">
                  <span>Glass Blur</span>
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
                <div className="text-sm font-semibold">Light / Dark Mode</div>
                <div className="text-xs text-muted-foreground">{auraProfile.isLightMode ? "Light" : "Dark"} theme</div>
              </div>
            </div>
            <Switch checked={auraProfile.isLightMode} onCheckedChange={toggleLightMode} />
          </motion.div>

          <motion.div variants={itemVariants} className="md:col-span-2">
            <motion.button
              onClick={resetAuraToDefault}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <RotateCcw size={14} /> Reset to Default
            </motion.button>
          </motion.div>
        </motion.div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          onClick={() => setShowSettings(false)}
          className="mt-6 w-full py-2.5 rounded-xl text-sm font-medium"
          style={{
            background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)`,
            border: `1px solid ${auraProfile.glowPrimary}40`,
            color: auraProfile.glowPrimary,
          }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          ← Return to Dashboard
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
              className="w-14 h-14 rounded-full flex items-center justify-center border"
              style={{ borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.3)` }}
            >
              <Zap size={22} style={{ color: borderColor }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.8)` }}>
                Ready to Create
              </p>
              <p className="text-xs mt-1 text-white/50">Select an AI engine, then describe your mission.</p>
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
              className="max-w-[78%] px-4 py-2 text-sm"
              style={{
                borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
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
            className="text-xs px-3 py-1 rounded-full flex items-center gap-1"
            style={{
              background: `rgba(${activeTool.category.glowRgba},0.1)`,
              border: `1px solid rgba(${activeTool.category.glowRgba},0.3)`,
              color: activeTool.category.color,
            }}
          >
            {activeTool.tool.name} <X size={12} className="cursor-pointer" onClick={() => setSelectedModel(null)} />
          </span>
        </motion.div>
      )}

      <div className="w-full max-w-2xl mb-4">
        <div
          className="relative rounded-xl flex flex-col"
          style={{
            border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)`,
            background: "var(--nazai-card-bg)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={activeTool ? `Mission for ${activeTool.tool.name}...` : "Describe your mission..."}
            rows={1}
            className="w-full bg-transparent border-none outline-none resize-none text-sm p-4 min-h-[100px] font-sans"
            style={{ color: "var(--nazai-text-color)" }}
          />
          <div className="flex items-center justify-between px-3 py-2 border-t" style={{ borderColor: "var(--nazai-border-light)" }}>
            <div className="flex gap-1">
              <motion.button
                onClick={() => setPlusMenuOpen(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Plus size={14} />
              </motion.button>
              <button
                onClick={() => {
                  setDrawerOpen(true);
                  setPlusMenuOpen(false);
                }}
                className="text-xs px-3 py-1 rounded-md"
                style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.08)` }}
              >
                {activeTool ? activeTool.tool.name : "Select Engine"}
              </button>
            </div>
            <motion.button
              onClick={handleSend}
              disabled={!input.trim() || isProcessing}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: input.trim() ? currentTheme.color : "rgba(255,255,255,0.1)" }}
              whileHover={input.trim() ? { scale: 1.1, filter: "brightness(1.2)" } : {}}
              whileTap={input.trim() ? { scale: 0.9 } : {}}
            >
              <Send size={12} style={{ color: input.trim() ? "#ffffff" : "rgba(255,255,255,0.3)" }} />
            </motion.button>
          </div>
        </div>
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
      <div className="text-center mb-6">
        <h1
          className="text-3xl font-bold tracking-tight"
          style={{
            background: currentTheme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {activeNav}
        </h1>
        <p className="text-xs font-mono text-muted-foreground mt-2">
          {activeNav.toUpperCase()} // MANAGE YOUR WORK
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
            <p className="text-sm text-white/40">No missions found in {activeNav.toLowerCase()}</p>
          </div>
        ) : (
          filteredMissions.map(renderMissionItem)
        )}
      </motion.div>
    </motion.div>
  );

  // Check if user is logged in to show dashboard or landing page
  const isLoggedIn = !!userEmail;

  // If not logged in, show landing page
  if (!isLoggedIn) {
    return (
      <div
        className="min-h-screen"
        style={{ background: "var(--nazai-bg-base)" }}
      >
        <LandingNav />
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        
        {/* Footer */}
        <footer className="py-12 px-4 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-sm text-white/40">© 2025 NazAI. All rights reserved.</p>
          </div>
        </footer>
      </div>
    );
  }

  // ─── Main Dashboard Render (Logged In) ──────────────────────────────────────────
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
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.15)`, color: borderColor }}
              >
                {userEmail[0].toUpperCase()}
              </div>
            )}
            <button
              onClick={() => setLogoutModalOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={14} className="opacity-50 hover:opacity-100 hover:text-red-400" />
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
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(10,10,15,0.8)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <div className="flex items-center gap-2">
            <button onClick={() => setSidebarCollapsed((v) => !v)} className="opacity-50 hover:opacity-100 transition">
              {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <span
              className="text-xs font-mono font-bold tracking-tighter"
              style={{ color: borderColor }}
            >
              NAZAI://
            </span>
            <span
              className="text-xs font-mono font-bold"
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
            <span className="text-[8px] font-mono tracking-wider opacity-40">SYNCHRONIZED</span>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center overflow-hidden relative px-3">
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
      </main>

      {/* PLUS MENU MODAL */}
      <AnimatePresence>
        {plusMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPlusMenuOpen(false)}
              className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={springTransition}
              className="fixed z-[100] bottom-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-sm rounded-xl overflow-hidden"
              style={{
                background: "var(--nazai-card-bg)",
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`,
                backdropFilter: `blur(${auraProfile.glassBlur}px)`,
              }}
            >
              <div className="px-4 py-2 border-b flex justify-between items-center" style={{ borderColor: "var(--nazai-border-light)" }}>
                <span className="text-xs font-mono text-muted-foreground">Tools & Options</span>
                <button onClick={() => setPlusMenuOpen(false)} className="opacity-50 hover:opacity-100">
                  <X size={14} />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <button
                  onClick={handleFileUpload}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <Paperclip size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }} />
                  <div className="text-left">
                    <div className="text-sm">Add Files / Photos</div>
                    <div className="text-xs text-muted-foreground">Upload from device</div>
                  </div>
                </button>
                <div className="h-px my-2" style={{ background: "var(--nazai-border-light)" }} />
                <div className="text-xs font-mono text-muted-foreground px-2">Skills</div>
                {SKILLS.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => handleSkillClick(label)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <Icon size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.5)` }} />
                    <span className="text-sm">{label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* AI DRAWER MODAL */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={springTransition}
              className="fixed z-[100] bottom-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md rounded-xl overflow-hidden"
              style={{
                background: "var(--nazai-card-bg)",
                border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.2)`,
                backdropFilter: `blur(${auraProfile.glassBlur}px)`,
              }}
            >
              <div className="px-4 py-2 border-b flex justify-between items-center" style={{ borderColor: "var(--nazai-border-light)" }}>
                <span className="text-xs font-mono text-muted-foreground">Select AI Engine</span>
                <button onClick={() => setDrawerOpen(false)} className="opacity-50 hover:opacity-100">
                  <X size={14} />
                </button>
              </div>
              <div className="p-3 space-y-3">
                {Object.entries(AI_CATEGORIES).map(([catKey, cat]) => (
                  <div key={catKey}>
                    <div className="text-[10px] font-mono mb-1" style={{ color: cat.color }}>
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
                            <span className="text-[10px] font-semibold">{tool.name}</span>
                          </div>
                          <div className="text-[8px] opacity-50">{tool.subtitle}</div>
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
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-sm w-full rounded-xl p-6 text-center"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <LogOut size={32} className="mx-auto mb-3 text-red-500" />
              <h3 className="text-lg font-semibold mb-1 text-white">Sign Out</h3>
              <p className="text-sm text-white/50 mb-4">Are you sure you want to sign out?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setLogoutModalOpen(false)}
                  className="flex-1 py-2 rounded-lg text-sm bg-white/5 border text-white"
                  style={{ borderColor: "var(--nazai-border-light)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex-1 py-2 rounded-lg text-sm bg-red-500/20 border border-red-500/40 text-red-400"
                >
                  Sign Out
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        
        :root {
          --glow-primary: #06b6d4;
          --glow-primary-rgb: 6,182,212;
          --glow-secondary: #3b82f6;
          --glow-secondary-rgb: 59,130,246;
          --text-glow-intensity: 0.3;
          --glass-blur: 16px;
          --nazai-text-color: #e2e8f0;
          --nazai-bg-base: #0a0a0f;
          --nazai-border-light: rgba(255,255,255,0.08);
          --nazai-card-bg: rgba(255,255,255,0.05);
        }
        
        * {
          scrollbar-width: thin;
          font-family: 'Inter', sans-serif;
        }
        
        body {
          font-family: 'Inter', sans-serif;
        }
        
        .font-mono, code, pre, .mono {
          font-family: 'JetBrains Mono', monospace;
        }
        
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
          border-radius: 3px;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .animate-pulse { animation: pulse 2s ease-in-out infinite; }
        textarea::placeholder { opacity: 0.4; }
        input[type="range"] { -webkit-appearance: none; background: transparent; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--glow-primary); cursor: pointer; border: none; }
        input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        input[type="color"]::-webkit-color-swatch { border: none; border-radius: 8px; }
      `}</style>
    </div>
  );
}
