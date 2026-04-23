import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import DropScanOverlay from "@/components/interactions/DropScanOverlay";
import MagneticButton from "@/components/interactions/MagneticButton";
import CommandCenterChecklist from "@/components/dashboard/CommandCenterChecklist";
import AgentThinkTank from "@/components/dashboard/AgentThinkTank";
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
  MoreHorizontal,
  Copy,
  Share2,
  RotateCw,
  Camera,
  Youtube,
  Music2,
  Mail,
  FileText,
  Wand2,
  User,
  Menu,
  Info,
  Maximize2,
  Minimize2,
  FileCode,
  Terminal,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── DEPLOYMENT VERSION ──────────────────────────────────────────────────────────
const DEPLOYMENT_ID = "NAZAI_TITAN_V25_ARCHITECT";

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

type MissionStatus = "pending" | "active" | "completed" | "recently" | "archived" | "trashed";

type Mission = {
  id: string;
  user_id: string;
  prompt: string;
  response?: string;
  status: MissionStatus;
  created_at: string;
  updated_at: string;
};

type LifecycleAction = "trashed" | "archived" | "removed";

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

// Custom Theme Type
type CustomPalette = {
  glow: string;
  bg: string;
  textType: 'solid' | 'gradient';
  bgType: 'color' | 'gradient' | 'image';
  bgImage: string;
};

// User Context Type
type UserContext = {
  identity: string;
  goals: string;
  style: string;
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

const TOP_NAV_ITEMS = [{ icon: Home, label: "Home" }] as const;

const BOTTOM_NAV_ITEMS = [
  { icon: Archive, label: "Archives" },
  { icon: Trash2, label: "Trash" },
  { icon: Settings, label: "Settings" },
] as const;

const NAV_ITEMS = [...TOP_NAV_ITEMS, ...BOTTOM_NAV_ITEMS] as const;

const SECTION_THEMES: Record<string, Theme> = {
  Home: { gradient: "linear-gradient(135deg, #22c55e, #10b981)", glowRgba: "34,197,94", color: "#22c55e" },
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

// Default Custom Palette
const DEFAULT_CUSTOM_PALETTE: CustomPalette = {
  glow: '#06b6d4',
  bg: '#020617',
  textType: 'solid',
  bgType: 'color',
  bgImage: '',
};

// Default User Context
const DEFAULT_USER_CONTEXT: UserContext = {
  identity: '14-year-old Software Architect from Sumy, Ukraine',
  goals: 'NazAI AI-powered business launcher',
  style: 'Perspective, accurate, direct Yes-man/No-man',
};

// Professional placeholder texts for typing animation
const PLACEHOLDER_TEXTS = [
  "Architect a high-performance gym business...",
  "Design a blueprint for an automated SaaS...",
  "Build a launch strategy for a tech startup...",
];

// Professional system prompt for AI
const SYSTEM_PROMPT = `You are The Neural Architect, a high-precision business blueprinting AI. Respond in a professional, architectural tone. Provide structured, actionable business plans. Focus on strategic frameworks, market analysis, operational excellence, and financial architecture. Use clear sections and professional language.`;

// Dynamic card suggestions - PROFESSIONAL DEVELOPER LOGIC
const getSuggestionsFromResponse = (response: string): string[] => {
  const lowerResponse = response.toLowerCase();
  const suggestions: string[] = [];
  
  if (lowerResponse.includes("code") || lowerResponse.includes("api") || lowerResponse.includes("architecture") || lowerResponse.includes("tech")) {
    suggestions.push("Architecture Blueprint", "Edge-Case Debugging", "Performance Optimization");
  } else if (lowerResponse.includes("business") || lowerResponse.includes("market") || lowerResponse.includes("strategy") || lowerResponse.includes("financial")) {
    suggestions.push("Generate 12-Month Cashflow", "Identify Competitor Weaknesses", "GTM Strategy");
  } else {
    suggestions.push("Stress-Test Logic Gate", "Compliance Check", "Security Audit");
  }
  
  // Always add a Titan suggestion
  suggestions.push("Generate Technical Blueprint");
  
  return suggestions.slice(0, 4);
};

const getInitialCards = (missions: Mission[]): string[] => {
  if (missions.length === 0) {
    return ["Strategy Framework", "Financial Architecture", "Market Analysis", "Operational Excellence"];
  }
  
  const recentPrompts = missions.slice(0, 3).map(m => m.prompt.toLowerCase());
  const cards: string[] = [];
  
  if (recentPrompts.some(p => p.includes("saas") || p.includes("software") || p.includes("tech"))) {
    cards.push("Optimize SaaS Scaling");
  } else {
    cards.push("Business Strategy");
  }
  
  if (recentPrompts.some(p => p.includes("finance") || p.includes("revenue") || p.includes("cash"))) {
    cards.push("Financial Projections");
  } else {
    cards.push("Financial Modeling");
  }
  
  cards.push("Technical Blueprint", "Market Entry Strategy");
  
  return cards.slice(0, 4);
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

// Generate geometric gradient avatar colors
const getAvatarGradient = (email: string) => {
  const hash = email.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
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
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const headerMatch = line.match(/^\[([A-Z_\s]+)\]/);
    if (headerMatch) {
      return (
        <div key={i} className="mt-3 mb-1">
          <span
            className="font-mono text-[11px] font-black tracking-wider"
            style={{ color: "#06b6d4", textShadow: "0 0 8px rgba(6,182,212,0.6)" }}
          >
            [{headerMatch[1]}]
          </span>
          <span className="text-[11px] ml-1" style={{ color: "rgba(255,255,255,0.8)" }}>
            {line.slice(headerMatch[0].length)}
          </span>
        </div>
      );
    }
    if (line.trim().startsWith("- ") || line.trim().startsWith("• ")) {
      return (
        <div key={i} className="flex gap-2 ml-2 my-0.5">
          <span style={{ color: "#06b6d4" }}>›</span>
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>
            {line.trim().slice(2)}
          </span>
        </div>
      );
    }
    const numMatch = line.trim().match(/^(\d+[\.\)]) /);
    if (numMatch) {
      return (
        <div key={i} className="flex gap-2 ml-2 my-0.5">
          <span className="font-mono text-[10px] font-bold" style={{ color: "#06b6d4" }}>
            {numMatch[1]}
          </span>
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>
            {line.trim().slice(numMatch[0].length)}
          </span>
        </div>
      );
    }
    if (!line.trim()) return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-[11px] my-0.5" style={{ color: "rgba(255,255,255,0.75)" }}>
        {line}
      </p>
    );
  });
};

// Generate fallback structural outline
const generateFallbackOutline = (prompt: string): string => {
  const words = prompt.split(" ").slice(0, 10).join(" ");
  return `[Neural Architect: Connection Delayed]\n\nBased on: "${words}...", the blueprint is being generated. Please check your connection or try again.\n\nPreliminary Structure:\n• Market Analysis\n• Operational Framework\n• Financial Architecture\n• Growth Strategy\n\nReconnect to receive the complete AI-powered strategic plan.`;
};

// ─── Folder View Components (Trash & Archives) ────────────────────────────────────

