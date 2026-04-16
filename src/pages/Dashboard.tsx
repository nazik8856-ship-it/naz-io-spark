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
  AlertCircle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── DEPLOYMENT VERSION ──────────────────────────────────────────────────────────
const DEPLOYMENT_ID = "NAZAI_TITAN_V24_GLOW";

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
  glassBlur: 16,
  isLightMode: false,
};

// Professional placeholder texts for typing animation
const PLACEHOLDER_TEXTS = [
  "Architect a high-performance gym business...",
  "Design a blueprint for an automated SaaS...",
  "Build a launch strategy for a tech startup...",
];

// Professional system prompt for AI
const SYSTEM_PROMPT = `You are The Neural Architect, a high-precision business blueprinting AI. Respond in a professional, architectural tone. Provide structured, actionable business plans. Focus on strategic frameworks, market analysis, operational excellence, and financial architecture. Use clear sections and professional language.`;

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

// Generate geometric gradient avatar colors
const getAvatarGradient = (email: string) => {
  const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 55%), hsl(${hue2}, 70%, 45%))`;
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

// Elegant laser shine animation
const laserShineAnimation = {
  boxShadow: [
    `0 0 0px -5px var(--glow-primary)`,
    `0 0 20px -5px var(--glow-primary)`,
    `0 0 0px -5px var(--glow-primary)`,
  ],
  transition: {
    duration: 3,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
};

// Format AI response text with styled sections
const formatAIResponse = (text: string) => {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Match headers like [STRATEGY], [MARKET], etc.
    const headerMatch = line.match(/^\[([A-Z_\s]+)\]/);
    if (headerMatch) {
      return (
        <div key={i} className="mt-3 mb-1">
          <span className="font-mono text-[11px] font-black tracking-wider" style={{ color: '#06b6d4', textShadow: '0 0 8px rgba(6,182,212,0.6)' }}>
            [{headerMatch[1]}]
          </span>
          <span className="text-[11px] ml-1" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {line.slice(headerMatch[0].length)}
          </span>
        </div>
      );
    }
    // Bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 ml-2 my-0.5">
          <span style={{ color: '#06b6d4' }}>›</span>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.75)' }}>{line.trim().slice(2)}</span>
        </div>
      );
    }
    // Numbered items
    const numMatch = line.trim().match(/^(\d+[\.\)]) /);
    if (numMatch) {
      return (
        <div key={i} className="flex gap-2 ml-2 my-0.5">
          <span className="font-mono text-[10px] font-bold" style={{ color: '#06b6d4' }}>{numMatch[1]}</span>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.75)' }}>{line.trim().slice(numMatch[0].length)}</span>
        </div>
      );
    }
    // Empty lines
    if (!line.trim()) return <div key={i} className="h-2" />;
    // Regular text
    return <p key={i} className="text-[11px] my-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>{line}</p>;
  });
};

// Generate fallback structural outline
const generateFallbackOutline = (prompt: string): string => {
  const words = prompt.split(' ').slice(0, 10).join(' ');
  return `[Neural Architect: Connection Delayed]\n\nBased on: "${words}...", the blueprint is being generated. Please check your connection or try again.\n\nPreliminary Structure:\n• Market Analysis\n• Operational Framework\n• Financial Architecture\n• Growth Strategy\n\nReconnect to receive the complete AI-powered strategic plan.`;
};

// ─── Component ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();

  // ── Service Worker Nuke & Cache Busting (V24) ────────────────────────────────────
  useEffect(() => {
    const clearAllCachesAndReload = async () => {
      const currentVersion = localStorage.getItem("nazai_version_id");
      
      if (currentVersion !== DEPLOYMENT_ID) {
        localStorage.clear();
        sessionStorage.clear();
        
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          for (const cacheName of cacheNames) {
            await caches.delete(cacheName);
          }
        }
        
        localStorage.setItem("nazai_version_id", DEPLOYMENT_ID);
        window.location.replace(window.location.href);
      }
    };
    
    clearAllCachesAndReload();
  }, []);

  // ── FOCUS HIJACK: Forces input focus when tapping bottom 30% of screen ─────────
  useEffect(() => {
    const forceFocus = (e: TouchEvent | MouseEvent) => {
      const y = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      if (y > window.innerHeight * 0.7) {
        const textarea = document.querySelector('textarea');
        if (textarea) {
          (textarea as HTMLElement).focus();
        }
      }
    };

    const killGhosts = () => {
      const overlays = document.querySelectorAll('.scanlines, .radar-sweep, [class*="fixed"]');
      overlays.forEach(el => {
        if (!el.contains(document.querySelector('textarea'))) {
          (el as HTMLElement).style.pointerEvents = 'none';
        }
      });
    };

    window.addEventListener('touchstart', forceFocus);
    window.addEventListener('mousedown', forceFocus);
    killGhosts();

    return () => {
      window.removeEventListener('touchstart', forceFocus);
      window.removeEventListener('mousedown', forceFocus);
    };
  }, []);

  // ── Visual Viewport State for Mechanical Anchoring ─────────────────────────────
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // ── State ───────────────────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
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
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAbortControllerRef = useRef<AbortController | null>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const focusSnapIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      root.style.setProperty("--nazai-text-color", "#0f172a");
      root.style.setProperty("--nazai-bg-base", "#f1f5f9");
      root.style.setProperty("--nazai-border-light", "rgba(0,0,0,0.06)");
      root.style.setProperty("--nazai-card-bg", "rgba(255,255,255,0.9)");
    } else {
      root.style.setProperty("--nazai-text-color", "#e2e8f0");
      root.style.setProperty("--nazai-bg-base", "#020617");
      root.style.setProperty("--nazai-border-light", "rgba(255,255,255,0.05)");
      root.style.setProperty("--nazai-card-bg", "#0f172a");
    }
  }, [auraProfile]);

  useEffect(() => {
    saveAuraProfile(auraProfile);
  }, [auraProfile]);

  // ── VISUAL VIEWPORT ANCHOR - Mechanical Override ──────────────────────────────
  useEffect(() => {
    if (!window.visualViewport) return;

    const handleViewportResize = () => {
      const viewport = window.visualViewport;
      const windowHeight = window.innerHeight;
      const keyboardHeightEstimate = Math.max(0, windowHeight - viewport.height);
      setKeyboardHeight(keyboardHeightEstimate);
    };

    window.visualViewport.addEventListener("resize", handleViewportResize);
    window.visualViewport.addEventListener("scroll", handleViewportResize);
    handleViewportResize();

    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("scroll", handleViewportResize);
    };
  }, []);

  // ── THE INPUT HAMMER: Punish browser scroll attempts ───────────────────────────
  const handleTextareaFocus = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.target.scrollIntoView({ block: "center", behavior: "instant" });
    window.scrollTo(0, 0);
    e.target.classList.remove('animate-shake');
    
    if (focusSnapIntervalRef.current) {
      clearInterval(focusSnapIntervalRef.current);
    }
    
    let snapCount = 0;
    focusSnapIntervalRef.current = setInterval(() => {
      window.scrollTo(0, 0);
      snapCount++;
      if (snapCount >= 10) {
        if (focusSnapIntervalRef.current) {
          clearInterval(focusSnapIntervalRef.current);
          focusSnapIntervalRef.current = null;
        }
      }
    }, 10);
  }, []);

  const handleTextareaBlur = useCallback(() => {
    if (focusSnapIntervalRef.current) {
      clearInterval(focusSnapIntervalRef.current);
      focusSnapIntervalRef.current = null;
    }
  }, []);

  // ── Derived State ───────────────────────────────────────────────────────────────
  const activeTool = useMemo(() => findToolById(selectedModel), [selectedModel]);
  const isMediaMode = activeTool?.category.label === "CREATION";
  const borderColor = activeTool?.category.color ?? auraProfile.glowPrimary;
  const activeNavItem = NAV_ITEMS.find((n) => n.label === activeNav) ?? NAV_ITEMS[0];
  const currentTheme = SECTION_THEMES[activeNav] ?? getDefaultTheme();

  const filteredMissions = useMemo(() => {
    switch (activeNav) {
      case "Trash": return missions.filter((m) => m.status === "trashed");
      case "Archives": return missions.filter((m) => m.status === "archived");
      case "Recently": return missions.filter((m) => m.status !== "trashed").slice(0, 10);
      case "History": return missions.filter((m) => m.status === "completed");
      case "Workflows": return missions.filter((m) => m.status === "pending" || m.status === "active");
      default: return missions.filter((m) => m.status !== "trashed");
    }
  }, [activeNav, missions]);

  // ── Effects ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
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
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
  }, [messages]);

  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (currentAbortControllerRef.current) currentAbortControllerRef.current.abort();
      if (focusSnapIntervalRef.current) clearInterval(focusSnapIntervalRef.current);
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

  const handleSelectTool = useCallback((id: string) => {
    setSelectedModel(id);
    setDrawerOpen(false);
  }, []);

  // ─── MAIN MESSAGE HANDLER - NO input dependency! ───────────────────────────────
  const handleSendMessage = useCallback(async () => {
    const currentText = textareaRef.current?.value || "";
    const trimmed = currentText.trim();
    
    if (isPending || trimmed.length === 0) {
      if (trimmed.length === 0 && textareaRef.current) {
        textareaRef.current.classList.add('animate-shake');
        setTimeout(() => textareaRef.current?.classList.remove('animate-shake'), 500);
      }
      return;
    }

    setIsPending(true);

    if (currentAbortControllerRef.current) {
      currentAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    currentAbortControllerRef.current = controller;
    
    const userMessage = trimmed;
    const aiMsgIndex = messages.length + 1;
    
    if (textareaRef.current) textareaRef.current.value = "";
    setErrorMessage(null);
    setMessages(prev => [...prev, 
      { role: 'user', text: userMessage },
      { role: 'ai', text: "Neural Architect: Processing blueprint..." }
    ]);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection timeout after 12s")), 12000);
    });

    try {
      const result = await Promise.race([
        supabase.functions.invoke("generate-business-plan", {
          body: { 
            prompt: userMessage, 
            model: selectedModel,
            style: activeStyle,
            webSearch: webSearchActive,
            systemPrompt: SYSTEM_PROMPT,
          },
          signal: controller.signal,
        }),
        timeoutPromise,
      ]) as { data: any; error: any };

      if (result.error) throw new Error(result.error.message || "Link Failed");

      const outputText = result.data?.plan || result.data?.response || `Blueprint ready for: "${userMessage}"`;

      if (userId) {
        await supabase.from("missions").insert({
          user_id: userId,
          directive: userMessage,
          status: "completed",
          created_at: new Date().toISOString(),
        });
      }

      setMessages(prev => {
        const updated = [...prev];
        if (updated[aiMsgIndex]) {
          updated[aiMsgIndex] = { ...updated[aiMsgIndex], text: outputText };
        }
        return updated;
      });

    } catch (error) {
      console.error("Execution Error:", error);
      setMessages(prev => {
        const updated = [...prev];
        if (updated[aiMsgIndex]) {
          updated[aiMsgIndex] = { 
            ...updated[aiMsgIndex], 
            text: "SYSTEM ERROR: Link failed. Directive stored locally.",
            isSimulation: true 
          };
        }
        return updated;
      });
    } finally {
      setIsPending(false);
      currentAbortControllerRef.current = null;
      setTimeout(() => {
        textareaRef.current?.focus();
        window.scrollTo(0, document.body.scrollHeight);
      }, 250);
    }
  }, [isPending, messages.length, selectedModel, userId, activeStyle, webSearchActive]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleSendPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const currentText = textareaRef.current?.value || "";
    if (currentText.trim() && !isPending) {
      handleSendMessage();
    }
  }, [isPending, handleSendMessage]);

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
    if (textareaRef.current) {
      const currentVal = textareaRef.current.value;
      textareaRef.current.value = currentVal ? `${currentVal}\n${command}` : command;
      textareaRef.current.focus();
    }
    setPlusMenuOpen(false);
  }, []);

  const handleConnectorToggle = useCallback((key: keyof ConnectorStatus, checked: boolean) => {
    setConnectorStatus((prev) => ({ ...prev, [key]: checked }));
  }, []);

  // ─── Render Components ──────────────────────────────────────────────────────────
  
  const renderNavItem = useCallback((item: typeof NAV_ITEMS[number]) => {
    const Icon = item.icon;
    const isActive = activeNav === item.label && !showSettings;
    const isSettingsActive = item.label === "Settings" && showSettings;
    const itemTheme = SECTION_THEMES[item.label] || SECTION_THEMES["Home"];
    return (
      <motion.button
        key={item.label}
        onClick={() => handleNavClick(item.label)}
        title={item.label}
        className="w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 relative group"
        whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
        whileTap={{ scale: 0.95 }}
      >
        {(isActive || isSettingsActive) && (
          <motion.div
            layoutId="nav-active-bg"
            className="absolute inset-0 rounded-xl"
            style={{ background: itemTheme.gradient, opacity: 0.1 }}
            transition={springTransition}
          />
        )}
        <Icon
          size={18}
          className="relative z-10 transition-colors duration-200"
          style={{
            color: isActive || isSettingsActive ? itemTheme.color : "rgba(255,255,255,0.4)",
          }}
        />
      </motion.button>
    );
  }, [activeNav, showSettings, handleNavClick]);

  const renderMissionItem = useCallback((mission: Mission, index: number) => (
    <motion.div
      key={mission.id}
      variants={itemVariants}
      whileHover={{ scale: 1.01, backgroundColor: "rgba(255,255,255,0.03)" }}
      className="group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200"
      style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` }}>
        <Zap size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.7)` }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate" style={{ color: "var(--nazai-text-color)" }}>
          {mission.directive?.slice(0, 80) || "Untitled Blueprint"}
        </p>
        <p className="text-[10px] font-mono mt-0.5 text-white/40">
          {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
        </p>
      </div>
      <ChevronRight size={14} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-white/30" />
    </motion.div>
  ), [auraProfile.glowPrimary]);

  // Settings View
  const SettingsView = () => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={springTransition} className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-black uppercase tracking-tighter font-mono" style={{ background: `linear-gradient(135deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            AURA STUDIO
          </h1>
          <p className="text-[10px] tracking-[0.3em] uppercase font-mono text-white/40 mt-3">DESIGN SYSTEM // REAL-TIME</p>
        </div>

        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div variants={itemVariants} className="md:col-span-2 p-5 rounded-xl" style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 font-mono" style={{ color: auraProfile.glowPrimary }}><Palette size={16} /> CHROMATIC CORE</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">PRIMARY GLOW</label>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl" style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 15px ${auraProfile.glowPrimary}` }} />
                  <input type="color" value={auraProfile.glowPrimary} onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })} className="w-16 h-9 rounded bg-transparent border border-white/20 cursor-pointer" />
                  <input type="text" value={auraProfile.glowPrimary} onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })} className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10 font-mono" style={{ color: "var(--nazai-text-color)" }} />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">SECONDARY GLOW</label>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl" style={{ background: auraProfile.glowSecondary, boxShadow: `0 0 15px ${auraProfile.glowSecondary}` }} />
                  <input type="color" value={auraProfile.glowSecondary} onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })} className="w-16 h-9 rounded bg-transparent border border-white/20 cursor-pointer" />
                  <input type="text" value={auraProfile.glowSecondary} onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })} className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10 font-mono" style={{ color: "var(--nazai-text-color)" }} />
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="p-5 rounded-xl" style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 font-mono" style={{ color: auraProfile.glowPrimary }}><Sliders size={16} /> ATMOSPHERIC</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[9px] font-mono text-white/40 mb-1"><span>TEXT GLOW</span><span>{auraProfile.textGlowIntensity.toFixed(2)}</span></div>
                <input type="range" min="0" max="1" step="0.01" value={auraProfile.textGlowIntensity} onChange={(e) => updateAuraProfile({ textGlowIntensity: parseFloat(e.target.value) })} className="w-full h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})` }} />
              </div>
              <div>
                <div className="flex justify-between text-[9px] font-mono text-white/40 mb-1"><span>GLASS BLUR</span><span>{auraProfile.glassBlur}px</span></div>
                <input type="range" min="0" max="40" step="1" value={auraProfile.glassBlur} onChange={(e) => updateAuraProfile({ glassBlur: parseInt(e.target.value) })} className="w-full h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${auraProfile.glowPrimary}, ${auraProfile.glowSecondary})` }} />
              </div>
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="p-5 rounded-xl flex items-center justify-between" style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}>
            <div className="flex items-center gap-2">
              {auraProfile.isLightMode ? <Sun size={18} style={{ color: auraProfile.glowPrimary }} /> : <Moon size={18} style={{ color: auraProfile.glowPrimary }} />}
              <div><div className="text-sm font-semibold font-mono">Frosted Quartz</div><div className="text-[9px] font-mono text-white/40">{auraProfile.isLightMode ? "LIGHT" : "DARK"}</div></div>
            </div>
            <Switch checked={auraProfile.isLightMode} onCheckedChange={toggleLightMode} />
          </motion.div>

          <motion.div variants={itemVariants} className="p-5 rounded-xl text-center" style={{ background: "var(--nazai-card-bg)", border: `1px solid ${auraProfile.glowPrimary}30` }}>
            <p className="text-xs font-mono font-bold" style={{ color: "var(--nazai-text-color)", textShadow: `0 0 ${auraProfile.textGlowIntensity * 8}px ${auraProfile.glowPrimary}` }}>NEURAL ARCHITECT:// AURA ACTIVE</p>
            <div className="flex justify-center gap-2 mt-2">
              <div className="w-6 h-6 rounded-full" style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 12px ${auraProfile.glowPrimary}` }} />
              <div className="w-6 h-6 rounded-full" style={{ background: auraProfile.glowSecondary, boxShadow: `0 0 12px ${auraProfile.glowSecondary}` }} />
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="md:col-span-2">
            <motion.button onClick={resetAuraToDefault} className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }} whileHover={{ scale: 1.01, background: "rgba(239,68,68,0.1)" }} whileTap={{ scale: 0.99 }}>
              <RotateCcw size={14} /> RESET TO DEFAULT
            </motion.button>
          </motion.div>
        </motion.div>

        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} onClick={() => setShowSettings(false)} className="mt-6 w-full py-2.5 rounded-xl text-sm font-medium transition-all" style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.05)`, border: `1px solid ${auraProfile.glowPrimary}20`, color: auraProfile.glowPrimary }} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
          ← RETURN TO DASHBOARD
        </motion.button>
      </div>
    </motion.div>
  );

  // Home View with TITAN V24 GLOW UPGRADE
  const HomeView = () => (
    <div className="flex flex-col w-full h-full">
      {/* Error Toast */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-mono"
            style={{ background: "rgba(239,68,68,0.9)", border: "1px solid rgba(239,68,68,0.5)", color: "white" }}
          >
            <AlertCircle size={12} />
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrollable Messages Area */}
      <div className="flex-1 w-full max-w-2xl mx-auto overflow-y-auto py-6 space-y-3 px-4 pb-[120px]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full animate-pulse" style={{ 
                boxShadow: `0 0 30px rgba(6, 182, 212, 0.6)`,
                background: 'radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%)'
              }} />
              <div className="w-16 h-16 rounded-full border-2 border-cyan-500/50 flex items-center justify-center relative bg-cyan-500/5">
                <div className="absolute inset-0 rounded-full animate-ping opacity-75" style={{ background: 'rgba(6, 182, 212, 0.3)' }} />
                <div className="w-3 h-3 rounded-full bg-cyan-500 animate-pulse" style={{ boxShadow: '0 0 10px #06b6d4' }} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-mono tracking-wide text-white font-bold" style={{ 
                textShadow: '0 0 15px rgba(6, 182, 212, 0.8)',
                color: '#e2e8f0'
              }}>
                SYSTEM: READY TO EXECUTE
              </p>
              <p className="text-[10px] font-mono text-cyan-400/60 tracking-wider">
                Neural Link Established // DEPLOYMENT_V24
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[78%] px-3 py-2 text-xs font-mono" style={{ borderRadius: "12px 12px 2px 12px", background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.05)`, border: `1px solid var(--nazai-border-light)`, color: "var(--nazai-text-color)" }}>
                {msg.text}
              </div>
            ) : (
              <div className="max-w-[85%] rounded-xl overflow-hidden" style={{ background: '#0B1F3A', border: '1px solid rgba(255,255,255,0.1)' }}>
                {/* Terminal Header */}
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(6,182,212,0.03)' }}>
                  <Brain size={12} style={{ color: '#06b6d4' }} />
                  <span className="text-[9px] font-mono font-bold tracking-wider" style={{ color: '#06b6d4', textShadow: '0 0 6px rgba(6,182,212,0.4)' }}>
                    NEURAL ARCHITECT // MISSION_RESULT.LOG
                  </span>
                </div>
                {/* Content */}
                <div className="px-3 py-2.5">
                  {formatAIResponse(msg.text)}
                </div>
              </div>
            )}
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Selected Engine Badge */}
      {activeTool && (
        <div className="w-full max-w-2xl mx-auto mb-2 flex justify-end px-4 relative z-[101]">
          <span className="text-[9px] px-2 py-1 rounded-full flex items-center gap-1 font-mono" style={{ background: `rgba(${activeTool.category.glowRgba},0.1)`, border: `1px solid rgba(${activeTool.category.glowRgba},0.2)`, color: activeTool.category.color }}>
            {activeTool.tool.name} <X size={10} className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => setSelectedModel(null)} />
          </span>
        </div>
      )}
    </div>
  );

  // Folder View
  const FolderView = () => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col w-full max-w-4xl flex-1 overflow-y-auto pt-4 pb-8 px-4">
      <div className="text-center mb-5">
        <h1 className="text-3xl font-black uppercase tracking-tighter font-mono" style={{ background: currentTheme.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{activeNav}</h1>
        <p className="text-[8px] tracking-[0.3em] uppercase font-mono text-white/30 mt-2">SYSTEM_NODE // {activeNav.toUpperCase()}_TERMINAL</p>
      </div>
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-2">
        {missionsLoading ? (
          <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.4)` }} /></div>
        ) : filteredMissions.length === 0 ? (
          <div className="text-center py-12"><p className="text-[11px] font-mono text-white/30">No blueprints found in {activeNav.toLowerCase()}</p></div>
        ) : (filteredMissions.map(renderMissionItem))}
      </motion.div>
    </motion.div>
  );

  // ─── Main Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden font-sans" style={{ background: "var(--nazai-bg-base)", color: "var(--nazai-text-color)" }}>
      <input ref={fileInputRef} type="file" multiple className="hidden" />

      {/* Sidebar */}
      <motion.aside animate={{ width: sidebarCollapsed ? 0 : 56 }} transition={{ duration: 0.2 }} className="flex flex-col items-center shrink-0 overflow-hidden z-20" style={{ borderRight: `1px solid var(--nazai-border-light)`, background: "var(--nazai-bg-base)" }}>
        <div className="flex flex-col items-center w-14 py-4 h-full">
          <div className="mb-6"><Zap size={18} style={{ color: borderColor }} /></div>
          <nav className="flex flex-col gap-1 flex-1">{NAV_ITEMS.map(renderNavItem)}</nav>
          <div className="flex flex-col items-center gap-2 mt-auto">
            {userEmail && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold overflow-hidden" style={{ background: getAvatarGradient(userEmail) }}>
                {userEmail[0].toUpperCase()}
              </div>
            )}
            <button onClick={() => setLogoutModalOpen(true)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 transition-all"><LogOut size={14} className="text-white/30 hover:text-red-400 transition-colors" /></button>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex flex-col flex-1 min-w-0 relative">
        <header className="flex items-center justify-between px-4 py-2 shrink-0" style={{ borderBottom: `1px solid var(--nazai-border-light)`, background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(2,6,23,0.8)", backdropFilter: `blur(${auraProfile.glassBlur}px)` }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setSidebarCollapsed(v => !v)} className="text-white/40 hover:text-white/60 transition-colors">{sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}</button>
            <span 
              className="text-[10px] font-mono font-black tracking-tighter" 
              style={{ 
                color: borderColor, 
                textShadow: `0 0 calc(var(--text-glow-intensity) * 15px) var(--glow-primary)`
              }}
            >
              NEURAL://
            </span>
            <span className="text-[10px] font-mono font-bold" style={{ background: currentTheme.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{activeNav.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: borderColor }} />
            <span className="text-[8px] font-mono tracking-wider text-white/30">SECURE_NODE</span>
          </div>
        </header>

        <div className="flex-1 flex flex-col overflow-hidden relative">
          <AnimatePresence mode="wait">
            {showSettings ? <SettingsView key="settings" /> : activeNav === "Home" ? <HomeView key="home" /> : <FolderView key="folder" />}
          </AnimatePresence>
        </div>

        <footer className="flex items-center justify-between px-4 py-1.5 shrink-0 text-[8px] font-mono tracking-wider text-white/30" style={{ borderTop: `1px solid var(--nazai-border-light)`, background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(2,6,23,0.8)" }}>
          <span>SYSTEM_STABLE</span>
          <div className="flex gap-3"><span>DB:ONLINE</span><span>AI:READY</span></div>
        </footer>
      </main>

      {/* FIXED PILL CONTAINER - Direct child of root div, stays fixed */}
      <div 
        ref={inputContainerRef}
        className="fixed bottom-0 left-0 right-0 z-[99999]"
        style={{ 
          pointerEvents: 'auto',
          isolation: 'isolate'
        }}
      >
        <div className="w-full max-w-2xl mx-auto px-4 pb-4">
          <motion.div 
            className="relative rounded-xl flex flex-col"
            animate={laserShineAnimation}
            style={{ 
              border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.3)`,
              background: "var(--nazai-card-bg)", 
            }}
          >
            <textarea 
              ref={textareaRef} 
              defaultValue=""
              onKeyDown={handleKeyDown}
              onFocus={handleTextareaFocus}
              onBlur={handleTextareaBlur}
              placeholder={activeTool ? `Mission for ${activeTool.tool.name}...` : "Architect a high-performance gym business..."}
              rows={1}
              className="w-full bg-transparent border-none outline-none resize-none font-mono text-base p-3"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-gramm={false}
              style={{ 
                color: "var(--nazai-text-color)",
                fontSize: '16px', 
                height: "56px", 
                minHeight: "56px",
                maxHeight: "56px",
                zIndex: 9999999,
                position: 'relative',
                pointerEvents: 'auto',
                cursor: 'text',
                WebkitUserSelect: 'text',
                userSelect: 'text',
                touchAction: 'manipulation',
              }}
            />
            <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
              <div className="flex gap-1">
                <motion.button 
                  onClick={() => setPlusMenuOpen(true)} 
                  className="w-7 h-7 rounded-full flex items-center justify-center relative z-10 transition-all"
                  style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.05)` }}
                  whileHover={{ scale: 1.1, background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Plus size={12} />
                </motion.button>
                <button 
                  onClick={() => { setDrawerOpen(true); setPlusMenuOpen(false); }} 
                  className="text-[9px] px-2 py-1 rounded font-mono transition-all hover:bg-white/5" 
                  style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.03)` }}
                >
                  {activeTool ? activeTool.tool.name : "Select Engine"}
                </button>
              </div>
              <motion.button 
                onPointerDown={handleSendPointerDown}
                disabled={isPending} 
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                style={{ background: currentTheme.color + "CC" }
                }
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Send size={11} style={{ color: "#020617" }} />
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* PLUS MENU MODAL */}
      <AnimatePresence>
        {plusMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPlusMenuOpen(false)}
              className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={springTransition}
              className="fixed z-[999] bottom-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-sm rounded-xl overflow-hidden"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
            >
              <div className="px-4 py-2 border-b border-white/10 flex justify-between items-center">
                <span className="text-[10px] font-mono text-white/40">TOOLS & OPTIONS</span>
                <button onClick={() => setPlusMenuOpen(false)} className="text-white/40 hover:text-white/80 transition-colors"><X size={14} /></button>
              </div>
              <div className="p-3 space-y-2">
                <button onClick={handleFileUpload} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-all">
                  <Paperclip size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }} />
                  <div className="text-left"><div className="text-xs">Add Files / Photos</div><div className="text-[9px] text-white/30">Upload from device</div></div>
                </button>
                <div className="h-px bg-white/10 my-2" />
                <div className="text-[9px] font-mono text-white/40 px-2">SKILLS</div>
                {SKILLS.map(({ icon: Icon, label }) => (
                  <button key={label} onClick={() => handleSkillClick(label)} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-all">
                    <Icon size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.5)` }} />
                    <span className="text-xs">{label}</span>
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawerOpen(false)} className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} transition={springTransition} className="fixed z-[999] bottom-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md rounded-xl overflow-hidden" style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}>
              <div className="px-4 py-2 border-b border-white/10 flex justify-between items-center">
                <span className="text-[10px] font-mono text-white/40">SELECT AI ENGINE</span>
                <button onClick={() => setDrawerOpen(false)} className="text-white/40 hover:text-white/80 transition-colors"><X size={14} /></button>
              </div>
              <div className="p-3 space-y-3">
                {Object.entries(AI_CATEGORIES).map(([catKey, cat]) => (
                  <div key={catKey}>
                    <div className="text-[8px] font-mono mb-1" style={{ color: cat.color }}>{cat.label}</div>
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cat.tools.length}, 1fr)` }}>
                      {cat.tools.map(tool => (
                        <button key={tool.id} onClick={() => handleSelectTool(tool.id)} className="p-2 rounded-lg text-left transition-all" style={{ background: selectedModel === tool.id ? `rgba(${cat.glowRgba},0.1)` : "rgba(255,255,255,0.02)", border: `1px solid ${selectedModel === tool.id ? cat.color : "rgba(255,255,255,0.05)"}` }}>
                          <div className="flex items-center gap-1 mb-0.5"><tool.icon size={10} style={{ color: selectedModel === tool.id ? cat.color : "white/40" }} /><span className="text-[9px] font-semibold">{tool.name}</span></div>
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
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="max-w-sm w-full rounded-xl p-6 text-center" style={{ background: "var(--nazai-card-bg)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <LogOut size={32} className="mx-auto mb-3 text-red-500" />
              <h3 className="text-sm font-bold mb-1 font-mono">System Termination</h3>
              <p className="text-xs text-white/50 mb-4">Are you sure you want to log out?</p>
              <div className="flex gap-2">
                <button onClick={() => setLogoutModalOpen(false)} className="flex-1 py-2 rounded-lg text-xs bg-white/5 border border-white/10 hover:bg-white/10 transition-all">Stay</button>
                <button onClick={handleSignOut} className="flex-1 py-2 rounded-lg text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all">Terminate</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        /* FORCE EVERYTHING TO BE CLICKABLE */
        * {
          pointer-events: auto !important;
        }
        
        .pointer-events-none {
          pointer-events: none !important;
        }
        
        textarea {
          z-index: 999999 !important;
          position: relative !important;
          pointer-events: auto !important;
          -webkit-user-select: text !important;
        }
        
        * {
          -webkit-tap-highlight-color: transparent;
        }
        
        body {
          cursor: default;
          touch-action: manipulation;
        }
        
        html, body {
          height: 100% !important;
          width: 100vw !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          position: relative !important;
          -webkit-overflow-scrolling: touch;
          touch-action: manipulation;
        }
        
        body::before, .scanlines, .radar-sweep {
          pointer-events: none !important;
          z-index: -1 !important;
        }
        
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
          20%, 40%, 60%, 80% { transform: translateX(2px); }
        }
        .animate-shake {
          animation: shake 0.3s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
        
        .overflow-y-auto {
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          touch-action: pan-y;
        }
        
        @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap');
        
        :root {
          --glow-primary: #22c55e;
          --glow-primary-rgb: 34,197,94;
          --glow-secondary: #a855f7;
          --glow-secondary-rgb: 168,85,247;
          --text-glow-intensity: 0.5;
          --glass-blur: 16px;
          --nazai-text-color: #e2e8f0;
          --nazai-bg-base: #020617;
          --nazai-border-light: rgba(255,255,255,0.05);
          --nazai-card-bg: #0f172a;
          --keyboard-height: 0px;
        }
        
        * {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        
        .font-mono, .font-mono * {
          font-family: 'JetBrains Mono', monospace;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .animate-pulse { animation: pulse 2s ease-in-out infinite; }
        
        textarea::placeholder { color: rgba(255,255,255,0.2); }
        
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--glow-primary);
          cursor: pointer;
          box-shadow: 0 0 8px var(--glow-primary);
          border: 2px solid rgba(255,255,255,0.5);
        }
        input[type="color"]::-webkit-color-swatch-wrapper {
          padding: 0;
        }
        input[type="color"]::-webkit-color-swatch {
          border: none;
          border-radius: 8px;
        }
        
        ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.02);
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}