// TrashView Component - Shows deleted items with permanent wipe and restore
const TrashView = ({ missions, onRestore, onPermanentDelete }: { 
  missions: Mission[]; 
  onRestore: (mission: Mission) => void; 
  onPermanentDelete: (missionId: string) => void;
}) => {
  const trashedMissions = missions.filter(m => m.status === "trashed");
  
  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto flex-1 overflow-y-auto pt-8 pb-8 px-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter font-mono bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
          TRASH
        </h1>
        <p className="text-[8px] tracking-[0.3em] uppercase font-mono text-white/30 mt-2">
          PERMANENT DELETION ZONE // 30 DAY RETENTION
        </p>
      </div>
      
      {trashedMissions.length === 0 ? (
        <div className="text-center py-20">
          <Trash2 size={48} className="mx-auto text-white/10 mb-4" />
          <p className="text-[11px] font-mono text-white/30">Trash is empty</p>
        </div>
      ) : (
        <div className="space-y-2">
          {trashedMissions.map((mission) => (
            <motion.div
              key={mission.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-red-500/10">
                <Trash2 size={14} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate text-white/80">
                  {mission.prompt?.slice(0, 80) || "Untitled"}
                </p>
                <p className="text-[9px] font-mono mt-1 text-white/30">
                  {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onRestore(mission)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all"
                >
                  Restore
                </button>
                <button
                  onClick={() => onPermanentDelete(mission.id)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-all"
                >
                  Wipe
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

// ArchivesView Component - Shows archived items with vault-like aesthetic
const ArchivesView = ({ missions, onRestore }: { 
  missions: Mission[]; 
  onRestore: (mission: Mission) => void;
}) => {
  const archivedMissions = missions.filter(m => m.status === "archived");
  
  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto flex-1 overflow-y-auto pt-8 pb-8 px-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter font-mono bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
          ARCHIVES
        </h1>
        <p className="text-[8px] tracking-[0.3em] uppercase font-mono text-white/30 mt-2">
          SECURE VAULT // COLD STORAGE
        </p>
      </div>
      
      {archivedMissions.length === 0 ? (
        <div className="text-center py-20">
          <Archive size={48} className="mx-auto text-white/10 mb-4" />
          <p className="text-[11px] font-mono text-white/30">Archive is empty</p>
        </div>
      ) : (
        <div className="space-y-2">
          {archivedMissions.map((mission) => (
            <motion.div
              key={mission.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-indigo-500/10">
                <Archive size={14} className="text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate text-white/80">
                  {mission.prompt?.slice(0, 80) || "Untitled"}
                </p>
                <p className="text-[9px] font-mono mt-1 text-white/30">
                  {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
                </p>
              </div>
              <button
                onClick={() => onRestore(mission)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all"
              >
                Restore to Home
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

// SettingsView Component - Neural Custom Theme & Connected Apps
const SettingsView = ({ customPalette, setCustomPalette, auraProfile, updateAuraProfile, resetAuraToDefault, toggleLightMode, userContext, setUserContext }: {
  customPalette: CustomPalette;
  setCustomPalette: (palette: CustomPalette) => void;
  auraProfile: AuraProfile;
  updateAuraProfile: (updates: Partial<AuraProfile>) => void;
  resetAuraToDefault: () => void;
  toggleLightMode: () => void;
  userContext: UserContext;
  setUserContext: (context: UserContext) => void;
}) => {
  const [neuralCustomActive, setNeuralCustomActive] = useState(false);
  
  return (
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
            className="text-5xl font-black uppercase tracking-tighter font-mono"
            style={{
              background: `linear-gradient(135deg, ${neuralCustomActive ? customPalette.glow : auraProfile.glowPrimary}, ${auraProfile.glowSecondary})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            NEURAL CUSTOM
          </h1>
          <p className="text-[10px] tracking-[0.3em] uppercase font-mono text-white/40 mt-3">
            THEME STUDIO // CONNECTED APPS
          </p>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {/* Neural Custom Toggle */}
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl flex items-center justify-between"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <div className="flex items-center gap-3">
              <Palette size={18} style={{ color: neuralCustomActive ? customPalette.glow : auraProfile.glowPrimary }} />
              <div>
                <div className="text-sm font-semibold font-mono">Neural Custom Theme</div>
                <div className="text-[9px] font-mono text-white/40">Override default Aura design</div>
              </div>
            </div>
            <Switch checked={neuralCustomActive} onCheckedChange={setNeuralCustomActive} />
          </motion.div>

          {/* Theme Inputs - Only show when Neural Custom is active */}
          {neuralCustomActive && (
            <>
              <motion.div
                variants={itemVariants}
                className="md:col-span-2 p-5 rounded-xl"
                style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
              >
                <h3
                  className="text-sm font-semibold mb-3 flex items-center gap-2 font-mono"
                  style={{ color: customPalette.glow }}
                >
                  <Sliders size={16} /> CHROMATIC CONTROLS
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-mono block mb-1 text-white/40">GLOW COLOR</label>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-10 h-10 rounded-xl"
                        style={{ background: customPalette.glow, boxShadow: `0 0 15px ${customPalette.glow}` }}
                      />
                      <input
                        type="color"
                        value={customPalette.glow}
                        onChange={(e) => setCustomPalette({ ...customPalette, glow: e.target.value })}
                        className="w-16 h-9 rounded bg-transparent border border-white/20 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={customPalette.glow}
                        onChange={(e) => setCustomPalette({ ...customPalette, glow: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10 font-mono"
                        style={{ color: "var(--nazai-text-color)" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-mono block mb-1 text-white/40">BACKGROUND COLOR</label>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-10 h-10 rounded-xl"
                        style={{ background: customPalette.bg }}
                      />
                      <input
                        type="color"
                        value={customPalette.bg}
                        onChange={(e) => setCustomPalette({ ...customPalette, bg: e.target.value })}
                        className="w-16 h-9 rounded bg-transparent border border-white/20 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={customPalette.bg}
                        onChange={(e) => setCustomPalette({ ...customPalette, bg: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10 font-mono"
                        style={{ color: "var(--nazai-text-color)" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-mono block mb-1 text-white/40">BACKGROUND TYPE</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCustomPalette({ ...customPalette, bgType: "color" })}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all ${customPalette.bgType === "color" ? "bg-white/20" : "bg-white/5"}`}
                      >
                        Color
                      </button>
                      <button
                        onClick={() => setCustomPalette({ ...customPalette, bgType: "gradient" })}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all ${customPalette.bgType === "gradient" ? "bg-white/20" : "bg-white/5"}`}
                      >
                        Gradient
                      </button>
                      <button
                        onClick={() => setCustomPalette({ ...customPalette, bgType: "image" })}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all ${customPalette.bgType === "image" ? "bg-white/20" : "bg-white/5"}`}
                      >
                        Image
                      </button>
                    </div>
                  </div>
                  {customPalette.bgType === "image" && (
                    <div>
                      <label className="text-[9px] font-mono block mb-1 text-white/40">BACKGROUND IMAGE URL</label>
                      <input
                        type="text"
                        value={customPalette.bgImage}
                        onChange={(e) => setCustomPalette({ ...customPalette, bgImage: e.target.value })}
                        placeholder="https://example.com/image.jpg"
                        className="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 font-mono"
                        style={{ color: "var(--nazai-text-color)" }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            </>
          )}

          {/* Aura Studio Section (Always visible) */}
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2 font-mono"
              style={{ color: auraProfile.glowPrimary }}
            >
              <Palette size={16} /> AURA STUDIO
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
                    className="w-16 h-9 rounded bg-transparent border border-white/20 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={auraProfile.glowPrimary}
                    onChange={(e) => updateAuraProfile({ glowPrimary: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10 font-mono"
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
                    className="w-16 h-9 rounded bg-transparent border border-white/20 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={auraProfile.glowSecondary}
                    onChange={(e) => updateAuraProfile({ glowSecondary: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded text-xs bg-white/5 border border-white/10 font-mono"
                    style={{ color: "var(--nazai-text-color)" }}
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">TEXT GLOW INTENSITY</label>
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
                <label className="text-[9px] font-mono block mb-1 text-white/40">GLASS BLUR</label>
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
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10">
              <div className="flex items-center gap-2">
                {auraProfile.isLightMode ? <Sun size={16} /> : <Moon size={16} />}
                <span className="text-[10px] font-mono">Light Mode</span>
              </div>
              <Switch checked={auraProfile.isLightMode} onCheckedChange={toggleLightMode} />
            </div>
          </motion.div>

          {/* Connected Apps Grid - Responsive: 1 column on mobile, 2 on tablet, 4 on desktop */}
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl overflow-x-hidden w-full"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2 font-mono"
              style={{ color: neuralCustomActive ? customPalette.glow : auraProfile.glowPrimary }}
            >
              <Database size={16} /> CONNECTED APPS
            </h3>
            {/* Responsive grid: 1 column on mobile, 2 on tablet, 4 on desktop - NO OVERFLOW */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full mx-auto overflow-x-hidden">
              {/* GitHub */}
              <div className="p-3 rounded-xl text-center transition-all hover:scale-105 w-full" style={{ background: "#24292e", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Github size={24} className="mx-auto mb-2 text-white" />
                <p className="text-[10px] font-mono font-bold text-white">GitHub</p>
                <p className="text-[8px] text-white/50">Connected</p>
              </div>
              {/* Vercel */}
              <div className="p-3 rounded-xl text-center transition-all hover:scale-105 w-full" style={{ background: "#000000", border: "1px solid rgba(255,255,255,0.1)" }}>
                <svg className="w-6 h-6 mx-auto mb-2 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2z"/></svg>
                <p className="text-[10px] font-mono font-bold text-white">Vercel</p>
                <p className="text-[8px] text-white/50">Connected</p>
              </div>
              {/* Google Cloud */}
              <div className="p-3 rounded-xl text-center transition-all hover:scale-105 w-full" style={{ background: "#4285F4", border: "1px solid rgba(255,255,255,0.1)" }}>
                <svg className="w-6 h-6 mx-auto mb-2 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
                <p className="text-[10px] font-mono font-bold text-white">Google Cloud</p>
                <p className="text-[8px] text-white/50">Connected</p>
              </div>
              {/* OpenAI */}
              <div className="p-3 rounded-xl text-center transition-all hover:scale-105 w-full" style={{ background: "#10a37f", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Brain size={24} className="mx-auto mb-2 text-white" />
                <p className="text-[10px] font-mono font-bold text-white">OpenAI</p>
                <p className="text-[8px] text-white/50">Connected</p>
              </div>
            </div>
          </motion.div>

          {/* Personal Context Section */}
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 flex items-center gap-2 font-mono"
              style={{ color: neuralCustomActive ? customPalette.glow : auraProfile.glowPrimary }}
            >
              <User size={16} /> NEURAL CONTEXT
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">IDENTITY</label>
                <input
                  type="text"
                  value={userContext.identity}
                  onChange={(e) => setUserContext({ ...userContext, identity: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 font-mono"
                  style={{ color: "var(--nazai-text-color)" }}
                />
              </div>
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">PROJECT GOALS</label>
                <input
                  type="text"
                  value={userContext.goals}
                  onChange={(e) => setUserContext({ ...userContext, goals: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 font-mono"
                  style={{ color: "var(--nazai-text-color)" }}
                />
              </div>
              <div>
                <label className="text-[9px] font-mono block mb-1 text-white/40">INTERACTION STYLE</label>
                <select
                  value={userContext.style}
                  onChange={(e) => setUserContext({ ...userContext, style: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 font-mono"
                  style={{ color: "var(--nazai-text-color)" }}
                >
                  <option value="Perspective, accurate, direct Yes-man/No-man">Yes-man/No-man (Balanced)</option>
                  <option value="Direct, concise, technical">Direct & Technical</option>
                  <option value="Supportive, encouraging, constructive">Supportive & Constructive</option>
                  <option value="Challenging, critical, stress-testing">Challenging & Critical</option>
                </select>
              </div>
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="md:col-span-2">
            <motion.button
              onClick={resetAuraToDefault}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
              style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}
              whileHover={{ scale: 1.01, background: "rgba(239,68,68,0.1)" }}
              whileTap={{ scale: 0.99 }}
            >
              <RotateCcw size={14} /> RESET AURA TO DEFAULT
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
};

// Message Action Bar Component
const MessageActionBar = ({ message, index, handleCopyMessage, handleRegenerateMessage, handleShareMessage, openRevertModal, revertDropdownOpen, setRevertDropdownOpen }: { 
  message: { role: string; text: string }; 
  index: number;
  handleCopyMessage: (text: string) => void;
  handleRegenerateMessage: (index: number) => void;
  handleShareMessage: (text: string) => void;
  openRevertModal: (index: number) => void;
  revertDropdownOpen: number | null;
  setRevertDropdownOpen: (index: number | null) => void;
}) => {
  if (message.role !== "ai") return null;
  
  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => handleCopyMessage(message.text)}
        className="p-1.5 rounded-md hover:bg-white/10 transition-all"
        title="Copy"
      >
        <Copy size={12} className="text-white/40" />
      </button>
      <button
        onClick={() => handleRegenerateMessage(index)}
        className="p-1.5 rounded-md hover:bg-white/10 transition-all"
        title="Regenerate"
      >
        <RotateCw size={12} className="text-white/40" />
      </button>
      <button
        onClick={() => handleShareMessage(message.text)}
        className="p-1.5 rounded-md hover:bg-white/10 transition-all"
        title="Share"
      >
        <Share2 size={12} className="text-white/40" />
      </button>
      <div className="relative">
        <button
          onClick={() => setRevertDropdownOpen(revertDropdownOpen === index ? null : index)}
          className="p-1.5 rounded-md hover:bg-white/10 transition-all"
          title="More options"
        >
          <MoreHorizontal size={12} className="text-white/40" />
        </button>
        <AnimatePresence>
          {revertDropdownOpen === index && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute bottom-full left-0 mb-1 w-44 rounded-lg overflow-hidden z-50"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
            >
              <button
                onClick={() => openRevertModal(index)}
                className="w-full px-3 py-2 text-left text-xs hover:bg-white/5 transition-all flex items-center gap-2"
              >
                <RotateCcw size={12} /> Revert to checkpoint
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

// Revert Checkpoint Modal with backdrop-blur-xl
const RevertModal = ({ revertModalOpen, setRevertModalOpen, confirmRevert }: {
  revertModalOpen: boolean;
  setRevertModalOpen: (open: boolean) => void;
  confirmRevert: () => void;
}) => (
  <AnimatePresence>
    {revertModalOpen && (
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl"
        onClick={() => setRevertModalOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={springTransition}
          onClick={(e) => e.stopPropagation()}
          className="max-w-sm w-full rounded-xl p-6 text-center"
          style={{
            background: "var(--nazai-card-bg)",
            border: `1px solid rgba(34,197,94,0.2)`,
          }}
        >
          <div className="mb-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}
            >
              <RotateCcw size={20} style={{ color: "#22c55e" }} />
            </div>
            <h3 className="text-sm font-bold font-mono mb-2" style={{ color: "var(--nazai-text-color)" }}>
              Revert to Checkpoint?
            </h3>
            <p className="text-[11px] text-white/50">
              All subsequent progress after this point will be lost. This action cannot be undone.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setRevertModalOpen(false)}
              className="flex-1 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={confirmRevert}
              className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all"
              style={{
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                color: "#22c55e",
              }}
            >
              OK
            </button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

// ============================================================
// MODE INFO MODAL COMPONENT
// ============================================================
const ModeInfoModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
  <AnimatePresence>
    {isOpen && (
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={springTransition}
          onClick={(e) => e.stopPropagation()}
          className="max-w-md w-full rounded-xl p-6"
          style={{
            background: "var(--nazai-card-bg)",
            border: "1px solid rgba(6,182,212,0.3)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold font-mono text-cyan-400">PROMPTING MODES</h3>
            <button onClick={onClose} className="text-white/40 hover:text-white/80">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-4 text-xs font-mono text-white/70">
            <div className="border-l-2 border-cyan-400 pl-3">
              <span className="text-cyan-400 font-bold">SANDBOX</span>
              <p className="text-[10px] mt-1">General purpose prompting. Your input is wrapped in a Founder Persona context for strategic business blueprinting.</p>
            </div>
            <div className="border-l-2 border-purple-400 pl-3">
              <span className="text-purple-400 font-bold">EXTRACTOR</span>
              <p className="text-[10px] mt-1">Structured input mode. Fill in Industry, Audience, Budget, and Vibe to generate a comprehensive business blueprint with market analysis, financial roadmap, and growth strategy.</p>
            </div>
            <div className="border-l-2 border-emerald-400 pl-3">
              <span className="text-emerald-400 font-bold">BLUEPRINT</span>
              <p className="text-[10px] mt-1">Template-based mode. Select a template (SaaS, Agency, E‑com), then edit the generated prompt in the code editor before launching. Perfect for reusable strategies.</p>
            </div>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

// ─── HOME VIEW WITH ENHANCED PROMPT CARDS (SANDBOX ONLY) ──────────────────────────
const HomeView = ({ 
  errorMessage, messages, activeTool, initialCards, auraProfile, currentTheme, isPending,
  handleSendMessage, handleKeyDown, handleTextareaFocus, handleTextareaBlur, handleSendPointerDown,
  setSelectedModel, setPlusMenuOpen, setDrawerOpen, textareaRef, inputContainerRef, messagesEndRef,
  formatAIResponse, getRgbFromHex, laserShineAnimation, userMissionAssets, setUserMissionAssets,
  activeAssetIndex, setActiveAssetIndex, isDragOver, setIsDragOver, revertDropdownOpen, setRevertDropdownOpen,
  openRevertModal, handleCopyMessage, handleRegenerateMessage, handleShareMessage, confirmRevert, revertModalOpen, setRevertModalOpen,
  onOpenThinkTank,
  promptMode, setPromptMode,
  sandboxText, setSandboxText,
  extractorData, setExtractorData,
  editablePrompt, setEditablePrompt,
  selectedTemplate, setSelectedTemplate,
  fileInputRef,
  cameraInputRef,
}: any) => {
  // Template definitions (master templates - never mutated)
  const TEMPLATE_MASTERS = {
    saas: "Build a complete SaaS launch blueprint for [INDUSTRY]. Target audience: [AUDIENCE]. Budget: [BUDGET]. Vibe: [VIBE].\n\nRequired deliverables:\n• Pricing strategy with tier breakdown\n• Feature roadmap (MVP → v2 → v3)\n• Customer acquisition plan\n• 12-month financial projection\n• Team structure recommendations",
    agency: "Create a service agency blueprint for [INDUSTRY]. Target clients: [AUDIENCE]. Budget: [BUDGET]. Brand vibe: [VIBE].\n\nRequired deliverables:\n• Service package definitions\n• Team structure & hiring plan\n• Lead generation system\n• Monthly revenue targets\n• Operational workflows",
    ecom: "Develop an e‑commerce launch plan for [INDUSTRY]. Target shoppers: [AUDIENCE]. Budget: [BUDGET]. Brand vibe: [VIBE].\n\nRequired deliverables:\n• Platform selection criteria\n• Supply chain setup\n• Marketing funnel strategy\n• Cash flow projections\n• Inventory management system",
  };

  // Helper to fill template with current extractor data
  const fillTemplate = (templateId: string) => {
    const template = TEMPLATE_MASTERS[templateId as keyof typeof TEMPLATE_MASTERS];
    if (!template) return "";
    let filled = template;
    filled = filled.replace(/\[INDUSTRY\]/g, extractorData.industry || "[Industry]");
    filled = filled.replace(/\[AUDIENCE\]/g, extractorData.audience || "[Audience]");
    filled = filled.replace(/\[BUDGET\]/g, extractorData.budget || "[Budget]");
    filled = filled.replace(/\[VIBE\]/g, extractorData.vibe);
    return filled;
  };

  // Handle template selection - populates editablePrompt (does NOT send)
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    const filledContent = fillTemplate(templateId);
    setEditablePrompt(filledContent);
  };

  // Update extractor data and refresh blueprint preview if a template is selected
  const updateExtractorData = (field: string, value: string) => {
    setExtractorData((prev: any) => ({ ...prev, [field]: value }));
    if (selectedTemplate) {
      const refreshed = fillTemplate(selectedTemplate);
      setEditablePrompt(refreshed);
    }
  };

  // Prompt strength for extractor
  const completedFields = [extractorData.industry, extractorData.audience, extractorData.budget].filter(Boolean).length;
  const strength = Math.floor((completedFields / 3) * 100);
  
  // Info modal state
  const [infoModalOpen, setInfoModalOpen] = useState(false);

  // Determine if cards should be visible (only in sandbox mode AND no messages)
  const showPromptCards = messages.length === 0 && promptMode === "sandbox";
  const isExpandedMode = promptMode === "extractor" || promptMode === "blueprint";

  return (
    <div className="relative flex flex-col w-full h-full">
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
      <div className="flex-1 w-full max-w-3xl mx-auto overflow-y-auto py-6 space-y-4 px-4 pb-[140px]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-start min-h-full gap-6 text-center pt-8">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full animate-pulse"
                style={{
                  boxShadow: `0 0 30px rgba(6, 182, 212, 0.6)`,
                  background: "radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%)",
                }}
              />
              <div className="w-16 h-16 rounded-full border-2 border-cyan-500/50 flex items-center justify-center relative bg-cyan-500/5">
                <div
                  className="absolute inset-0 rounded-full animate-ping opacity-75"
                  style={{ background: "rgba(6, 182, 212, 0.3)" }}
                />
                <div
                  className="w-3 h-3 rounded-full bg-cyan-500 animate-pulse"
                  style={{ boxShadow: "0 0 10px #06b6d4" }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <p
                className="text-sm font-mono tracking-wide text-white font-bold"
                style={{
                  textShadow: "0 0 15px rgba(6, 182, 212, 0.8)",
                  color: "#e2e8f0",
                }}
              >
                THE NEURAL ARCHITECT
              </p>
              <p className="text-[10px] font-mono text-cyan-400/60 tracking-wider">
                High-precision business blueprinting engine
              </p>
            </div>

            {/* Command Center checklist */}
            <div className="w-full mt-4">
              <CommandCenterChecklist />
            </div>
          </div>
        )}
        {messages.map((msg: any, i: number) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} group`}
          >
            {msg.role === "user" ? (
              <div
                className="max-w-[78%] px-3 py-2 text-xs font-mono"
                style={{
                  borderRadius: "12px 12px 2px 12px",
                  background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.05)`,
                  border: `1px solid var(--nazai-border-light)`,
                  color: "var(--nazai-text-color)",
                }}
              >
                {msg.text}
              </div>
            ) : (
              <>
                <div
                  className="max-w-[85%] rounded-xl overflow-hidden"
                  style={{ background: "#0B1F3A", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <div
                    className="flex items-center gap-2 px-3 py-2"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(6,182,212,0.03)" }}
                  >
                    <Brain size={12} style={{ color: "#06b6d4" }} />
                    <span
                      className="text-[9px] font-mono font-bold tracking-wider"
                      style={{ color: "#06b6d4", textShadow: "0 0 6px rgba(6,182,212,0.4)" }}
                    >
                      NEURAL ARCHITECT // MISSION_RESULT.LOG
                    </span>
                  </div>
                  <div className="px-3 py-2.5">{formatAIResponse(msg.text)}</div>
                </div>
                <MessageActionBar 
                  message={msg} 
                  index={i} 
                  handleCopyMessage={handleCopyMessage}
                  handleRegenerateMessage={handleRegenerateMessage}
                  handleShareMessage={handleShareMessage}
                  openRevertModal={openRevertModal}
                  revertDropdownOpen={revertDropdownOpen}
                  setRevertDropdownOpen={setRevertDropdownOpen}
                />
              </>
            )}
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Selected Engine Badge */}
      {activeTool && (
        <div className="w-full max-w-2xl mx-auto mb-2 flex justify-end px-4 relative z-[101]">
          <span
            className="text-[9px] px-2 py-1 rounded-full flex items-center gap-1 font-mono"
            style={{
              background: `rgba(${activeTool.category.glowRgba},0.1)`,
              border: `1px solid rgba(${activeTool.category.glowRgba},0.2)`,
              color: activeTool.category.color,
            }}
          >
            {activeTool.tool.name}{" "}
            <X
              size={10}
              className="cursor-pointer hover:opacity-70 transition-opacity"
              onClick={() => setSelectedModel(null)}
            />
          </span>
        </div>
      )}

      {/* ─── ENHANCED PROMPT CARDS - ONLY VISIBLE IN SANDBOX MODE ─── */}
      {/* Cards float 20px higher with cyan glow, disappear smoothly when switching modes */}
      <div 
        className="absolute left-1/2 z-40 w-full max-w-2xl"
        style={{ 
          bottom: "140px",
          pointerEvents: "none",
          transform: "translateX(calc(-50% - 24px))",
        }}
      >
        <div className="w-full px-4">
          <AnimatePresence mode="wait">
            {showPromptCards && (
              <motion.div
                key="prompt-cards"
                initial={{ opacity: 1, y: 0, scale: 1 }}
                animate={{ 
                  opacity: 1, 
                  y: -20,  // Shift 20px higher so they don't look "sunk" into the input box
                  scale: 1,
                }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="origin-bottom"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {initialCards.slice(0, 2).map((card: string, idx: number) => (
                    <motion.button
                      key={idx}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1 + idx * 0.08 }}
                      onClick={() => handleSendMessage(card)}
                      className="group relative p-5 rounded-2xl text-left transition-all duration-300 overflow-hidden cursor-pointer"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        backdropFilter: "blur(16px)",
                        pointerEvents: "auto",
                        boxShadow: "0 0 15px rgba(6,182,212,0.2)",  // Subtle cyan glow
                      }}
                      whileHover={{ 
                        y: -4,
                        backgroundColor: "rgba(255,255,255,0.06)",
                        borderColor: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.5)`,
                        boxShadow: `0 0 25px rgba(6,182,212,0.3)`
                      }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-white/[0.02] pointer-events-none" />
                      <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2">
                          <div 
                            className="w-1.5 h-1.5 rounded-full animate-pulse" 
                            style={{ backgroundColor: auraProfile.glowPrimary }} 
                          />
                          <p className="text-[9px] font-mono font-black uppercase tracking-[0.2em]" style={{ color: auraProfile.glowPrimary }}>
                            INITIATE MISSION
                          </p>
                        </div>
                        <p className="text-[14px] font-bold leading-tight text-white/90 group-hover:text-white transition-colors line-clamp-2">
                          {card}
                        </p>
                        <div className="flex items-center gap-1 mt-3 text-[8px] font-mono font-bold text-white/30 group-hover:text-white/60 transition-all">
                          <span>DEPLOY MODULE</span>
                          <ChevronRight size={10} style={{ color: auraProfile.glowPrimary }} />
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── ADAPTIVE WORKBENCH INPUT CONTAINER WITH HEIGHT ANIMATION ─── */}
      <div
        ref={inputContainerRef}
        className="fixed bottom-4 left-1/2 z-40 w-[94%] sm:w-full sm:max-w-2xl -translate-x-1/2"
        style={{
          pointerEvents: "auto",
          isolation: "isolate",
        }}
      >
        <div className="w-full px-0 sm:px-4">
          <motion.div
            className="relative rounded-2xl flex flex-col overflow-hidden shadow-2xl"
            animate={{
              ...laserShineAnimation,
              minHeight: isExpandedMode ? "280px" : "auto",
            }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length === 0) return;
              const newAssets = files.map((file) => ({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                url: URL.createObjectURL(file),
                name: file.name,
              }));
              setUserMissionAssets((prev: any[]) => {
                const next = [...prev, ...newAssets];
                setActiveAssetIndex(next.length - newAssets.length);
                return next;
              });
            }}
            style={{
              border: `1px solid ${
                isDragOver
                  ? auraProfile.glowPrimary
                  : `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.25)`
              }`,
              boxShadow: isDragOver
                ? `0 0 24px ${auraProfile.glowPrimary}55, inset 0 0 24px ${auraProfile.glowPrimary}22`
                : undefined,
              background: "rgba(10, 14, 23, 0.95)",
              backdropFilter: "blur(20px)",
              transition: "border-color 180ms ease, box-shadow 220ms ease, min-height 350ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <DropScanOverlay count={userMissionAssets.length} color={auraProfile.glowPrimary} />

            {/* Mode Switcher with Icon Toggle & Info Button */}
            <div className="flex justify-between items-center pt-4 px-4">
              <div className="relative flex bg-black/40 backdrop-blur-md rounded-full p-1 border border-white/10">
                <motion.div
                  className="absolute top-1 bottom-1 rounded-full bg-cyan-500/20"
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  style={{ width: `${100 / 3}%`, left: promptMode === "sandbox" ? "0%" : promptMode === "extractor" ? "33.33%" : "66.66%" }}
                />
                {["sandbox", "extractor", "blueprint"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { 
                      setPromptMode(mode); 
                      if (mode !== "blueprint") setSelectedTemplate(null);
                    }}
                    className={`relative z-10 px-4 py-1.5 text-[10px] font-mono font-bold tracking-wider rounded-full transition-colors flex items-center gap-1.5 ${
                      promptMode === mode ? "text-cyan-400" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {mode === "sandbox" && <Terminal size={10} />}
                    {mode === "extractor" && <Layers size={10} />}
                    {mode === "blueprint" && <FileCode size={10} />}
                    {mode === "sandbox" ? "SANDBOX" : mode === "extractor" ? "EXTRACTOR" : "BLUEPRINT"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setInfoModalOpen(true)}
                className="text-white/30 hover:text-cyan-400 transition-colors p-1 rounded-lg hover:bg-white/5"
                title="Info about prompting modes"
              >
                <Info size={14} />
              </button>
            </div>

            {/* Dynamic Content with Height Animation */}
            <AnimatePresence mode="wait">
              {promptMode === "sandbox" && (
                <motion.div
                  key="sandbox"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="px-4 pt-3 pb-2 overflow-hidden"
                >
                  <textarea
                    ref={textareaRef}
                    value={sandboxText}
                    onChange={(e) => setSandboxText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={handleTextareaFocus}
                    onBlur={handleTextareaBlur}
                    placeholder="Describe your business vision, challenge, or opportunity..."
                    rows={3}
                    className="w-full bg-black/30 backdrop-blur-sm rounded-xl border border-white/10 focus:border-cyan-500/50 outline-none p-3 text-sm font-mono resize-none"
                    style={{ color: "var(--nazai-text-color)" }}
                  />
                  <div className="text-[9px] font-mono text-white/30 text-right mt-1">Founder Persona context will be applied automatically</div>
                </motion.div>
              )}

              {promptMode === "extractor" && (
                <motion.div
                  key="extractor"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="px-4 pt-3 pb-2 space-y-3 overflow-hidden"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Industry / Sector"
                      value={extractorData.industry}
                      onChange={(e) => updateExtractorData("industry", e.target.value)}
                      className="bg-black/30 backdrop-blur-sm rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                    />
                    <input
                      type="text"
                      placeholder="Target Audience"
                      value={extractorData.audience}
                      onChange={(e) => updateExtractorData("audience", e.target.value)}
                      className="bg-black/30 backdrop-blur-sm rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                    />
                    <input
                      type="text"
                      placeholder="Estimated Budget (USD)"
                      value={extractorData.budget}
                      onChange={(e) => updateExtractorData("budget", e.target.value)}
                      className="bg-black/30 backdrop-blur-sm rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                    />
                    <select
                      value={extractorData.vibe}
                      onChange={(e) => updateExtractorData("vibe", e.target.value)}
                      className="bg-black/30 backdrop-blur-sm rounded-lg border border-white/10 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                    >
                      <option value="Formal">Formal / Corporate</option>
                      <option value="Cyberpunk">Cyberpunk / Edgy</option>
                      <option value="Minimalist">Minimalist / Clean</option>
                      <option value="Bold">Bold / Disruptive</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-cyan-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${strength}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-white/40">
                      <span>Blueprint Strength</span>
                      <span>{strength}% complete</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {promptMode === "blueprint" && (
                <motion.div
                  key="blueprint"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="px-4 pt-3 pb-2 space-y-3 overflow-hidden"
                >
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {Object.entries(TEMPLATE_MASTERS).map(([id, _]) => (
                      <button
                        key={id}
                        onClick={() => handleTemplateSelect(id)}
                        className={`shrink-0 px-4 py-2 rounded-xl border transition-all ${
                          selectedTemplate === id
                            ? "border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-500/20"
                            : "border-white/10 bg-black/30 hover:border-cyan-400/50"
                        }`}
                      >
                        <div className="text-sm font-mono font-bold">{id === "saas" ? "SaaS Launcher" : id === "agency" ? "Agency Builder" : "E‑com Engine"}</div>
                        <div className="text-[9px] font-mono text-white/40 mt-0.5">Master Blueprint</div>
                      </button>
                    ))}
                  </div>
                  
                  {/* Editable Blueprint Editor - Code Style with Cyan Glow */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-[9px] font-mono text-cyan-400">EDITABLE MASTER BLUEPRINT</span>
                      <span className="text-[8px] font-mono text-white/30 ml-auto">✎ Elite Mode — Full edit capability</span>
                    </div>
                    <textarea
                      value={editablePrompt}
                      onChange={(e) => setEditablePrompt(e.target.value)}
                      placeholder="Select a template above to start editing your custom blueprint..."
                      rows={8}
                      className="w-full bg-black/50 backdrop-blur-sm rounded-xl border-2 border-cyan-500/40 focus:border-cyan-400 outline-none p-4 text-xs font-mono resize-y transition-all duration-200"
                      style={{ 
                        color: "#a5f3c3",
                        caretColor: "#06b6d4",
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        lineHeight: "1.6",
                        boxShadow: "0 0 20px rgba(6,182,212,0.1)",
                      }}
                    />
                    <div className="text-[8px] font-mono text-white/30 text-right flex items-center justify-end gap-2">
                      <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse rounded-sm" />
                      <span>terminal ready — edit freely • changes stay local</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Asset strip (drag & drop files) */}
            <AnimatePresence>
              {userMissionAssets.length > 0 && (
                <motion.div
                  key="guardian-strip"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springTransition}
                  className="px-3 pt-2 pb-1 flex items-center gap-2 overflow-x-auto"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                >
                  {userMissionAssets.map((asset: any, i: number) => {
                    const isActive = i === activeAssetIndex;
                    return (
                      <motion.div
                        key={asset.id}
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.4, opacity: 0 }}
                        transition={{ ...springTransition, stiffness: 500 }}
                        className="relative shrink-0 rounded-lg overflow-hidden group"
                        style={{
                          width: 44,
                          height: 44,
                          border: `1px solid ${
                            isActive
                              ? auraProfile.glowPrimary
                              : "rgba(255,255,255,0.08)"
                          }`,
                          boxShadow: isActive
                            ? `0 0 10px ${auraProfile.glowPrimary}66`
                            : undefined,
                        }}
                      >
                        <img
                          src={asset.url}
                          alt={asset.name}
                          className="w-full h-full object-cover"
                          style={{ filter: "grayscale(0.5) contrast(1.1)" }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setActiveAssetIndex(
                              (i + 1) % userMissionAssets.length,
                            )
                          }
                          title="Cycle vibe-matched asset"
                          className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Wand2
                            size={14}
                            style={{ color: auraProfile.glowPrimary }}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUserMissionAssets((prev: any[]) =>
                              prev.filter((a: any) => a.id !== asset.id),
                            );
                            setActiveAssetIndex(0);
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 border border-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={8} className="text-white/70" />
                        </button>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom action bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/5 bg-black/30">
              <div className="flex gap-2">
                <button
                  onClick={() => setPlusMenuOpen(true)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                >
                  <Plus size={14} className="text-white/70" />
                </button>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="text-[10px] px-3 py-1.5 rounded-lg font-mono font-bold tracking-tight transition-all hover:bg-white/10 flex items-center gap-2 border border-white/10 bg-white/5"
                  style={{ color: auraProfile.glowPrimary }}
                >
                  <Brain size={12} />
                  {activeTool ? activeTool.tool.name.toUpperCase() : "SELECT ENGINE"}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    let currentText = "";
                    if (promptMode === "sandbox") currentText = sandboxText;
                    else if (promptMode === "extractor") currentText = `${extractorData.industry} ${extractorData.audience} ${extractorData.budget}`;
                    else if (promptMode === "blueprint") currentText = editablePrompt || selectedTemplate || "";
                    if (currentText.trim()) onOpenThinkTank?.(currentText.trim());
                  }}
                  disabled={isPending}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all bg-cyan-500/10 border border-cyan-500/30 hover:scale-105"
                  title="Run 4-Agent Think Tank"
                >
                  <Brain size={13} className="text-cyan-400" />
                </button>

                <button
                  onPointerDown={handleSendPointerDown}
                  disabled={isPending}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shadow-lg"
                  style={{ background: currentTheme.color }}
                >
                  <Send size={13} style={{ color: "#020617" }} />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
      
      <RevertModal revertModalOpen={revertModalOpen} setRevertModalOpen={setRevertModalOpen} confirmRevert={confirmRevert} />
      <ModeInfoModal isOpen={infoModalOpen} onClose={() => setInfoModalOpen(false)} />
    </div>
  );
};

// Sidebar Content Component (DRY - used for both mobile and desktop)
function SidebarContent({ 
  borderColor, activeNav, showSettings, activeMissionId, handleNavClick, 
  setActiveMissionId, setMessages, textareaRef, setDrawerOpen,
  missionsLoading, openChatFeed, handleLoadMission, openLifecycleModal,
  userEmail, getAvatarGradient, setLogoutModalOpen
}: any) {
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  
  return (
    <>
      {/* Trust Bridge — Back to Landing */}
      <div className="px-3 pt-4 pb-2 shrink-0">
        <a
          href="/"
          className="group flex items-center gap-2 px-2.5 py-2 rounded-lg border border-white/5 bg-white/[0.02] hover:border-[#06b6d4]/40 hover:bg-[#06b6d4]/[0.06] transition-all"
          style={{ opacity: 0.8 }}
          title="Back to Landing"
        >
          <Home
            size={13}
            className="text-white/60 group-hover:text-[#06b6d4] transition-colors"
            style={{ filter: "drop-shadow(0 0 6px transparent)" }}
          />
          <span className="text-[11px] font-medium tracking-wide text-white/60 group-hover:text-white transition-colors">
            Back to Landing
          </span>
        </a>
      </div>

      {/* Brand */}
      <div className="flex items-center gap-2 px-4 pt-2 pb-3 shrink-0">
        <Zap size={16} style={{ color: borderColor }} />
        <span
          className="text-[10px] font-mono font-black tracking-[0.2em]"
          style={{ color: borderColor, textShadow: `0 0 8px ${borderColor}80` }}
        >
          NEURAL://
        </span>
      </div>

      {/* NEW CHAT BUTTON */}
      <div className="px-4 pb-4">
        <button
          onClick={() => {
            setMessages([]);
            setActiveMissionId(null);
            if (textareaRef?.current) textareaRef.current.focus();
            setDrawerOpen(false);
          }}
          className="flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-300 group relative overflow-hidden border border-white/5 bg-white/[0.03] hover:bg-white/[0.06]"
        >
          <div className="absolute inset-0 bg-glow-primary opacity-0 group-hover:opacity-5 transition-opacity" />
          <div className="p-1.5 rounded-lg bg-white/5 group-hover:bg-glow-primary/20 transition-colors">
            <Plus size={16} className="text-white/70 group-hover:text-glow-primary transition-colors" />
          </div>
          <span className="text-[13px] font-semibold text-white/60 group-hover:text-white transition-colors">
            New chat
          </span>
        </button>
      </div>
      
      {/* Home (top nav) */}
      <div className="px-2 pb-2 shrink-0">
        {TOP_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.label.toLowerCase() && !showSettings && !activeMissionId;
          const itemTheme = SECTION_THEMES[item.label];
          return (
            <button
              key={item.label}
              onClick={() => {
                setActiveMissionId(null);
                setMessages([]);
                handleNavClick(item.label);
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all hover:bg-white/[0.04]"
              style={{
                background: isActive ? `${itemTheme.color}15` : "transparent",
              }}
            >
              <Icon size={15} style={{ color: isActive ? itemTheme.color : "rgba(255,255,255,0.5)" }} />
              <span
                className="text-[12px] font-medium"
                style={{ color: isActive ? itemTheme.color : "rgba(255,255,255,0.7)" }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Projects collapsible header */}
      <button
        onClick={() => setProjectsExpanded((v) => !v)}
        className="flex items-center justify-between px-4 py-2 mt-1 mb-1 shrink-0 hover:bg-white/[0.02] transition-all"
      >
        <span className="text-[9px] font-mono font-bold tracking-[0.25em] uppercase text-white/40">Projects</span>
        <ChevronDown
          size={12}
          className="text-white/40 transition-transform"
          style={{ transform: projectsExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
      </button>

      {/* Open Chat Feed */}
      <AnimatePresence initial={false}>
        {projectsExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 min-h-0 overflow-hidden flex flex-col"
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
              {missionsLoading ? (
                <div className="flex justify-center py-6">
                  <div
                    className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: `rgba(${getRgbFromHex(borderColor)},0.4)` }}
                  />
                </div>
              ) : openChatFeed.length === 0 ? (
                <p className="text-[10px] font-mono text-white/25 px-3 py-4 text-center">No chats yet</p>
              ) : (
                openChatFeed.map((mission: Mission) => {
                  const isActive = activeMissionId === mission.id;
                  const title = mission.prompt?.trim().slice(0, 40) || "Untitled";
                  return (
                    <div
                      key={mission.id}
                      onClick={() => handleLoadMission(mission)}
                      className="group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all hover:bg-white/[0.04]"
                      style={{
                        background: isActive ? "rgba(80,200,120,0.12)" : "transparent",
                        boxShadow: isActive
                          ? "inset 0 0 0 1px rgba(80,200,120,0.35), 0 0 12px rgba(80,200,120,0.15)"
                          : "none",
                      }}
                    >
                      <span
                        className="text-[12px] truncate flex-1"
                        style={{
                          color: isActive ? "#50C878" : "rgba(255,255,255,0.75)",
                          textShadow: isActive ? "0 0 6px rgba(80,200,120,0.4)" : "none",
                        }}
                      >
                        {title}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openLifecycleModal(mission);
                        }}
                        className="w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
                        title="Manage"
                      >
                        <MoreHorizontal size={13} className="text-white/60" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Admin Stack: Archives / Trash / Settings + Sign Out */}
      <div
        className="px-2 pt-2 pb-3 shrink-0 space-y-0.5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        {BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            (item.label === "Settings" && showSettings) ||
            (item.label !== "Settings" && activeNav === item.label.toLowerCase() && !showSettings);
          const itemTheme = SECTION_THEMES[item.label];
          return (
            <button
              key={item.label}
              onClick={() => handleNavClick(item.label)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all hover:bg-white/[0.04]"
              style={{
                background: isActive ? `${itemTheme.color}15` : "transparent",
              }}
            >
              <Icon size={14} style={{ color: isActive ? itemTheme.color : "rgba(255,255,255,0.45)" }} />
              <span
                className="text-[11px] font-medium"
                style={{ color: isActive ? itemTheme.color : "rgba(255,255,255,0.6)" }}
              >
                {item.label}
              </span>
            </button>
          );
        })}

        <button
          onClick={() => setLogoutModalOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all hover:bg-red-500/10 mt-1"
        >
          <LogOut size={14} className="text-white/40" />
          <span className="text-[11px] font-medium text-white/60">Sign Out</span>
          {userEmail && (
            <div
              className="ml-auto w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold overflow-hidden"
              style={{ background: getAvatarGradient(userEmail) }}
            >
              {userEmail[0].toUpperCase()}
            </div>
          )}
        </button>
      </div>
    </>
  );
}

// ─── MAIN DASHBOARD COMPONENT ────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();

  // ─── THE SURGICAL NUKE (V24.1) ───────────────────────────────────────────
  useEffect(() => {
    const clearLogicCachesAndReload = async () => {
      const currentVersion = localStorage.getItem("nazai_version_id");

      if (currentVersion !== DEPLOYMENT_ID) {
        console.log("TITAN: New version detected. Executing surgical cache purge...");
        sessionStorage.clear();

        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }

        if ("caches" in window) {
          const cacheNames = await caches.keys();
          for (const cacheName of cacheNames) {
            await caches.delete(cacheName);
          }
        }

        localStorage.setItem("nazai_version_id", DEPLOYMENT_ID);
        window.location.reload();
      }
    };

    clearLogicCachesAndReload();
  }, []);
  
  // ─── FOCUS HIJACK: Forces input focus when tapping bottom 30% of screen ─────────
  useEffect(() => {
    const forceFocus = (e: TouchEvent | MouseEvent) => {
      const y = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      if (y > window.innerHeight * 0.7) {
        const textarea = document.querySelector("textarea");
        if (textarea) {
          (textarea as HTMLElement).focus();
        }
      }
    };

    const killGhosts = () => {
      const overlays = document.querySelectorAll('.scanlines, .radar-sweep, [class*="fixed"]');
      overlays.forEach((el) => {
        if (!el.contains(document.querySelector("textarea"))) {
          (el as HTMLElement).style.pointerEvents = "none";
        }
      });
    };

    window.addEventListener("touchstart", forceFocus);
    window.addEventListener("mousedown", forceFocus);
    killGhosts();

    return () => {
      window.removeEventListener("touchstart", forceFocus);
      window.removeEventListener("mousedown", forceFocus);
    };
  }, []);

  // ─── 0. VIEWPORT & MECHANICAL ANCHORING ───────────────────────────────────
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // ─── 1. COMPLETE STATE BLOCK (NO DUPLICATES) ──────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string; isSimulation?: boolean }[]>([]);
  const [activeNav, setActiveNav] = useState<string>("home");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [webSearchActive, setWebSearchActive] = useState(false);
  const [activeStyle, setActiveStyle] = useState<Style>("Technical");
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(true);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus>({
    supabase: true,
    vercel: false,
    github: false,
  });
  
  // Checkpoint revert modal state
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertTargetIndex, setRevertTargetIndex] = useState<number | null>(null);
  const [revertDropdownOpen, setRevertDropdownOpen] = useState<number | null>(null);

  // Aura Design System State
  const [auraProfile, setAuraProfile] = useState<AuraProfile>(loadAuraProfile);
  const [showSettings, setShowSettings] = useState(false);

  // Mission Lifecycle Modal State
  const [lifecycleTarget, setLifecycleTarget] = useState<Mission | null>(null);
  const [lifecycleChoice, setLifecycleChoice] = useState<LifecycleAction | null>(null);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [projectsExpanded, setProjectsExpanded] = useState(true);

  // Dynamic cards state
  const [initialCards, setInitialCards] = useState<string[]>([]);
  const [suggestionCards, setSuggestionCards] = useState<string[]>([]);
  
  // ─── Guardian Drop Zone State ────────────────────────────────────────────────
  const [userMissionAssets, setUserMissionAssets] = useState<{ id: string; url: string; name: string }[]>([]);
  const [activeAssetIndex, setActiveAssetIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // ─── Advanced Theme & Apps State ─────────────────────────────────────────────
  const [customPalette, setCustomPalette] = useState<CustomPalette>(DEFAULT_CUSTOM_PALETTE);
  
  // ─── Connected Apps State (Hook Point) ──────────────────────────────────────
  const [proposedApps, setProposedApps] = useState<any[]>([]);
  
  // ─── Identity & Neural Context Logic ────────────────────────────────────────
  const [userContext, setUserContext] = useState<UserContext>(DEFAULT_USER_CONTEXT);

  // ─── ADAPTIVE WORKBENCH STATES ───────────────────────────────────────────────
  const [promptMode, setPromptMode] = useState<"sandbox" | "extractor" | "blueprint">("sandbox");
  const [sandboxText, setSandboxText] = useState("");
  const [extractorData, setExtractorData] = useState({
    industry: "",
    audience: "",
    budget: "",
    vibe: "Formal",
  });
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [editablePrompt, setEditablePrompt] = useState("");

  // ─── Dynamic CSS Variable Injection ──────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nazai-glow", customPalette.glow);
    root.style.setProperty("--nazai-bg", customPalette.bg);
    
    if (customPalette.bgType === "image" && customPalette.bgImage) {
      root.style.setProperty("--nazai-bg-image", `url(${customPalette.bgImage})`);
    } else if (customPalette.bgType === "gradient") {
      root.style.setProperty("--nazai-bg-image", `linear-gradient(135deg, ${customPalette.glow}22, ${customPalette.bg})`);
    } else {
      root.style.setProperty("--nazai-bg-image", "none");
    }
  }, [customPalette]);

  // ─── 2. IDENTITY BRIDGE ───────────────────────────────────────────────────
  useEffect(() => {
    const getInitialSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? null);
        console.log("TITAN: Session Recovered:", session.user.id);
      }
    };
    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("TITAN: Auth Event:", event);
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? null);
      } else {
        setUserId(null);
        setUserEmail(null);
        setMissions([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
  
  // ── Refs ────────────────────────────────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAbortControllerRef = useRef<AbortController | null>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const focusSnapIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Think Tank (4-agent chain) — additive, does not affect mission flow
  const [thinkTankOpen, setThinkTankOpen] = useState(false);
  const [thinkTankDirective, setThinkTankDirective] = useState("");

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
    e.target.classList.remove("animate-shake");

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
  const activeNavItem = NAV_ITEMS.find((n) => n.label.toLowerCase() === activeNav) ?? NAV_ITEMS[0];
  const currentTheme = SECTION_THEMES[activeNav === "home" ? "Home" : activeNav === "trash" ? "Trash" : activeNav === "archives" ? "Archives" : "Home"] ?? getDefaultTheme();

  const filteredMissions = useMemo(() => {
    switch (activeNav) {
      case "trash":
        return missions.filter((m) => m.status === "trashed");
      case "archives":
        return missions.filter((m) => m.status === "archived");
      case "recently":
        return missions.filter((m) => m.status !== "trashed" && m.status !== "archived").slice(0, 10);
      default:
        return missions.filter((m) => m.status !== "trashed");
    }
  }, [activeNav, missions]);

  // Open chat feed shown in the sidebar (excludes archived/trashed)
  const openChatFeed = useMemo(
    () => missions.filter((m) => m.status !== "trashed" && m.status !== "archived"),
    [missions],
  );

  // Update dynamic cards based on missions and messages
  useEffect(() => {
    if (missions.length > 0) {
      setInitialCards(getInitialCards(missions));
    } else {
      setInitialCards(["Strategy Framework", "Financial Architecture", "Market Analysis", "Operational Excellence"]);
    }
  }, [missions]);

  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1]?.role === "ai") {
      const lastResponse = messages[messages.length - 1].text;
      setSuggestionCards(getSuggestionsFromResponse(lastResponse));
    }
  }, [messages]);

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

  // FIXED: fetchMissions with proper select fields including response
  const fetchMissions = useCallback(async () => {
    if (!userId) {
      setMissions([]);
      setMissionsLoading(false);
      return;
    }

    let isMounted = true;
    const abortController = new AbortController();

    try {
      setMissionsLoading(true);
      const { data, error } = await supabase
        .from("missions")
        .select("id, created_at, updated_at, directive, status, user_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (abortController.signal.aborted) return;
      if (error) throw error;

      if (isMounted && data) {
        const mapped: Mission[] = data.map((row: any) => ({
          id: row.id,
          user_id: row.user_id,
          prompt: row.directive ?? "",
          status: (row.status ?? "recently") as MissionStatus,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
        setMissions(mapped);
      }
    } catch (error) {
      console.error("Failed to fetch missions:", error);
      if (isMounted) setMissions([]);
    } finally {
      if (isMounted) setMissionsLoading(false);
    }

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [userId]);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

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
      setActiveNav("settings");
    } else {
      setShowSettings(false);
      setActiveNav(label.toLowerCase());
    }
    // Close mobile sidebar after navigation
    setIsSidebarOpen(false);
  }, []);

  const handleSelectTool = useCallback((id: string) => {
    setSelectedModel(id);
    setDrawerOpen(false);
  }, []);

  // Sign Out Handler
  const handleSignOut = useCallback(() => {
    console.log("SIGN_OUT_EVENT_TRIGGERED");
    setLogoutModalOpen(false);
    supabase.auth.signOut().then(() => {
      navigate("/");
    });
  }, [navigate]);

  // Copy message to clipboard
  const handleCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    const toastEl = document.createElement("div");
    toastEl.textContent = "✓ Copied to clipboard";
    toastEl.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10000;padding:8px 20px;border-radius:8px;font-size:12px;font-family:monospace;font-weight:bold;color:#020617;background:#50C878;box-shadow:0 0 20px rgba(80,200,120,0.5);";
    document.body.appendChild(toastEl);
    setTimeout(() => toastEl.remove(), 2000);
  }, []);

  // Regenerate message
  const handleRegenerateMessage = useCallback(async (index: number) => {
    const userMessageIndex = index - 1;
    if (userMessageIndex >= 0 && messages[userMessageIndex]?.role === "user") {
      const userPrompt = messages[userMessageIndex].text;
      setMessages(prev => {
        const newMessages = prev.slice(0, index);
        newMessages.push({ role: "ai", text: "Neural Architect: Regenerating blueprint..." });
        return newMessages;
      });
      
      const controller = new AbortController();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Connection timeout after 12s")), 12000);
      });
      
      try {
        // Build context-aware system prompt with user context
        const contextPrompt = `[SYSTEM_DIRECTIVE: You are interacting with ${userContext.identity}. Project: ${userContext.goals}. Style: ${userContext.style}. Provide right and perspective responses only. Say "You're completely wrong" if I'm wrong.]\n\nUser Query: ${userPrompt}`;
        
        const result = await Promise.race([
          supabase.functions.invoke("generate-business-plan", {
            body: {
              prompt: contextPrompt,
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
        const outputText = result.data?.plan || result.data?.response || `Blueprint ready for: "${userPrompt}"`;
        
        setMessages(prev => {
          const updated = [...prev];
          if (updated[index]) {
            updated[index] = { ...updated[index], text: outputText };
          }
          return updated;
        });
      } catch (error) {
        console.error("Regeneration error:", error);
        setMessages(prev => {
          const updated = [...prev];
          if (updated[index]) {
            updated[index] = { ...updated[index], text: "SYSTEM ERROR: Regeneration failed.", isSimulation: true };
          }
          return updated;
        });
      }
    }
  }, [messages, selectedModel, activeStyle, webSearchActive, userContext]);

  // Share message
  const handleShareMessage = useCallback((text: string) => {
    if (navigator.share) {
      navigator.share({
        title: "Neural Architect Blueprint",
        text: text,
      }).catch(console.error);
    } else {
      handleCopyMessage(text);
    }
  }, [handleCopyMessage]);

  // Revert to checkpoint
  const openRevertModal = useCallback((index: number) => {
    setRevertTargetIndex(index);
    setRevertModalOpen(true);
    setRevertDropdownOpen(null);
  }, []);

  const confirmRevert = useCallback(() => {
    if (revertTargetIndex !== null) {
      setMessages(prev => prev.slice(0, revertTargetIndex));
      setRevertModalOpen(false);
      setRevertTargetIndex(null);
    }
  }, [revertTargetIndex]);

  // ─── MASTER PROMPT COMPILER (USES EDITABLE PROMPT IN BLUEPRINT MODE) ────────────
  const compileMasterPrompt = useCallback(() => {
    const contextPrefix = `[SYSTEM_DIRECTIVE: You are interacting with ${userContext.identity}. Project: ${userContext.goals}. Style: ${userContext.style}. Provide right and perspective responses only. Say "You're completely wrong" if I'm wrong.]\n\n`;
    
    if (promptMode === "sandbox") {
      const wrapped = `[Founder Persona Context]\nUser Input: ${sandboxText || "No specific input provided."}\n\nGenerate a strategic business blueprint based on this founder perspective. Include market analysis, operational framework, financial architecture, and growth strategy.`;
      return contextPrefix + wrapped;
    }
    
    if (promptMode === "extractor") {
      const { industry, audience, budget, vibe } = extractorData;
      const missing = [];
      if (!industry) missing.push("Industry");
      if (!audience) missing.push("Target Audience");
      if (!budget) missing.push("Budget");
      
      let base = `BUSINESS BLUEPRINT REQUEST\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      base += `INDUSTRY: ${industry || "Not specified"}\n`;
      base += `TARGET AUDIENCE: ${audience || "Not specified"}\n`;
      base += `BUDGET: ${budget || "Not specified"}\n`;
      base += `BRAND VIBE: ${vibe}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (missing.length) {
        base += `[NOTE: Missing fields: ${missing.join(", ")} – please assume reasonable industry standards and provide best-practice recommendations.]\n\n`;
      }
      
      base += `Generate a complete professional business blueprint covering:\n`;
      base += `1. Market Analysis & Opportunity Assessment\n`;
      base += `2. Operational Structure & Resource Planning\n`;
      base += `3. Financial Roadmap & Budget Allocation\n`;
      base += `4. Growth Strategy & Scaling Milestones\n`;
      base += `5. Risk Assessment & Mitigation Tactics\n\n`;
      base += `Provide actionable, specific recommendations tailored to the ${vibe} brand aesthetic.`;
      
      return contextPrefix + base;
    }
    
    if (promptMode === "blueprint") {
      // Use the editable prompt content (user can edit freely)
      const blueprintContent = editablePrompt.trim() || "Generate a professional business blueprint.";
      return contextPrefix + blueprintContent;
    }
    
    return contextPrefix + "Generate a professional business blueprint.";
  }, [promptMode, sandboxText, extractorData, editablePrompt, userContext]);

  // ─── THE TITAN UNIFIED MESSAGE HANDLER ──────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    const masterPrompt = compileMasterPrompt();
    const trimmed = masterPrompt.trim();

    if (isPending || trimmed.length === 0) {
      return;
    }

    if (!userId) {
      console.error("MISSION ABORTED: No User ID found.");
      setErrorMessage("Please sign in to save your progress.");
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

    setErrorMessage(null);
    
    setMessages((prev) => [
      ...prev,
      { role: "user", text: userMessage },
      { role: "ai", text: "Neural Architect: Processing blueprint..." },
    ]);

    let missionToUpdateId = activeMissionId;
    let finalResponseText = "";

    try {
      if (missionToUpdateId) {
        console.log("TITAN: Updating existing mission:", missionToUpdateId);
        await supabase
          .from("missions")
          .update({
            directive: userMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", missionToUpdateId)
          .eq("user_id", userId);
      } else {
        console.log("TITAN: Vaulting new mission for:", userId);
        const { data: savedMission, error: saveError } = await supabase
          .from("missions")
          .insert({
            user_id: userId,
            directive: userMessage,
            status: "recently",
          })
          .select()
          .single();

        if (saveError) throw saveError;

        if (savedMission) {
          console.log("TITAN: Vault Success. ID:", savedMission.id);
          const newMission: Mission = {
            id: savedMission.id,
            user_id: savedMission.user_id,
            prompt: savedMission.directive ?? userMessage,
            status: (savedMission.status ?? "recently") as MissionStatus,
            created_at: savedMission.created_at,
            updated_at: savedMission.updated_at,
          };
          setMissions((prev) => [newMission, ...prev]);
          setActiveMissionId(savedMission.id);
          missionToUpdateId = savedMission.id;
        }
      }
    } catch (err: any) {
      console.error("VAULT SYNC ERROR:", err.message);
    }

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection timeout after 12s")), 12000);
    });

    try {
      const result = (await Promise.race([
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
      ])) as { data: any; error: any };

      if (result.error) throw new Error(result.error.message || "Link Failed");

      const outputText = result.data?.plan || result.data?.response || `Blueprint ready.`;
      finalResponseText = outputText;

      setMessages((prev) => {
        const updated = [...prev];
        if (updated[aiMsgIndex]) {
          updated[aiMsgIndex] = { ...updated[aiMsgIndex], text: outputText };
        }
        return updated;
      });

      if (missionToUpdateId) {
        await supabase
          .from("missions")
          .update({
            updated_at: new Date().toISOString(),
            status: "completed"
          })
          .eq("id", missionToUpdateId)
          .eq("user_id", userId);
        
        fetchMissions();
      }

    } catch (error) {
      console.error("Execution Error:", error);
      finalResponseText = "SYSTEM ERROR: Link failed. Directive stored locally.";
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[aiMsgIndex]) {
          updated[aiMsgIndex] = {
            ...updated[aiMsgIndex],
            text: finalResponseText,
            isSimulation: true,
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
  }, [isPending, messages.length, selectedModel, userId, activeStyle, webSearchActive, activeMissionId, fetchMissions, compileMasterPrompt]);

  // ─── INPUT TRIGGERS ────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const handleSendPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      handleSendMessage();
    },
    [handleSendMessage],
  );

  // ─── THE MANUAL SIDEBAR LIFECYCLE ───────────────────────────────────────────

  const handleUpdateMissionStatus = useCallback(
    async (missionId: string, newStatus: MissionStatus) => {
      if (!userId) return;
      const { error } = await supabase
        .from("missions")
        .update({ status: newStatus })
        .eq("id", missionId)
        .eq("user_id", userId);

      if (!error) {
        setMissions((prev) => prev.map((m) => (m.id === missionId ? { ...m, status: newStatus } : m)));

        if (newStatus === "trashed" && activeMissionId === missionId) {
          setActiveMissionId(null);
          setMessages([]);
        }
      }
    },
    [userId, activeMissionId],
  );

  const handleRestoreMission = useCallback(
    async (mission: Mission) => {
      await handleUpdateMissionStatus(mission.id, "recently");
      if (textareaRef.current) textareaRef.current.value = mission.prompt || "";
      setActiveNav("home");
      setShowSettings(false);
      setIsSidebarOpen(false);

      const toastEl = document.createElement("div");
      toastEl.textContent = "✓ Mission Restored to Feed";
      toastEl.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100;padding:8px 20px;border-radius:8px;font-size:12px;font-family:monospace;font-weight:bold;color:#020617;background:#50C878;box-shadow:0 0 20px rgba(80,200,120,0.5);";
      document.body.appendChild(toastEl);
      setTimeout(() => toastEl.remove(), 2500);
    },
    [handleUpdateMissionStatus],
  );

  const handleDeleteMissionPermanently = useCallback(
    async (missionId: string) => {
      if (!userId) return;
      const { error } = await supabase.from("missions").delete().eq("id", missionId).eq("user_id", userId);
      if (!error) {
        setMissions((prev) => prev.filter((m) => m.id !== missionId));
      }
    },
    [userId],
  );

  const handleLoadMission = useCallback((mission: Mission) => {
    setActiveMissionId(mission.id);
    setActiveNav("home");
    setShowSettings(false);
    setIsSidebarOpen(false);
    setMessages([{ role: "user", text: mission.prompt || "" }]);
    if (mission.response) {
      setMessages(prev => [...prev, { role: "ai", text: mission.response || "" }]);
    }
    if (textareaRef.current) textareaRef.current.value = "";
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);
  
  // ─── Lifecycle modal: open / confirm ─────────────────────────────────────────────
  const openLifecycleModal = useCallback((mission: Mission) => {
    setLifecycleTarget(mission);
    setLifecycleChoice(null);
  }, []);

  const closeLifecycleModal = useCallback(() => {
    setLifecycleTarget(null);
    setLifecycleChoice(null);
  }, []);

  const confirmLifecycleAction = useCallback(async () => {
    if (!lifecycleTarget || !lifecycleChoice || !userId) return;
    const target = lifecycleTarget;
    const action = lifecycleChoice;

    if (action === "removed") {
      const { error } = await supabase.from("missions").delete().eq("id", target.id).eq("user_id", userId);
      if (!error) setMissions((prev) => prev.filter((m) => m.id !== target.id));
    } else {
      const newStatus: MissionStatus = action; // "trashed" | "archived"
      const { error } = await supabase
        .from("missions")
        .update({ status: newStatus })
        .eq("id", target.id)
        .eq("user_id", userId);
      if (!error) {
        setMissions((prev) => prev.map((m) => (m.id === target.id ? { ...m, status: newStatus } : m)));
      }
    }

    if (activeMissionId === target.id) {
      setActiveMissionId(null);
      setMessages([]);
      if (textareaRef.current) textareaRef.current.value = "";
      if (activeNav === "home") {
        setActiveNav("recently");
        setShowSettings(false);
      }
    }

    closeLifecycleModal();
  }, [lifecycleTarget, lifecycleChoice, userId, activeMissionId, activeNav, closeLifecycleModal]);

  // ─── Render Components ──────────────────────────────────────────────────────────

  const renderNavItem = useCallback(
    (item: (typeof NAV_ITEMS)[number]) => {
      const Icon = item.icon;
      const isActive = activeNav === item.label.toLowerCase() && !showSettings;
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
    },
    [activeNav, showSettings, handleNavClick],
  );

  const renderMissionItem = useCallback(
    (mission: Mission, index: number) => (
      <motion.div
        key={mission.id}
        variants={itemVariants}
        whileHover={{ scale: 1.01, backgroundColor: "rgba(255,255,255,0.03)" }}
        className="group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200"
        style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
        onClick={() => handleLoadMission(mission)}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.1)` }}
        >
          <Zap size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.7)` }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate line-clamp-2" style={{ color: "var(--nazai-text-color)" }}>
            {mission.prompt?.slice(0, 80) || "Untitled Blueprint"}
          </p>
          {mission.response && (
            <p className="text-[10px] font-mono mt-1 line-clamp-2" style={{ color: '#50C878' }}>
              {mission.response.slice(0, 100)}...
            </p>
          )}
          <p className="text-[9px] font-mono mt-1 text-white/30">
            {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
          </p>
        </div>
        <ChevronRight
          size={14}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-white/30"
        />
      </motion.div>
    ),
    [auraProfile.glowPrimary, handleLoadMission],
  );

  // ─── Main Render ────────────────────────────────────────────────────────────────

  // Render content based on activeNav, with a Directional Slide-Fade transition
  const renderContent = () => {
    let view: React.ReactNode = null;
    switch(activeNav) {
      case 'trash':
        view = (
          <TrashView
            missions={missions}
            onRestore={handleRestoreMission}
            onPermanentDelete={handleDeleteMissionPermanently}
          />
        );
        break;
      case 'archives':
        view = (
          <ArchivesView
            missions={missions}
            onRestore={handleRestoreMission}
          />
        );
        break;
      case 'settings':
        view = (
          <SettingsView
            customPalette={customPalette}
            setCustomPalette={setCustomPalette}
            auraProfile={auraProfile}
            updateAuraProfile={updateAuraProfile}
            resetAuraToDefault={resetAuraToDefault}
            toggleLightMode={toggleLightMode}
            userContext={userContext}
            setUserContext={setUserContext}
          />
        );
        break;
      case 'home':
      default:
        view = (
          <HomeView
            errorMessage={errorMessage}
            messages={messages}
            activeTool={activeTool}
            initialCards={initialCards}
            auraProfile={auraProfile}
            currentTheme={currentTheme}
            isPending={isPending}
            handleSendMessage={handleSendMessage}
            handleKeyDown={handleKeyDown}
            handleTextareaFocus={handleTextareaFocus}
            handleTextareaBlur={handleTextareaBlur}
            handleSendPointerDown={handleSendPointerDown}
            setSelectedModel={setSelectedModel}
            setPlusMenuOpen={setPlusMenuOpen}
            setDrawerOpen={setDrawerOpen}
            textareaRef={textareaRef}
            inputContainerRef={inputContainerRef}
            messagesEndRef={messagesEndRef}
            formatAIResponse={formatAIResponse}
            getRgbFromHex={getRgbFromHex}
            laserShineAnimation={laserShineAnimation}
            userMissionAssets={userMissionAssets}
            setUserMissionAssets={setUserMissionAssets}
            activeAssetIndex={activeAssetIndex}
            setActiveAssetIndex={setActiveAssetIndex}
            isDragOver={isDragOver}
            setIsDragOver={setIsDragOver}
            revertDropdownOpen={revertDropdownOpen}
            setRevertDropdownOpen={setRevertDropdownOpen}
            openRevertModal={openRevertModal}
            handleCopyMessage={handleCopyMessage}
            handleRegenerateMessage={handleRegenerateMessage}
            handleShareMessage={handleShareMessage}
            confirmRevert={confirmRevert}
            revertModalOpen={revertModalOpen}
            setRevertModalOpen={setRevertModalOpen}
            onOpenThinkTank={(text: string) => { setThinkTankDirective(text); setThinkTankOpen(true); }}
            promptMode={promptMode}
            setPromptMode={setPromptMode}
            sandboxText={sandboxText}
            setSandboxText={setSandboxText}
            extractorData={extractorData}
            setExtractorData={setExtractorData}
            editablePrompt={editablePrompt}
            setEditablePrompt={setEditablePrompt}
            selectedTemplate={selectedTemplate}
            setSelectedTemplate={setSelectedTemplate}
            fileInputRef={fileInputRef}
            cameraInputRef={cameraInputRef}
          />
        );
    }

    return (
      <motion.div
        key={activeNav}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
        className="absolute inset-0 flex flex-col"
      >
        {view}
      </motion.div>
    );
  };

  return (
    <div
      className="flex h-screen w-screen overflow-hidden font-sans"
      style={{ background: "var(--nazai-bg-base)", color: "var(--nazai-text-color)" }}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" />

      {/* Mobile Backdrop Overlay when sidebar is open */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[998] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Mobile Sidebar - Fixed, slides in from left, floats over content, NO PUSH */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            key="mobile-sidebar"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="fixed top-0 left-0 bottom-0 z-[999] w-[280px] flex flex-col lg:hidden"
            style={{
              background: "#0B1F3A",
              borderRight: `1px solid var(--nazai-border-light)`,
            }}
          >
            <div className="flex flex-col h-full">
              {/* Close button */}
              <div className="flex justify-end p-3">
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all"
                >
                  <X size={18} className="text-white/60" />
                </button>
              </div>
              {/* Sidebar Content */}
              <SidebarContent 
                borderColor={borderColor}
                activeNav={activeNav}
                showSettings={showSettings}
                activeMissionId={activeMissionId}
                handleNavClick={handleNavClick}
                setActiveMissionId={setActiveMissionId}
                setMessages={setMessages}
                textareaRef={textareaRef}
                setDrawerOpen={setDrawerOpen}
                missionsLoading={missionsLoading}
                openChatFeed={openChatFeed}
                handleLoadMission={handleLoadMission}
                openLifecycleModal={openLifecycleModal}
                userEmail={userEmail}
                getAvatarGradient={getAvatarGradient}
                setLogoutModalOpen={setLogoutModalOpen}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar - Always visible in flow, collapsible */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 0 : 260 }}
        transition={{ duration: 0.25 }}
        className="hidden lg:flex flex-col shrink-0 overflow-hidden z-20"
        style={{
          borderRight: `1px solid var(--nazai-border-light)`,
          background: "#0B1F3A",
        }}
      >
        <div className="flex flex-col w-[260px] h-full">
          <SidebarContent 
            borderColor={borderColor}
            activeNav={activeNav}
            showSettings={showSettings}
            activeMissionId={activeMissionId}
            handleNavClick={handleNavClick}
            setActiveMissionId={setActiveMissionId}
            setMessages={setMessages}
            textareaRef={textareaRef}
            setDrawerOpen={setDrawerOpen}
            missionsLoading={missionsLoading}
            openChatFeed={openChatFeed}
            handleLoadMission={handleLoadMission}
            openLifecycleModal={openLifecycleModal}
            userEmail={userEmail}
            getAvatarGradient={getAvatarGradient}
            setLogoutModalOpen={setLogoutModalOpen}
          />
        </div>
      </motion.aside>

      {/* Main Content - ALWAYS w-full on mobile, never shifts when sidebar opens */}
      <main 
        className="flex flex-col flex-1 min-w-0 relative w-full"
        style={{
          marginLeft: 0, // Mobile always has no margin - sidebar floats over
        }}
      >
        {/* Mobile Header with Menu Button - HIGH z-index and pointer-events-auto */}
        <header
          className="flex items-center justify-between px-4 py-2 shrink-0 lg:hidden relative"
          style={{
            borderBottom: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(2,6,23,0.8)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <div className="flex items-center gap-2">
            {/* FIXED: Dead Hamburger Button - High z-index, explicit handler */}
            <div className="z-[9999] relative pointer-events-auto">
              <button
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setIsSidebarOpen(true); 
                }}
                className="text-white/60 hover:text-white/80 transition-colors p-2 -ml-2 rounded-lg active:scale-95"
                style={{ pointerEvents: "auto" }}
              >
                <Menu size={20} />
              </button>
            </div>
            <span
              className="text-[10px] font-mono font-black tracking-tighter"
              style={{
                color: borderColor,
                textShadow: `0 0 calc(var(--text-glow-intensity) * 15px) var(--glow-primary)`,
              }}
            >
              NEURAL://
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
            <span className="text-[8px] font-mono tracking-wider text-white/30">SECURE_NODE</span>
          </div>
        </header>

        {/* Desktop Header */}
        <header
          className="hidden lg:flex items-center justify-between px-4 py-2 shrink-0"
          style={{
            borderBottom: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(2,6,23,0.8)",
            backdropFilter: `blur(${auraProfile.glassBlur}px)`,
          }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="text-white/40 hover:text-white/60 transition-colors"
            >
              {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <span
              className="text-[10px] font-mono font-black tracking-tighter"
              style={{
                color: borderColor,
                textShadow: `0 0 calc(var(--text-glow-intensity) * 15px) var(--glow-primary)`,
              }}
            >
              NEURAL://
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
            <span className="text-[8px] font-mono tracking-wider text-white/30">SECURE_NODE</span>
          </div>
        </header>

        <div className="flex-1 flex flex-col overflow-hidden relative">
          <AnimatePresence mode="wait">
            {renderContent()}
          </AnimatePresence>
        </div>

        <footer
          className="flex items-center justify-between px-4 py-1.5 shrink-0 text-[8px] font-mono tracking-wider text-white/30"
          style={{
            borderTop: `1px solid var(--nazai-border-light)`,
            background: auraProfile.isLightMode ? "rgba(255,255,255,0.8)" : "rgba(2,6,23,0.8)",
          }}
        >
          <span>SYSTEM_STABLE</span>
          <div className="flex gap-3">
            <span>DB:ONLINE</span>
            <span>AI:READY</span>
          </div>
        </footer>
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
                <button
                  onClick={() => setPlusMenuOpen(false)}
                  className="text-white/40 hover:text-white/80 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-all"
                >
                  <Paperclip size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }} />
                  <div className="text-left">
                    <div className="text-xs">Add Files / Photos</div>
                    <div className="text-[9px] text-white/30">Upload from device</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    cameraInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-all"
                >
                  <Camera size={14} style={{ color: `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.6)` }} />
                  <div className="text-left">
                    <div className="text-xs">Take a Photo</div>
                    <div className="text-[9px] text-white/30">Open device camera</div>
                  </div>
                </button>
                <div className="h-px bg-white/10 my-2" />
                <div className="text-[9px] font-mono text-white/40 px-2">SKILLS</div>
                {SKILLS.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => {
                      if (textareaRef.current) {
                        textareaRef.current.value = `[${label}] `;
                        textareaRef.current.focus();
                      }
                      setPlusMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-all"
                  >
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
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={springTransition}
              className="fixed z-[999] bottom-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md rounded-xl overflow-hidden"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
            >
              <div className="px-4 py-2 border-b border-white/10 flex justify-between items-center">
                <span className="text-[10px] font-mono text-white/40">SELECT AI ENGINE</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="text-white/40 hover:text-white/80 transition-colors"
                >
                  <X size={14} />
                </button>
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
                              selectedModel === tool.id ? `rgba(${cat.glowRgba},0.1)` : "rgba(255,255,255,0.02)",
                            border: `1px solid ${selectedModel === tool.id ? cat.color : "rgba(255,255,255,0.05)"}`,
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

      {/* Mission Lifecycle Modal */}
      <AnimatePresence>
        {lifecycleTarget && (
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={closeLifecycleModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={springTransition}
              onClick={(e) => e.stopPropagation()}
              className="max-w-sm w-full rounded-xl p-5"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
            >
              <div className="mb-4">
                <div className="text-[9px] font-mono tracking-[0.2em] text-white/40 mb-1">MISSION_LIFECYCLE</div>
                <h3 className="text-sm font-bold font-mono" style={{ color: "var(--nazai-text-color)" }}>
                  Manage Blueprint
                </h3>
                <p className="text-[11px] text-white/50 mt-1 truncate font-mono">
                  "{lifecycleTarget.prompt?.slice(0, 60) || "Untitled"}"
                </p>
              </div>

              <div className="space-y-2 mb-5">
                {(
                  [
                    { id: "trashed", label: "Move to Trash", color: "#ef4444" },
                    { id: "archived", label: "Move to Archives", color: "#818cf8" },
                    { id: "removed", label: "Remove Entirely", color: "#dc2626" },
                  ] as const
                ).map((opt) => {
                  const selected = lifecycleChoice === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                      style={{
                        background: selected ? `${opt.color}10` : "rgba(255,255,255,0.02)",
                        border: `1px solid ${selected ? opt.color + "60" : "rgba(255,255,255,0.05)"}`,
                      }}
                    >
                      <input
                        type="radio"
                        name="lifecycle"
                        value={opt.id}
                        checked={selected}
                        onChange={() => setLifecycleChoice(opt.id)}
                        className="sr-only"
                      />
                      <div
                        className="w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0"
                        style={{ borderColor: selected ? opt.color : "rgba(255,255,255,0.3)" }}
                      >
                        {selected && (
                          <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: opt.color, boxShadow: `0 0 6px ${opt.color}` }}
                          />
                        )}
                      </div>
                      <span
                        className="text-xs font-mono"
                        style={{ color: selected ? opt.color : "var(--nazai-text-color)" }}
                      >
                        {opt.label}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={closeLifecycleModal}
                  className="flex-1 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLifecycleAction}
                  disabled={!lifecycleChoice}
                  className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: lifecycleChoice
                      ? `rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.15)`
                      : "rgba(255,255,255,0.05)",
                    border: `1px solid ${lifecycleChoice ? auraProfile.glowPrimary + "60" : "rgba(255,255,255,0.1)"}`,
                    color: lifecycleChoice ? auraProfile.glowPrimary : "rgba(255,255,255,0.4)",
                  }}
                >
                  OK
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Logout Modal */}
      <AnimatePresence>
        {logoutModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-sm w-full rounded-xl p-6 text-center"
              style={{ background: "var(--nazai-card-bg)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <LogOut size={32} className="mx-auto mb-3 text-red-500" />
              <h3 className="text-sm font-bold mb-1 font-mono">System Termination</h3>
              <p className="text-xs text-white/50 mb-4">Are you sure you want to log out?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setLogoutModalOpen(false)}
                  className="flex-1 py-2 rounded-lg text-xs bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                >
                  Stay
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex-1 py-2 rounded-lg text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all"
                >
                  Terminate
                </button>
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
        
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
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
          --nazai-glow: #06b6d4;
          --nazai-bg: #020617;
          --nazai-bg-image: none;
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

      {/* Think Tank — opt-in 4-agent chain (Architect+Pixel → Syntax → Echo) */}
      <AgentThinkTank
        open={thinkTankOpen}
        directive={thinkTankDirective}
        onClose={() => setThinkTankOpen(false)}
      />
    </div>
  );
}
