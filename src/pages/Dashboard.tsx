import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import DropScanOverlay from "@/components/interactions/DropScanOverlay";
import MagneticButton from "@/components/interactions/MagneticButton";
import WebsiteRevealPane from "@/components/dashboard/WebsiteRevealPane";
import AIResponseExtras, {
  readGroundTruth,
  type GroundTruthEntry,
} from "@/components/dashboard/AIResponseExtras";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Plus,
  X,
  Send,
  Brain,
  Building2,
  Briefcase,
  Image as ImageIcon,
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
  RefreshCw,
  Sparkles,
  ShieldCheck,
  LayoutTemplate,
  Rocket,
  Store,
  BarChart3,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import GuardianCanvas from "@/components/workflower/GuardianCanvas";
import { toast } from "sonner";

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
        icon: ImageIcon,
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

// Default User Context — fields start empty; Supabase data (when present) overrides
const DEFAULT_USER_CONTEXT: UserContext = {
  identity: '',
  goals: '',
  style: '',
};

// ─── Comfort Designs (Template Gallery) ───────────────────────────────────────
// Six premium NazAI-native visual templates. Selecting one is treated as a
// "ground-truth" design preference: it pre-fills the generation prompt with a
// concrete style directive AND is persisted so every future build/edit honors it.
type ComfortTemplate = {
  id: string;
  name: string;
  tagline: string;
  icon: React.ElementType;
  // Hybrid thumbnail = CSS gradient + icon + name (no image assets needed)
  gradient: string;
  accent: string;
  // Style directive injected into the AI master prompt
  styleDirective: string;
};

const COMFORT_TEMPLATES: ComfortTemplate[] = [
  {
    id: "cyber-saas",
    name: "Cyber-Futuristic SaaS",
    tagline: "Neon accents · glassmorphism · dark",
    icon: Zap,
    gradient: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #a855f7 100%)",
    accent: "#06b6d4",
    styleDirective:
      "Cyber-futuristic SaaS aesthetic: deep dark base (#020617–#0a0a0f), tasteful glassmorphism with backdrop-blur, neon cyan/violet accents, animated gradient halos, sharp geometric layout, JetBrains Mono micro-labels + Inter body, bold large hero headline.",
  },
  {
    id: "minimal-premium",
    name: "Minimal Premium",
    tagline: "Linear-style whitespace · bold type",
    icon: Feather,
    gradient: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #94a3b8 100%)",
    accent: "#0f172a",
    styleDirective:
      "Minimal premium aesthetic in the Linear/Vercel/Apple lineage: generous whitespace, very bold tight typography, neutral palette with one subtle accent, restrained micro-interactions, soft shadows, no gimmicks.",
  },
  {
    id: "bold-gradient",
    name: "Bold Gradient Hero",
    tagline: "Story-driven · vibrant · cinematic",
    icon: Sparkles,
    gradient: "linear-gradient(135deg, #f43f5e 0%, #f59e0b 50%, #a855f7 100%)",
    accent: "#f43f5e",
    styleDirective:
      "Bold gradient cinematic aesthetic: oversized expressive headline, vivid multi-stop gradient hero, scroll-triggered reveals, story sections with rhythm, large rounded CTA, premium feel without becoming chaotic.",
  },
  {
    id: "analytics-dashboard",
    name: "Analytics Landing",
    tagline: "Data viz hero · charts · KPIs",
    icon: BarChart3,
    gradient: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)",
    accent: "#10b981",
    styleDirective:
      "Analytics dashboard landing aesthetic: data-rich hero with mock chart/sparklines/KPI tiles, monospace numerals, clean grid, dark mode default, signal-green + electric-blue accents, trustworthy enterprise tone.",
  },
  {
    id: "agency",
    name: "Professional Agency",
    tagline: "Confident · case studies · trust",
    icon: Briefcase,
    gradient: "linear-gradient(135deg, #1e293b 0%, #475569 50%, #0ea5e9 100%)",
    accent: "#0ea5e9",
    styleDirective:
      "Professional service / agency aesthetic: confident editorial typography, case-study cards with results metrics, client logo strip, testimonial with role + company, calm neutral palette + one signature accent.",
  },
  {
    id: "ecommerce",
    name: "E-commerce Teaser",
    tagline: "Product hero · CTA-driven",
    icon: Store,
    gradient: "linear-gradient(135deg, #ec4899 0%, #a855f7 50%, #6366f1 100%)",
    accent: "#ec4899",
    styleDirective:
      "E-commerce teaser aesthetic: large product hero with lifestyle gradient, prominent buy CTA, social proof strip, FAQ + shipping reassurance, conversion-optimized layout, premium boutique feel.",
  },
];

// ─── Design Preferences (Ground Truth) ────────────────────────────────────────
type DesignPreferences = {
  templateId: string | null;
  paletteColors: string[]; // optional saved palette from Brand Assets
  vibe: string; // free-form vibe note
  savedAt: string | null;
};

const DEFAULT_DESIGN_PREFERENCES: DesignPreferences = {
  templateId: null,
  paletteColors: [],
  vibe: "",
  savedAt: null,
};

const DESIGN_PREFERENCES_STORAGE_KEY = "nazai-design-preferences";
const projectDesignPreferencesKey = (projectId: string) => `${DESIGN_PREFERENCES_STORAGE_KEY}:${projectId}`;

const loadDesignPreferences = (projectId?: string | null): DesignPreferences => {
  try {
    const projectRaw = projectId ? localStorage.getItem(projectDesignPreferencesKey(projectId)) : null;
    const raw = projectRaw || localStorage.getItem(DESIGN_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_DESIGN_PREFERENCES;
    return { ...DEFAULT_DESIGN_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_DESIGN_PREFERENCES;
  }
};

const saveDesignPreferences = (p: DesignPreferences, projectId?: string | null) => {
  try {
    localStorage.setItem(DESIGN_PREFERENCES_STORAGE_KEY, JSON.stringify(p));
    if (projectId) localStorage.setItem(projectDesignPreferencesKey(projectId), JSON.stringify(p));
  } catch {
    /* noop */
  }
};

const buildDesignPreferenceDirective = (p: DesignPreferences): string => {
  const tpl = COMFORT_TEMPLATES.find((t) => t.id === p.templateId);
  if (!tpl && !p.paletteColors.length && !p.vibe.trim()) return "";
  const parts: string[] = ["[DESIGN_PREFERENCES — GROUND TRUTH, ALWAYS HONOR]"];
  if (tpl) parts.push(`Chosen template: ${tpl.name}. ${tpl.styleDirective}`);
  if (p.paletteColors.length) parts.push(`Brand palette (use as primary visual language): ${p.paletteColors.join(", ")}.`);
  if (p.vibe.trim()) parts.push(`Vibe note: ${p.vibe.trim()}.`);
  parts.push("Apply these preferences to every section, component, and edit unless the user explicitly overrides.");
  return parts.join("\n") + "\n\n";
};

// ─── Instant Theme Application ──────────────────────────────────────────────
// Builds a CSS override sheet for a Comfort Design template and injects it
// into an existing standalone HTML document so the iframe preview re-themes
// in milliseconds — no AI roundtrip required. Future generations/edits still
// receive the full directive via buildDesignPreferenceDirective().
const COMFORT_THEME_STYLE_ID = "nazai-comfort-theme";

const buildComfortThemeCss = (templateId: string | null): string => {
  if (!templateId) return "";
  const tpl = COMFORT_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return "";

  // Per-template, opinionated theme. Each preset is a complete visual
  // identity — background, glass intensity, typography, button shape,
  // accent glows, hero headline treatment — so switching feels dramatic.
  type Theme = {
    googleFont: string;        // e.g. "Inter:wght@400;600;800"
    bodyFont: string;          // applied to html/body
    headingFont: string;       // applied to h1-h6
    bg: string;                // body background
    fg: string;                // body text color
    mutedFg: string;
    surface: string;           // cards / sections
    surfaceBorder: string;
    accent: string;
    accent2: string;
    radius: string;
    glass: string;             // backdrop-filter, or "none"
    btnBg: string;             // primary CTA background
    btnFg: string;
    btnRadius: string;
    btnShadow: string;
    headingTreatment: string;  // h1 specific css
    extra?: string;
  };

  const themes: Record<string, Theme> = {
    // ─── 1. CYBER-FUTURISTIC SAAS ─────────────────────────────────────────────
    "cyber-saas": {
      googleFont: "Inter:wght@400;600;800|JetBrains+Mono:wght@500",
      bodyFont: "'Inter', system-ui, sans-serif",
      headingFont: "'Inter', system-ui, sans-serif",
      bg: "radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(168,85,247,0.18), transparent 60%), radial-gradient(ellipse 900px 500px at 100% 100%, rgba(6,182,212,0.15), transparent 60%), #020617",
      fg: "#e2e8f0",
      mutedFg: "rgba(226,232,240,0.6)",
      surface: "rgba(15,23,42,0.55)",
      surfaceBorder: "rgba(6,182,212,0.28)",
      accent: "#06b6d4",
      accent2: "#a855f7",
      radius: "14px",
      glass: "blur(20px) saturate(160%)",
      btnBg: "linear-gradient(135deg,#06b6d4 0%,#a855f7 100%)",
      btnFg: "#0a0a0f",
      btnRadius: "10px",
      btnShadow: "0 0 24px rgba(6,182,212,0.45), 0 0 48px rgba(168,85,247,0.25)",
      headingTreatment: `background:linear-gradient(135deg,#67e8f9 0%,#a78bfa 100%);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800;letter-spacing:-0.025em;`,
      extra: `code,pre,.mono{font-family:'JetBrains Mono',ui-monospace,monospace;color:#67e8f9;} hr{border-color:rgba(6,182,212,0.2);} ::selection{background:rgba(6,182,212,0.35);color:#fff;}`,
    },

    // ─── 2. MINIMAL PREMIUM (Linear / Vercel) ─────────────────────────────────
    "minimal-premium": {
      googleFont: "Inter:wght@400;500;700;800",
      bodyFont: "'Inter', 'Helvetica Neue', sans-serif",
      headingFont: "'Inter', 'Helvetica Neue', sans-serif",
      bg: "#fafafa",
      fg: "#0a0a0a",
      mutedFg: "#525252",
      surface: "#ffffff",
      surfaceBorder: "rgba(10,10,10,0.08)",
      accent: "#0a0a0a",
      accent2: "#525252",
      radius: "10px",
      glass: "none",
      btnBg: "#0a0a0a",
      btnFg: "#ffffff",
      btnRadius: "8px",
      btnShadow: "0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
      headingTreatment: `color:#0a0a0a;font-weight:700;letter-spacing:-0.04em;line-height:1.05;`,
      extra: `p{color:#404040;line-height:1.65;} hr{border-color:rgba(0,0,0,0.06);} img{border-radius:10px;}`,
    },

    // ─── 3. BOLD GRADIENT HERO (cinematic, vibrant) ───────────────────────────
    "bold-gradient": {
      googleFont: "Space+Grotesk:wght@500;700;800|Inter:wght@400;500",
      bodyFont: "'Inter', sans-serif",
      headingFont: "'Space Grotesk', 'Inter', sans-serif",
      bg: "linear-gradient(135deg,#1a0820 0%,#3a0f4f 35%,#5b1f6e 65%,#1a0820 100%)",
      fg: "#fdf4ff",
      mutedFg: "rgba(253,244,255,0.7)",
      surface: "rgba(244,63,94,0.08)",
      surfaceBorder: "rgba(244,63,94,0.4)",
      accent: "#f43f5e",
      accent2: "#f59e0b",
      radius: "20px",
      glass: "blur(16px) saturate(140%)",
      btnBg: "linear-gradient(135deg,#f43f5e 0%,#f59e0b 50%,#a855f7 100%)",
      btnFg: "#ffffff",
      btnRadius: "999px",
      btnShadow: "0 8px 32px rgba(244,63,94,0.45)",
      headingTreatment: `background:linear-gradient(135deg,#fbbf24 0%,#f43f5e 50%,#a855f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800;letter-spacing:-0.03em;font-size:clamp(2.5rem,6vw,5rem);line-height:1;`,
      extra: `::selection{background:rgba(244,63,94,0.4);color:#fff;}`,
    },

    // ─── 4. ANALYTICS LANDING (data viz, KPI-driven) ──────────────────────────
    "analytics-dashboard": {
      googleFont: "Inter:wght@400;600;700|JetBrains+Mono:wght@500;700",
      bodyFont: "'Inter', sans-serif",
      headingFont: "'Inter', sans-serif",
      bg: "linear-gradient(180deg,#0a0f1a 0%,#0d1422 100%)",
      fg: "#e2e8f0",
      mutedFg: "rgba(226,232,240,0.55)",
      surface: "rgba(16,185,129,0.05)",
      surfaceBorder: "rgba(16,185,129,0.22)",
      accent: "#10b981",
      accent2: "#06b6d4",
      radius: "8px",
      glass: "blur(10px)",
      btnBg: "#10b981",
      btnFg: "#0a0f1a",
      btnRadius: "6px",
      btnShadow: "0 0 20px rgba(16,185,129,0.35)",
      headingTreatment: `color:#f1f5f9;font-weight:700;letter-spacing:-0.02em;`,
      extra: `code,pre,.metric,.kpi,.number,[class*="metric"],[class*="kpi"]{font-family:'JetBrains Mono',ui-monospace,monospace;color:#34d399;font-variant-numeric:tabular-nums;} table{border-color:rgba(16,185,129,0.2);} th{color:#10b981;text-transform:uppercase;font-size:0.75em;letter-spacing:0.1em;}`,
    },

    // ─── 5. PROFESSIONAL AGENCY (editorial, trustworthy) ──────────────────────
    "agency": {
      googleFont: "Playfair+Display:wght@600;700;800|Inter:wght@400;500;600",
      bodyFont: "'Inter', sans-serif",
      headingFont: "'Playfair Display', Georgia, serif",
      bg: "#0c1119",
      fg: "#e5e7eb",
      mutedFg: "rgba(229,231,235,0.6)",
      surface: "rgba(255,255,255,0.03)",
      surfaceBorder: "rgba(14,165,233,0.18)",
      accent: "#0ea5e9",
      accent2: "#94a3b8",
      radius: "4px",
      glass: "blur(8px)",
      btnBg: "transparent",
      btnFg: "#0ea5e9",
      btnRadius: "2px",
      btnShadow: "inset 0 0 0 1px #0ea5e9",
      headingTreatment: `font-family:'Playfair Display',Georgia,serif;color:#f1f5f9;font-weight:700;letter-spacing:-0.015em;line-height:1.1;`,
      extra: `blockquote{border-left:3px solid #0ea5e9;padding-left:1.5rem;font-style:italic;color:#cbd5e1;} a{color:#38bdf8;text-decoration:underline;text-decoration-color:rgba(56,189,248,0.3);text-underline-offset:3px;}`,
    },

    // ─── 6. E-COMMERCE TEASER (CTA-driven, boutique) ──────────────────────────
    "ecommerce": {
      googleFont: "Manrope:wght@400;600;700;800",
      bodyFont: "'Manrope', sans-serif",
      headingFont: "'Manrope', sans-serif",
      bg: "linear-gradient(180deg,#fdf2f8 0%,#faf5ff 50%,#fef3c7 100%)",
      fg: "#1e1b4b",
      mutedFg: "#6b7280",
      surface: "#ffffff",
      surfaceBorder: "rgba(236,72,153,0.18)",
      accent: "#ec4899",
      accent2: "#a855f7",
      radius: "16px",
      glass: "none",
      btnBg: "linear-gradient(135deg,#ec4899 0%,#a855f7 100%)",
      btnFg: "#ffffff",
      btnRadius: "999px",
      btnShadow: "0 10px 30px rgba(236,72,153,0.35)",
      headingTreatment: `color:#1e1b4b;font-weight:800;letter-spacing:-0.025em;line-height:1.1;`,
      extra: `img{border-radius:18px;box-shadow:0 20px 50px rgba(236,72,153,0.15);} .price,[class*="price"]{color:#ec4899;font-weight:700;} ::selection{background:rgba(236,72,153,0.25);}`,
    },
  };

  const t = themes[templateId];
  if (!t) return "";

  const fontImport = `@import url('https://fonts.googleapis.com/css2?family=${t.googleFont.replace(/\|/g, "&family=")}&display=swap');`;

  return `
${fontImport}
/* === NazAI Comfort Design: ${tpl.name} === */
:root{
  --primary:${t.accent};
  --accent:${t.accent2};
  --bg:${t.bg};
  --glass:${t.surface};
  --glass-border:${t.surfaceBorder};
  --background:${t.bg};
  --foreground:${t.fg};
  --card:${t.surface};
  --border:${t.surfaceBorder};
  --nazai-comfort-accent:${t.accent};
  --nazai-comfort-accent-2:${t.accent2};
  --nazai-comfort-bg:${t.bg};
  --nazai-comfort-fg:${t.fg};
  --nazai-comfort-muted:${t.mutedFg};
  --nazai-comfort-surface:${t.surface};
  --nazai-comfort-border:${t.surfaceBorder};
  --nazai-comfort-radius:${t.radius};
}
html,body{
  background:${t.bg}!important;
  color:${t.fg}!important;
  font-family:${t.bodyFont}!important;
  transition:background 180ms ease, color 160ms ease;
}
body > *{background:transparent!important;color:${t.fg}!important;}
*,*::before,*::after{
  transition:background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, filter 160ms ease;
}
h1,h2,h3,h4,h5,h6{font-family:${t.headingFont}!important;color:${t.fg}!important;}
h1{${t.headingTreatment}}
h2{color:${t.fg}!important;font-weight:700;letter-spacing:-0.02em;}
p,li,span:not([class*="badge"]):not([class*="chip"]){color:${t.fg}!important;}
.muted,small,[class*="muted"],[class*="subtle"],[class*="gray"],[class*="slate"]{color:${t.mutedFg}!important;}

/* Override common AI/Tailwind generated color utilities so the visible preview actually changes. */
[class*="bg-white"],[class*="bg-gray"],[class*="bg-slate"],[class*="bg-zinc"],[class*="bg-neutral"],[style*="background: white"],[style*="background:#fff"],[style*="background: #fff"]{
  background:${t.surface}!important;
}
[class*="text-black"],[class*="text-gray"],[class*="text-slate"],[class*="text-zinc"],[class*="text-neutral"]{
  color:${t.fg}!important;
}
[class*="border-gray"],[class*="border-slate"],[class*="border-zinc"],[class*="border-neutral"],[class*="border-white"]{
  border-color:${t.surfaceBorder}!important;
}

main,section,header,footer,nav,article,aside,
.card,.panel,.glass,[class*="card"],[class*="panel"],[class*="feature"],[class*="pricing"],[class*="testimonial"],[class*="metric"],[class*="kpi"]{
  background:${t.surface}!important;
  border-color:${t.surfaceBorder}!important;
  border-radius:${t.radius}!important;
  ${t.glass !== "none" ? `backdrop-filter:${t.glass}!important;-webkit-backdrop-filter:${t.glass}!important;` : ""}
}
main > section:first-child, .hero, [class*="hero"]{
  background:${t.bg}!important;
  border-color:${t.surfaceBorder}!important;
}
nav,header{backdrop-filter:${t.glass !== "none" ? t.glass : "blur(8px)"}!important;-webkit-backdrop-filter:${t.glass !== "none" ? t.glass : "blur(8px)"}!important;}

a{color:${t.accent}!important;}
a:hover{color:${t.accent2}!important;}

button,.btn,[class*="btn"],[type="button"],[type="submit"],a[class*="cta"],a[class*="button"],a[class*="Button"]{
  background:${t.btnBg}!important;
  color:${t.btnFg}!important;
  border-color:transparent!important;
  border-radius:${t.btnRadius}!important;
  box-shadow:${t.btnShadow}!important;
  font-weight:700!important;
  padding:0.75rem 1.5rem;
  cursor:pointer;
}
button:hover,.btn:hover,[class*="btn"]:hover{transform:translateY(-1px);filter:brightness(1.08);}

input,textarea,select{
  background:${t.surface}!important;
  color:${t.fg}!important;
  border:1px solid ${t.surfaceBorder}!important;
  border-radius:${t.radius}!important;
}
input:focus,textarea:focus,select:focus{outline:2px solid ${t.accent};outline-offset:2px;}

hr{border-color:${t.surfaceBorder}!important;}
${t.extra ?? ""}
`.trim();
};


/**
 * Applies a Comfort Design template to an existing standalone HTML document
 * by injecting/replacing a single <style id="nazai-comfort-theme"> block in
 * the document <head>. Pure function — returns the new HTML string. Pass
 * templateId=null to strip the override and return to the original styling.
 */
const applyTemplateThemeToHtml = (html: string, templateId: string | null): string => {
  if (!html) return html;
  const styleTagRegex = new RegExp(
    `<style[^>]*id=["']${COMFORT_THEME_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>`,
    "i"
  );
  // Strip any existing comfort theme block first.
  const stripped = html.replace(styleTagRegex, "");
  if (!templateId) return stripped;

  const css = buildComfortThemeCss(templateId);
  if (!css) return stripped;
  const block = `<style id="${COMFORT_THEME_STYLE_ID}">${css}</style>`;

  // Inject just before </head>; fall back to prepending if no </head>.
  if (/<\/head>/i.test(stripped)) {
    return stripped.replace(/<\/head>/i, `${block}</head>`);
  }
  if (/<head[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head[^>]*>/i, (m) => `${m}${block}`);
  }
  return block + stripped;
};


const PLACEHOLDER_TEXTS = [
  "Architect a high-performance gym business...",
  "Design a blueprint for an automated SaaS...",
  "Build a launch strategy for a tech startup...",
];

// Professional system prompt for AI
const SYSTEM_PROMPT = `You are The Neural Architect, a high-precision business blueprinting AI. Respond in a professional, architectural tone. Provide structured, actionable business plans. Focus on strategic frameworks, market analysis, operational excellence, and financial architecture. Use clear sections and professional language.`;

// Premium quality guidelines injected into every website generation/edit prompt.
// Goal: outputs that exceed Durable AI in design polish, copywriting, responsiveness,
// SEO, accessibility, and conversion-readiness.
const PREMIUM_WEBSITE_QUALITY_GUIDELINES = `[PREMIUM_QUALITY_STANDARD — EXCEED DURABLE AI]
Produce production-ready, premium-feel websites. Every output must satisfy ALL of the following:

DESIGN
- Modern aesthetic: choose either (a) cyber-futuristic dark with neon accents + glassmorphism, or (b) clean minimal light/dark with refined typography — pick whichever best fits the user's prompt.
- Tasteful glassmorphism (backdrop-filter blur, soft borders, layered translucency), subtle gradients, and depth via shadows.
- Subtle, performant animations: fade/slide on scroll (IntersectionObserver), gentle hover lifts, animated gradient accents. Never gimmicky.
- Cohesive design system: 1 primary, 1 accent, neutral scale, consistent radius, consistent button + card treatments, consistent spacing rhythm (8px scale).
- Typography: pair a strong display font with a clean sans (e.g., Inter, Space Grotesk, Manrope via Google Fonts CDN). Clear hierarchy (H1 ≥ 48px desktop), generous line-height.

LAYOUT & RESPONSIVENESS
- Mobile-first, fully responsive across 375 / 768 / 1024 / 1440. Use CSS grid + flexbox; never overflow horizontally.
- Sections: sticky/translucent nav, hero with strong CTA, social proof / logo strip, feature grid (3–6 items), how-it-works or product showcase, testimonials, pricing OR CTA band, FAQ, footer with multiple columns.
- Strong visual hierarchy and conversion-focused layout: every section drives toward a clear next action.

COPYWRITING
- Rich, brand-specific, persuasive copy tailored to the user's exact prompt — never generic "Lorem ipsum" or "Your tagline here".
- Headlines are benefit-driven and specific. Subheads expand the promise. Body is concise, scannable, professional.
- Realistic placeholder content (real-sounding company names, metrics, testimonials with roles + companies) so the site feels ready-to-customize.

SEO & ACCESSIBILITY
- Semantic HTML5: <header>, <nav>, <main>, <section>, <article>, <footer>, proper <h1>–<h3> order (one H1 only).
- <head>: <title> under 60 chars with primary keyword, <meta name="description"> under 160 chars, viewport meta, theme-color, Open Graph + Twitter card tags, canonical link, JSON-LD Organization schema when applicable.
- All <img> have meaningful alt text. All interactive controls have aria-labels and visible focus states. Color contrast ≥ WCAG AA.
- Lazy-load below-the-fold images (loading="lazy"), prefer system-font fallback stacks, minimize render-blocking work.

CODE QUALITY
- Clean, well-structured, lightly commented HTML/CSS/JS. No redundant utility classes, no dead code, no inline styles where a class is clearer.
- Self-contained: a single standalone HTML document with inline <style> and <script> that runs in an iframe srcDoc with no external build step. Tailwind via CDN is allowed; otherwise hand-written CSS.
- Use real, working anchor links for in-page nav (#features, #pricing, #faq) and ensure smooth-scroll.

ABSOLUTELY AVOID
- Plain-text responses, partial snippets, TSX/JSX imports, markdown prose outside the single \`\`\`html block.
- Generic templates reused across users — every output must reflect the specific brand/prompt.
- Broken images, empty sections, placeholder "click here" CTAs, or low-contrast text.
`;


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

const extractGeneratedCode = (text: string): string => {
  const htmlFence = text.match(/```html\s*([\s\S]*?)```/i);
  const anyFence = text.match(/```(?:tsx|jsx|ts|js|html)?\s*([\s\S]*?)```/i);
  return (htmlFence?.[1] ?? anyFence?.[1] ?? text).trim();
};

const hasPreviewHtml = (code: string): boolean =>
  /<\s*(html|body|main|section|div|header|nav|article|footer)[\s>]/i.test(code);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inferSiteName = (prompt: string): string => {
  const match = prompt.match(/\b(?:for|called|named)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})/);
  return (match?.[1] || "Gamma").replace(/\b(With|And|In|For|A|The)\b.*$/i, "").trim() || "Gamma";
};

const buildStarterWebsiteHtml = (prompt: string): string => {
  const siteName = escapeHtml(inferSiteName(prompt));
  const directive = escapeHtml(prompt || "modern cyber-futuristic SaaS");
  const isFinance = /finance|fintech|invoice|payment|revenue/i.test(prompt);
  const isAi = /ai|automation|agent|neural|model/i.test(prompt);
  const featureOne = isAi ? "Autonomous workflow orchestration" : "Real-time business command center";
  const featureTwo = isFinance ? "Revenue, pricing, and billing intelligence" : "Conversion-focused launch pages";
  const featureThree = /crm|customer|sales/i.test(prompt) ? "Customer pipeline and CRM insights" : "Brand systems generated in minutes";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${siteName} — AI SaaS</title>
  <style>
    :root { --bg: #030712; --panel: rgba(15,23,42,.72); --line: rgba(148,163,184,.18); --text: #f8fafc; --muted: #94a3b8; --accent: #22d3ee; --accent-2: #a855f7; }
    * { box-sizing: border-box; } html { scroll-behavior: smooth; } body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 20% 0%, rgba(34,211,238,.18), transparent 32%), radial-gradient(circle at 78% 12%, rgba(168,85,247,.22), transparent 30%), var(--bg); }
    a { color: inherit; text-decoration: none; } .shell { min-height: 100vh; overflow: hidden; } .nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px clamp(18px, 5vw, 72px); background: rgba(3,7,18,.72); border-bottom: 1px solid var(--line); backdrop-filter: blur(18px); } .brand { display: flex; align-items: center; gap: 10px; font-weight: 900; letter-spacing: -.04em; } .mark { width: 28px; height: 28px; border-radius: 9px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 0 30px color-mix(in srgb, var(--accent) 55%, transparent); } .links { display: flex; gap: 18px; color: var(--muted); font-size: 13px; } .cta { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 18px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 28%, transparent), color-mix(in srgb, var(--accent-2) 24%, transparent)); color: white; font-weight: 800; box-shadow: 0 0 34px color-mix(in srgb, var(--accent) 26%, transparent); } .hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(280px, .95fr); gap: clamp(28px, 5vw, 72px); padding: clamp(58px, 9vw, 118px) clamp(18px, 5vw, 72px) 52px; align-items: center; } .eyebrow { display: inline-flex; gap: 8px; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; color: var(--accent); background: rgba(255,255,255,.04); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .16em; } h1 { margin: 20px 0 18px; font-size: clamp(46px, 8vw, 92px); line-height: .88; letter-spacing: -.07em; } .lead { max-width: 680px; color: #cbd5e1; font-size: clamp(17px, 2.2vw, 22px); line-height: 1.55; } .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; } .secondary { border-color: var(--line); background: rgba(255,255,255,.055); box-shadow: none; } .glass { border: 1px solid var(--line); background: var(--panel); box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.32); backdrop-filter: blur(22px); } .console { border-radius: 24px; padding: 18px; transform: rotate(1deg); } .bar { height: 38px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); margin: -18px -18px 18px; padding: 0 16px; } .dot { width: 9px; height: 9px; border-radius: 999px; background: #334155; } .metric { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 14px; margin-top: 10px; border-radius: 16px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.08); } .metric strong { font-size: 28px; } section { padding: 70px clamp(18px, 5vw, 72px); } .section-title { font-size: clamp(30px, 4.5vw, 54px); letter-spacing: -.05em; margin: 0 0 24px; } .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } .card { border-radius: 22px; padding: 24px; min-height: 210px; } .card h3 { margin: 14px 0 10px; font-size: 20px; } .card p, .pricing p { color: var(--muted); line-height: 1.55; } .icon { width: 42px; height: 42px; border-radius: 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 24%, transparent), color-mix(in srgb, var(--accent-2) 22%, transparent)); display: grid; place-items: center; color: var(--accent); } .pricing { display: grid; grid-template-columns: .8fr 1.2fr; gap: 16px; align-items: stretch; } .price { border-radius: 26px; padding: 30px; } .amount { font-size: clamp(44px, 7vw, 78px); font-weight: 950; letter-spacing: -.08em; } footer { padding: 34px clamp(18px, 5vw, 72px); color: var(--muted); border-top: 1px solid var(--line); } @media (max-width: 760px) { .hero, .pricing { grid-template-columns: 1fr; } .links { display: none; } .grid { grid-template-columns: 1fr; } h1 { font-size: 52px; } }
  </style>
</head>
<body>
  <div class="shell">
    <nav class="nav"><a class="brand" href="#home"><span class="mark"></span><span>${siteName}</span></a><div class="links"><a href="#home">Home</a><a href="#features">Features</a><a href="#pricing">Pricing</a></div><a class="cta" href="#pricing">Start free</a></nav>
    <main id="home" class="hero"><div><span class="eyebrow">Cyber-futuristic SaaS</span><h1>${siteName} turns founder chaos into launch velocity.</h1><p class="lead">A premium dark-mode SaaS experience generated for: ${directive}. Strategy, execution, and trust signals are packaged into one glassmorphic command layer.</p><div class="actions"><a class="cta" href="#features">Explore features</a><a class="cta secondary" href="#pricing">View pricing</a></div></div><aside class="console glass"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><div class="metric"><span>Launch readiness</span><strong>92%</strong></div><div class="metric"><span>Pipeline clarity</span><strong>3.4x</strong></div><div class="metric"><span>Manual work removed</span><strong>18h</strong></div></aside></main>
    <section id="features"><h2 class="section-title">Built for execution, not slide decks.</h2><div class="grid"><article class="card glass"><div class="icon">✦</div><h3>${featureOne}</h3><p>Coordinate strategy, copy, launch assets, and next actions from a single high-trust workspace.</p></article><article class="card glass"><div class="icon">◆</div><h3>${featureTwo}</h3><p>Ship polished pages and business systems with premium positioning, sharp CTAs, and measurable outcomes.</p></article><article class="card glass"><div class="icon">●</div><h3>${featureThree}</h3><p>Generate investor-grade summaries, brand kits, and customer flows tailored to the exact prompt.</p></article></div></section>
    <section id="pricing" class="pricing"><div><h2 class="section-title">Simple pricing for serious builders.</h2><p>Start with a launch sprint, then scale into a complete AI Business OS as the company grows.</p></div><div class="price glass"><span class="eyebrow">Founder OS</span><div class="amount">$49</div><p>per month · includes website generation, brand assets, business planning, and iteration tools.</p><div class="actions"><a class="cta" href="#home">Get started</a><a class="cta secondary" href="#features">Compare features</a></div></div></section>
    <footer>© ${new Date().getFullYear()} ${siteName}. Built with NazAI.</footer>
  </div>
</body>
</html>`;
};

const applyInstantWebsiteEdit = (code: string, change: string): string => {
  if (!code.trim()) return code;
  const lower = change.toLowerCase();
  const palette = lower.includes("purple")
    ? ["#c084fc", "#7c3aed"]
    : lower.includes("red")
      ? ["#fb7185", "#ef4444"]
      : lower.includes("green")
        ? ["#34d399", "#22c55e"]
        : lower.includes("blue")
          ? ["#60a5fa", "#2563eb"]
          : null;
  if (!palette || !/button|cta|accent|color|neon|glow/.test(lower)) return code;
  return code
    .replace(/--accent:\s*#[0-9a-fA-F]{3,8};/g, `--accent: ${palette[0]};`)
    .replace(/--accent-2:\s*#[0-9a-fA-F]{3,8};/g, `--accent-2: ${palette[1]};`);
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

// SettingsView Component - Neural Custom Theme & Connected Apps + Comfort Designs + Brand-Snap Canvas
const SettingsView = ({
  customPalette, setCustomPalette,
  auraProfile, updateAuraProfile, resetAuraToDefault, toggleLightMode,
  userContext, setUserContext,
  designPreferences, setDesignPreferences,
  onTemplateSelect,
  initialFocus,
}: {
  customPalette: CustomPalette;
  setCustomPalette: (palette: CustomPalette) => void;
  auraProfile: AuraProfile;
  updateAuraProfile: (updates: Partial<AuraProfile>) => void;
  resetAuraToDefault: () => void;
  toggleLightMode: () => void;
  userContext: UserContext;
  setUserContext: (context: UserContext) => void;
  designPreferences: DesignPreferences;
  setDesignPreferences: (p: DesignPreferences) => void;
  onTemplateSelect: (id: string | null) => void;
  initialFocus?: "brand-snap" | "comfort-designs" | null;
}) => {
  const [neuralCustomActive, setNeuralCustomActive] = useState(false);
  // Track snapshot of last saved context — Save button only appears once user edits a field
  const [savedSnapshot, setSavedSnapshot] = useState<UserContext>(userContext);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const isDirty =
    userContext.identity !== savedSnapshot.identity ||
    userContext.goals !== savedSnapshot.goals ||
    userContext.style !== savedSnapshot.style;
  const handleSaveContext = async () => {
    setSaving(true);
    try {
      // Persist locally; backend table is optional
      try { localStorage.setItem("nazai-user-context", JSON.stringify(userContext)); } catch {}
      setSavedSnapshot(userContext);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
    } finally {
      setSaving(false);
    }
  };
  
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
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none focus:ring-1 focus:ring-cyan-400/40 transition-colors appearance-none"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.9)",
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 0.6rem center",
                    paddingRight: "1.75rem",
                  }}
                >
                  {/* Dark, semi-transparent option styling so they remain visible against the dashboard theme */}
                  <option value="" style={{ background: "#0b1220", color: "rgba(255,255,255,0.9)" }}>— Select interaction style —</option>
                  <option value="Perspective, accurate, direct Yes-man/No-man" style={{ background: "#0b1220", color: "rgba(255,255,255,0.9)" }}>Yes-man/No-man (Balanced)</option>
                  <option value="Direct, concise, technical" style={{ background: "#0b1220", color: "rgba(255,255,255,0.9)" }}>Direct & Technical</option>
                  <option value="Supportive, encouraging, constructive" style={{ background: "#0b1220", color: "rgba(255,255,255,0.9)" }}>Supportive & Constructive</option>
                  <option value="Challenging, critical, stress-testing" style={{ background: "#0b1220", color: "rgba(255,255,255,0.9)" }}>Challenging & Critical</option>
                </select>
              </div>

              {/* Animated Save button — hidden until the user edits any field */}
              <AnimatePresence>
                {isDirty && (
                  <motion.button
                    type="button"
                    onClick={handleSaveContext}
                    disabled={saving}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      boxShadow: [
                        "0 0 0px rgba(6,182,212,0.0)",
                        "0 0 18px rgba(6,182,212,0.55)",
                        "0 0 8px rgba(6,182,212,0.35)",
                      ],
                    }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 320, damping: 22 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="self-end px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-wider uppercase flex items-center gap-2"
                    style={{
                      background: "rgba(6,182,212,0.12)",
                      border: "1px solid rgba(6,182,212,0.45)",
                      color: "#06b6d4",
                    }}
                  >
                    {saving ? "Saving…" : justSaved ? "✓ Saved" : "Save Context"}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* ─── COMFORT DESIGNS (Template Gallery) ────────────────────────── */}
          <motion.div
            id="comfort-designs"
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2 font-mono" style={{ color: "var(--nazai-text-color)" }}>
                  <LayoutTemplate size={16} className="text-cyan-400" /> COMFORT DESIGNS
                </h3>
                <p className="text-[10px] font-mono text-white/40 mt-1">
                  Pick a visual template — NazAI will use it as the ground truth for every new website and edit.
                </p>
              </div>
              {designPreferences.templateId && (
                <button
                  onClick={() => onTemplateSelect(null)}
                  className="text-[10px] font-mono text-white/40 hover:text-white/70 underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
            <TemplateGallery
              selectedId={designPreferences.templateId}
              onSelect={(id) => onTemplateSelect(id)}
            />
            {designPreferences.savedAt && (
              <p className="text-[9px] font-mono text-emerald-400/70 mt-3 flex items-center gap-1.5">
                <CheckCircle2 size={10} /> Saved · {new Date(designPreferences.savedAt).toLocaleString()}
              </p>
            )}
          </motion.div>

          {/* ─── BRAND-SNAP CANVAS (relocated from landing page) ─────────────── */}
          <motion.div
            id="brand-snap"
            variants={itemVariants}
            className="md:col-span-2 p-5 rounded-xl"
            style={{ background: "var(--nazai-card-bg)", border: "1px solid var(--nazai-border-light)" }}
          >
            <div className="mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 font-mono" style={{ color: "var(--nazai-text-color)" }}>
                <Wand2 size={16} className="text-cyan-400" /> BRAND-SNAP CANVAS
              </h3>
              <p className="text-[10px] font-mono text-white/40 mt-1">
                Drop logos, palettes, or screenshots — the AI Guardian auto-checks contrast, palette, and grid.
              </p>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/5 bg-black/20">
              <GuardianCanvas />
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

// ============================================================
// COMFORT DESIGNS — TEMPLATE GALLERY (reused in Settings + Welcome modal)
// ============================================================
const TemplateGallery: React.FC<{
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}> = ({ selectedId, onSelect, compact = false }) => {
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"}`}>
      {COMFORT_TEMPLATES.map((tpl) => {
        const Icon = tpl.icon;
        const isActive = selectedId === tpl.id;
        return (
          <motion.button
            key={tpl.id}
            type="button"
            onClick={() => onSelect(tpl.id)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={`group relative text-left rounded-xl overflow-hidden border transition-all ${
              isActive
                ? "border-cyan-400/70 shadow-[0_0_24px_rgba(6,182,212,0.35)]"
                : "border-white/10 hover:border-white/25"
            }`}
            style={{ background: "rgba(255,255,255,0.02)" }}
            aria-pressed={isActive}
            aria-label={`Use template ${tpl.name}`}
          >
            {/* Thumbnail (gradient + icon) */}
            <div
              className="relative w-full"
              style={{ aspectRatio: "16 / 9", background: tpl.gradient }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center backdrop-blur-md"
                  style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.25)" }}
                >
                  <Icon size={22} className="text-white drop-shadow" />
                </div>
              </div>
              {isActive && (
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-cyan-400 text-[#020617] text-[9px] font-bold tracking-wider flex items-center gap-1">
                  <CheckCircle2 size={10} /> ACTIVE
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="p-3">
              <div className="text-[12px] font-semibold text-white/90 leading-tight">{tpl.name}</div>
              <div className="text-[10px] font-mono text-white/40 mt-1 leading-snug">{tpl.tagline}</div>
              <div
                className={`mt-2.5 text-[10px] font-bold tracking-wider uppercase font-mono px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-all ${
                  isActive
                    ? "bg-cyan-400/15 text-cyan-300 border border-cyan-400/40"
                    : "bg-white/5 text-white/60 border border-white/10 group-hover:bg-white/10"
                }`}
              >
                {isActive ? (
                  <><CheckCircle2 size={10} /> Current template</>
                ) : (
                  "Use this template"
                )}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
};

// ============================================================
// WELCOME TEMPLATE MODAL — first-visit Comfort Designs picker
// ============================================================
const WelcomeTemplateModal: React.FC<{
  open: boolean;
  onClose: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ open, onClose, selectedId, onSelect }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xl"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: "spring", damping: 24, stiffness: 320 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-3xl rounded-2xl border border-white/10 overflow-hidden"
          style={{ background: "linear-gradient(180deg, #0b1220 0%, #020617 100%)" }}
          role="dialog"
          aria-labelledby="welcome-template-title"
        >
          <div className="flex items-start justify-between px-6 pt-6 pb-3">
            <div>
              <div className="text-[10px] font-mono tracking-[0.3em] text-cyan-400 uppercase mb-1">
                Welcome · Comfort Designs
              </div>
              <h2 id="welcome-template-title" className="text-xl font-bold text-white tracking-tight">
                What design would you choose for a more comfortable usage?
              </h2>
              <p className="text-[12px] text-white/50 mt-1">
                Pick a starting style — you can always change it later in Settings.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg border border-white/10 hover:border-white/30 flex items-center justify-center text-white/50 hover:text-white transition-all"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-6 pb-6 max-h-[70vh] overflow-y-auto">
            <TemplateGallery selectedId={selectedId} onSelect={onSelect} />
            <button
              onClick={onClose}
              className="mt-5 text-[11px] font-mono text-white/40 hover:text-white/70 underline underline-offset-2"
            >
              Skip for now
            </button>
          </div>
        </motion.div>
      </motion.div>
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


// ─── FIX PROMPT BLANK — secondary single-line iteration input ────────────────
//   Rendered in HomeView once a website has been generated. Replaces the
//   three-mode switcher with a clean, focused "Fix" line. When submitted,
//   it forces SANDBOX mode and routes through handleSendMessage, which
//   detects inSandboxEditMode and prefixes the active code as
//   [INSERT_ACTIVE_WEBSITE_CODE] for surgical edits.
// Quick-action chips surfaced above the Iteration Bar. Each chip dispatches a
// pre-baked iteration directive that the contextual memory bridge in
// handleSendMessage will rewrite against the live `activeWebsiteCode` snapshot.
const ITERATION_QUICK_ACTIONS: { label: string; directive: string; icon: any; requiresReference?: boolean }[] = [
  {
    label: "Match Reference",
    directive:
      "Adapt the current website to closely match the attached style reference image(s). Mirror the colors, typography, spacing rhythm, glassmorphism level, accent style, and overall vibe — while preserving all existing functionality, copy, and content structure.",
    icon: ImageIcon,
    requiresReference: true,
  },
  {
    label: "Regenerate",
    directive: "Regenerate the current preview from scratch — keep the same intent and brand vibe but improve layout, hierarchy, copy and visual polish.",
    icon: RefreshCw,
  },
  {
    label: "Improve Assets",
    directive: "Upgrade every visual asset (icons, illustrations, hero imagery, gradients) to a premium, production-ready level. Keep the structure intact.",
    icon: Sparkles,
  },
  {
    label: "Verify",
    directive: "Audit the current code for accessibility, responsive breakpoints, broken refs, and Tailwind class hygiene. Return the cleaned, fully-fixed code.",
    icon: ShieldCheck,
  },
  {
    label: "Asset Studio",
    directive: "Open Asset Studio mode: produce a coherent UI kit (buttons, cards, badges, hero, footer) using the existing brand palette. Return the full updated component.",
    icon: Palette,
  },
];

type ReferenceImage = { id: string; name: string; dataUrl: string; size: number };

const FixPromptBlank = ({
  isPending,
  onSend,
}: {
  isPending: boolean;
  onSend: (text: string, opts?: { referenceImages?: ReferenceImage[] }) => void;
}) => {
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<ReferenceImage[]>([]);
  const [useAsStyleRef, setUseAsStyleRef] = useState(true);
  const refInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_REFS = 4;
  const MAX_BYTES = 8 * 1024 * 1024;

  const addFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const slots = Math.max(0, MAX_REFS - refs.length);
    files.slice(0, slots).forEach((file) => {
      if (file.size > MAX_BYTES) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) return;
        setRefs((prev) => [
          ...prev,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, dataUrl, size: file.size },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeRef = (id: string) => setRefs((prev) => prev.filter((r) => r.id !== id));

  const submit = (override?: string, opts?: { requiresReference?: boolean }) => {
    const t = (override ?? text).trim();
    if (!t || isPending) return;
    if (opts?.requiresReference && refs.length === 0) {
      // Trigger upload picker if user clicked Match Reference without a ref
      refInputRef.current?.click();
      return;
    }
    const referenceImages = useAsStyleRef && refs.length ? refs : undefined;
    onSend(t, { referenceImages });
    if (!override) setText("");
  };

  return (
    <div className="w-full px-0 sm:px-4 space-y-2">
      <input
        ref={refInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          if (refInputRef.current) refInputRef.current.value = "";
        }}
      />

      {/* ── Quick action chips — always visible above the Iteration Bar ── */}
      <div className="flex flex-wrap gap-1.5 px-1">
        {ITERATION_QUICK_ACTIONS.map((action) => {
          const disabled = isPending || (action.requiresReference ? false : false);
          const armed = action.requiresReference && refs.length > 0;
          return (
            <button
              key={action.label}
              type="button"
              disabled={disabled}
              onClick={() => submit(action.directive, { requiresReference: action.requiresReference })}
              className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.18em] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: armed
                  ? "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(6,182,212,0.14))"
                  : "rgba(6,182,212,0.06)",
                border: `1px solid ${armed ? "rgba(139,92,246,0.55)" : "rgba(6,182,212,0.28)"}`,
                color: armed ? "#c4b5fd" : "#67e8f9",
                backdropFilter: "blur(12px)",
              }}
              title={action.requiresReference && refs.length === 0
                ? "Click to upload a reference image first"
                : action.directive}
            >
              <action.icon size={10} className="shrink-0 transition-transform group-hover:scale-110" />
              {action.label}
              {action.requiresReference && refs.length > 0 && (
                <span className="ml-0.5 text-[9px] opacity-80">·{refs.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Reference thumbnails strip ───────────────────────────────────── */}
      <AnimatePresence>
        {refs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="flex items-center gap-2 px-2 py-2 rounded-xl"
              style={{
                background: "rgba(10,14,23,0.7)",
                border: "1px solid rgba(139,92,246,0.28)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="flex items-center gap-1.5 shrink-0 pl-1 pr-2 border-r border-white/5">
                <ImageIcon size={11} className="text-violet-300/80" />
                <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-violet-300/80">
                  Refs · {refs.length}/{MAX_REFS}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
                {refs.map((r) => (
                  <div key={r.id} className="relative group shrink-0">
                    <img
                      src={r.dataUrl}
                      alt={r.name}
                      className="w-10 h-10 rounded-md object-cover border border-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => removeRef(r.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 border border-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove ${r.name}`}
                    >
                      <X size={8} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-white/50">
                  Use as style ref
                </span>
                <button
                  type="button"
                  onClick={() => setUseAsStyleRef((v) => !v)}
                  className="relative w-7 h-3.5 rounded-full transition-colors"
                  style={{
                    background: useAsStyleRef ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.12)",
                  }}
                  aria-pressed={useAsStyleRef}
                  aria-label="Toggle use as style reference"
                >
                  <span
                    className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all"
                    style={{ left: useAsStyleRef ? 14 : 2 }}
                  />
                </button>
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: 1,
          y: 0,
          boxShadow: [
            "0 0 0 1px rgba(6,182,212,0.45), 0 0 18px rgba(6,182,212,0.25)",
            "0 0 0 1px rgba(6,182,212,0.7), 0 0 32px rgba(6,182,212,0.55)",
            "0 0 0 1px rgba(6,182,212,0.45), 0 0 18px rgba(6,182,212,0.25)",
          ],
        }}
        transition={{
          opacity: { duration: 0.3 },
          y: { duration: 0.3 },
          boxShadow: { duration: 2.6, repeat: Infinity, ease: "easeInOut" },
        }}
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
        style={{
          background: "rgba(10,14,23,0.95)",
          border: "1px solid rgba(6,182,212,0.55)",
          backdropFilter: "blur(20px)",
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files?.length) {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }
        }}
      >
        <Wand2 size={14} className="text-cyan-400 shrink-0" />
        <span className="text-[9px] font-mono tracking-[0.22em] uppercase text-cyan-400/70 hidden sm:inline">
          Fix
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={isPending}
          placeholder={refs.length ? "Describe how to apply the reference style..." : "Tell NazAI what to fix or improve..."}
          className="flex-1 bg-transparent outline-none text-sm font-mono text-white placeholder:text-white/30 disabled:opacity-50"
          autoFocus
        />
        <button
          type="button"
          onClick={() => refInputRef.current?.click()}
          disabled={isPending || refs.length >= MAX_REFS}
          className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 hover:bg-white/5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            color: refs.length ? "#c4b5fd" : "rgba(255,255,255,0.65)",
          }}
          title={refs.length >= MAX_REFS ? "Maximum 4 reference images" : "Upload reference image(s)"}
          aria-label="Upload reference image"
        >
          <Paperclip size={13} />
        </button>
        <button
          type="button"
          onClick={() => submit()}
          disabled={isPending || !text.trim()}
          className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
          style={{
            background: "#06b6d4",
            color: "#020617",
            boxShadow: "0 0 14px rgba(6,182,212,0.6)",
          }}
          aria-label="Apply fix"
        >
          <Send size={13} />
        </button>
      </motion.div>
      <div className="text-[9px] font-mono text-white/30 px-2">
        {refs.length
          ? `Iteration mode · ${refs.length} style reference${refs.length > 1 ? "s" : ""} ${useAsStyleRef ? "active" : "paused"} — NazAI will match colors, type, spacing, and vibe`
          : "Iteration mode · drop or attach reference image(s) to match a visual style"}
      </div>
    </div>
  );
};


// ─── HOME VIEW WITH ENHANCED PROMPT CARDS (SANDBOX ONLY) ──────────────────────────
const HomeView = ({ 
  errorMessage, messages, activeTool, initialCards, auraProfile, currentTheme, isPending,
  handleSendMessage, handleKeyDown, handleTextareaFocus, handleTextareaBlur, handleSendPointerDown,
  setSelectedModel, setPlusMenuOpen, setDrawerOpen, textareaRef, inputContainerRef, messagesEndRef,
  formatAIResponse, getRgbFromHex, laserShineAnimation, userMissionAssets, setUserMissionAssets,
  activeAssetIndex, setActiveAssetIndex, isDragOver, setIsDragOver,
  promptMode, setPromptMode,
  sandboxText, setSandboxText,
  extractorData, setExtractorData,
  editablePrompt, setEditablePrompt,
  isWebsiteComplete,
  isMinimized, setIsMinimized,
  hapticStatus,
  selectedTemplate, setSelectedTemplate,
  fileInputRef,
  cameraInputRef,
  isWebsiteIntent,
  setIsWebsiteIntent,
  lastWebsitePrompt,
  isIterationMode,
  onEditTrigger,
  editPulse,
  isPreviewActive,
  setIsPreviewActive,
  activeWebsiteCode,
  previewThemeRevision,
  generationRunId,
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
  const isExpandedMode = !isWebsiteComplete && (promptMode === "extractor" || promptMode === "blueprint");

  // Latest AI response text — fed to the WebsiteRevealPane strategy column.
  const latestAiText: string = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "ai") return messages[i].text || "";
    }
    return "";
  })();

  // Refine handler: forwards a "rewrite this snippet with this instruction"
  // follow-up directive into the existing send pipeline.
  const handleRefine = (selected: string, instruction: string) => {
    const refinePrompt =
      `[REFINE_DIRECTIVE: EXECUTIONER]\n` +
      `Rewrite the following snippet according to the instruction. ` +
      `Return only the improved version.\n\n` +
      `INSTRUCTION: ${instruction}\n\n` +
      `SNIPPET:\n"""\n${selected}\n"""`;
    handleSendMessage(refinePrompt);
  };

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

            {/* Command Center is now anchored beneath the website preview
                inside WebsiteRevealPane — no duplicate render here. */}
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
                <div className="max-w-[85%] rounded-xl overflow-hidden border border-border bg-card/80">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-secondary/20">
                    <Brain size={12} className="text-primary" />
                    <span className="text-[9px] font-mono font-bold tracking-wider text-primary">
                      NazAI
                    </span>
                  </div>
                  <div className="px-3 py-2.5">{formatAIResponse(msg.text)}</div>
                  {/* Verification chip · Reasoning trace · Approve as ground truth */}
                  <AIResponseExtras
                    text={msg.text}
                    messageId={`msg-${i}-${(msg.text || "").slice(0, 40)}`}
                    prompt={
                      // Prefer the immediately preceding user prompt as context
                      messages
                        .slice(0, i)
                        .reverse()
                        .find((m: any) => m.role === "user")?.text ?? ""
                    }
                  />
                </div>
              </>
            )}
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ─── WEBSITE REVEAL SPLIT-PANE — only for website-build directives ─── */}
      <AnimatePresence>
        {isWebsiteIntent && isPreviewActive && (
          <motion.div
            key="website-reveal"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="absolute inset-0 z-30 pb-[88px]"
          >
            <WebsiteRevealPane
              responseText={latestAiText}
              isPending={isPending}
              isWebsiteComplete={isWebsiteComplete}
              directive={lastWebsitePrompt}
              activeWebsiteCode={activeWebsiteCode}
              previewRevision={previewThemeRevision}
              generationRunId={generationRunId}
              onRefine={handleRefine}
              onEditTrigger={onEditTrigger}
            />
            {/* Leave Preview — keeps the build alive, just hides the pane */}
            <button
              type="button"
              onClick={() => setIsPreviewActive(false)}
              className="absolute top-2 right-3 z-50 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors hover:bg-white/5"
              style={{
                background: "rgba(9,9,11,0.9)",
                border: "1px solid #27272a",
                color: "#a1a1aa",
              }}
              aria-label="Leave preview"
            >
              Leave Preview
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Floating "Return to Preview" safety-net button ─────────────────── */}
      <AnimatePresence>
        {isWebsiteIntent && !isPreviewActive && (
          <motion.button
            key="return-to-preview"
            type="button"
            onClick={() => setIsPreviewActive(true)}
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              boxShadow: [
                "0 0 0 1px rgba(6,182,212,0.55), 0 0 18px rgba(6,182,212,0.35)",
                "0 0 0 1px rgba(6,182,212,0.85), 0 0 32px rgba(6,182,212,0.7)",
                "0 0 0 1px rgba(6,182,212,0.55), 0 0 18px rgba(6,182,212,0.35)",
              ],
            }}
            exit={{ opacity: 0, y: 24, scale: 0.9 }}
            transition={{
              opacity: { duration: 0.25 },
              y: { type: "spring", stiffness: 320, damping: 26 },
              scale: { type: "spring", stiffness: 320, damping: 26 },
              boxShadow: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            className="absolute bottom-[110px] right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full font-mono text-[11px] tracking-wider uppercase"
            style={{
              background: "rgba(255,255,255,0.08)",
              backdropFilter: "blur(14px) saturate(140%)",
              WebkitBackdropFilter: "blur(14px) saturate(140%)",
              border: "1px solid rgba(6,182,212,0.6)",
              color: "#06b6d4",
            }}
            aria-label="Return to website preview"
          >
            <Maximize2 size={13} />
            Return to Preview
          </motion.button>
        )}
      </AnimatePresence>

      {/* Selected Engine Badge removed — orchestration is now automatic */}

      {/* ─── ENHANCED PROMPT CARDS - ONLY VISIBLE IN SANDBOX MODE ─── */}
      {/* Cards float well above the input box so they aren't visually overlapping it */}
      <div 
        className="absolute left-1/2 z-40 w-full max-w-2xl pointer-events-none"
        style={{ 
          bottom: "240px",
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

      {/* ─── HAPTIC SYNC STATUS BANNER (Kinetic UI) ─── */}
      <AnimatePresence>
        {hapticStatus && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-[60] px-3.5 py-1.5 rounded-full flex items-center gap-2 text-[10px] font-mono tracking-wider"
            style={{
              background: "rgba(6,182,212,0.08)",
              border: "1px solid rgba(6,182,212,0.35)",
              color: "#06b6d4",
              boxShadow: "0 0 18px rgba(6,182,212,0.25)",
              backdropFilter: "blur(12px)",
            }}
          >
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-cyan-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            />
            HAPTIC SYNC // {hapticStatus}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── ITERATION MODE BADGE — floats above the input pill once a website is live ── */}
      <AnimatePresence>
        {isIterationMode && (
          <motion.div
            key="iteration-badge"
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-[0.22em] pointer-events-none"
            style={{
              bottom: isMinimized ? 70 : 240,
              background: "rgba(6,182,212,0.08)",
              border: "1px solid rgba(6,182,212,0.45)",
              color: "#06b6d4",
              boxShadow: "0 0 22px rgba(6,182,212,0.35)",
              backdropFilter: "blur(12px)",
            }}
          >
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-cyan-400"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
            Iteration Mode Active
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── ADAPTIVE WORKBENCH INPUT CONTAINER WITH HEIGHT ANIMATION ─── */}
      <motion.div
        ref={inputContainerRef}
        className="fixed bottom-4 left-1/2 z-40 w-[94%] sm:w-full sm:max-w-2xl -translate-x-1/2 rounded-3xl"
        style={{
          pointerEvents: "auto",
          isolation: "isolate",
        }}
        animate={
          editPulse
            ? {
                boxShadow: [
                  "0 0 0 0px rgba(6,182,212,0)",
                  "0 0 0 4px rgba(6,182,212,0.45), 0 0 48px rgba(6,182,212,0.65)",
                  "0 0 0 2px rgba(6,182,212,0.25), 0 0 24px rgba(6,182,212,0.35)",
                  "0 0 0 0px rgba(6,182,212,0)",
                ],
              }
            : { boxShadow: "0 0 0 0px rgba(6,182,212,0)" }
        }
        transition={{ duration: 2, ease: "easeOut" }}
      >
        {isMinimized ? (
          // ── Sleek 48px chat bar — focuses center of screen on AI output ──
          <motion.button
            type="button"
            onClick={() => setIsMinimized(false)}
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 48 }}
            exit={{ opacity: 0, y: 20, height: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            whileHover={{ scale: 1.005 }}
            className="w-full px-4 sm:px-5 flex items-center gap-3 rounded-2xl shadow-2xl text-left"
            style={{
              height: 48,
              background: "rgba(10, 14, 23, 0.95)",
              border: `1px solid rgba(${getRgbFromHex(auraProfile.glowPrimary)},0.35)`,
              backdropFilter: "blur(20px)",
              color: "var(--nazai-text-color)",
            }}
            title="Continue mission"
          >
            <motion.span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: auraProfile.glowPrimary, boxShadow: `0 0 8px ${auraProfile.glowPrimary}` }}
              animate={isPending ? { opacity: [0.3, 1, 0.3] } : { opacity: 1 }}
              transition={{ duration: 1.1, repeat: isPending ? Infinity : 0 }}
            />
            <span className="text-[11px] font-mono tracking-wider text-white/70 flex-1 truncate">
              {isPending ? "Neural Architect orchestrating…" : "Continue mission"}
            </span>
            <span className="text-[9px] font-mono text-white/40 hidden sm:inline">OPEN FIX BAR</span>
            <ChevronRight size={14} className="text-white/40 rotate-[-90deg]" />
          </motion.button>
        ) : isWebsiteComplete ? (
          // ── Iteration mode: single-line "Fix" prompt with cyan glow ──────
          //    The three-mode switcher is intentionally hidden once a site
          //    has been generated. Any text typed here is treated as an
          //    edit on the active code via handleSendMessage's
          //    inSandboxEditMode branch (promptMode is forced to sandbox).
          <FixPromptBlank
            isPending={isPending}
            onSend={(text: string, opts) => {
              if (promptMode !== "sandbox") setPromptMode("sandbox");
              setSandboxText(text);
              handleSendMessage(text, {
                source: "iteration",
                referenceImages: opts?.referenceImages,
              });
            }}
          />
        ) : (
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
                {/* Engine Switcher removed — orchestration is now automatic (handleSendMessage injects SYSTEM_ORCHESTRATION directive) */}
              </div>

              <div className="flex gap-2">
                {/* Think Tank button removed — agent orchestration runs silently
                    via SYSTEM_ORCHESTRATION; chat surface stays focused on dialogue. */}

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
        )}
      </motion.div>
      
      <ModeInfoModal isOpen={infoModalOpen} onClose={() => setInfoModalOpen(false)} />
    </div>
  );
};

// ─── PROJECT MEMORY PANEL ────────────────────────────────────────────────────
// Shows outputs the user has explicitly "Approved" as ground truth via the
// AIResponseExtras component. Persisted in localStorage; updates live via
// the custom 'nazai-ground-truth-changed' event dispatched on save.
function ProjectMemoryPanel() {
  const [entries, setEntries] = useState<GroundTruthEntry[]>(() => readGroundTruth());
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const refresh = () => setEntries(readGroundTruth());
    window.addEventListener("nazai-ground-truth-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("nazai-ground-truth-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div
      className="px-2 pt-2 pb-1 shrink-0"
      style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Shield size={11} className="text-emerald-400/80" />
          <span className="text-[9px] font-mono font-bold tracking-[0.22em] uppercase text-white/45">
            Project Memory
          </span>
          {entries.length > 0 && (
            <span
              className="text-[8px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.35)",
                color: "#86efac",
              }}
            >
              {entries.length}
            </span>
          )}
        </div>
        <ChevronDown
          size={11}
          className="text-white/30 transition-transform"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-1 pt-1 pb-1 space-y-1 max-h-[160px] overflow-y-auto">
              {entries.length === 0 ? (
                <p className="text-[9px] font-mono text-white/25 px-2 py-2 leading-relaxed">
                  Approve any AI output to lock it in as ground truth for future runs.
                </p>
              ) : (
                entries.map((e) => (
                  <div
                    key={e.id}
                    className="px-2 py-1.5 rounded text-[10px] font-mono"
                    style={{
                      background: "rgba(34,197,94,0.04)",
                      border: "1px solid rgba(34,197,94,0.18)",
                    }}
                    title={e.excerpt}
                  >
                    <div className="text-white/80 truncate">{e.prompt}</div>
                    <div className="text-white/40 text-[9px] truncate mt-0.5">{e.excerpt}</div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

      {/* ── Project Memory · Approved Ground Truth ─────────────────────── */}
      <ProjectMemoryPanel />

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
  const [userContext, setUserContext] = useState<UserContext>(() => {
    if (typeof window === "undefined") return DEFAULT_USER_CONTEXT;
    try {
      const raw = localStorage.getItem("nazai-user-context");
      if (raw) return { ...DEFAULT_USER_CONTEXT, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_USER_CONTEXT;
  });

  // ─── Comfort Designs (Ground Truth) ─────────────────────────────────────────
  const [designPreferences, setDesignPreferences] = useState<DesignPreferences>(loadDesignPreferences);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<"brand-snap" | "comfort-designs" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem("nazai-welcome-template-seen");
    if (!seen && !designPreferences.templateId) {
      const t = setTimeout(() => setWelcomeOpen(true), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false);
    try { localStorage.setItem("nazai-welcome-template-seen", "1"); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get("settings");
    if (target === "brand-snap" || target === "comfort-designs") {
      setSettingsFocus(target as "brand-snap" | "comfort-designs");
    }
  }, []);

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

  // Reward gate: Command Center checklist only appears once a website has been generated
  const [isWebsiteComplete, setIsWebsiteComplete] = useState(false);

  // Website Reveal split-pane: activates when the user issues a website-build directive.
  const [isWebsiteIntent, setIsWebsiteIntent] = useState(false);
  const [lastWebsitePrompt, setLastWebsitePrompt] = useState("");

  // Live-Edit Sandbox Bridge: derived flag — true once a website is rendered in
  // the preview pane. New sandbox prompts are then treated as iteration commands.
  const isIterationMode = isWebsiteIntent && isWebsiteComplete;

  // Sent-state minimization (shrinks the prompt pill into a 48px chat bar so the AI output owns the screen)
  const [isMinimized, setIsMinimized] = useState(false);

  // Haptic Sync transient status message
  const [hapticStatus, setHapticStatus] = useState<string | null>(null);

  // Pencil-edit pulse: highlights the input pill for ~2s when triggered
  const [editPulse, setEditPulse] = useState(false);

  // Live-Edit Sandbox Bridge: snapshot of the most recently generated website
  // output (raw response text or extracted code). When the user types in
  // SANDBOX mode after a build, this is fed back to the AI as `[CurrentCode]`
  // so it performs surgical edits instead of regenerating an unrelated site.
  const ACTIVE_WEBSITE_STORAGE_KEY = "nazai-active-website-code";
  const [activeWebsiteCode, setActiveWebsiteCode] = useState<string>(() => {
    // Auto-restore the last live preview so refresh / re-login doesn't wipe work.
    try {
      return localStorage.getItem(ACTIVE_WEBSITE_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  // Auto-save on every change (debounced via microtask). Strips itself if empty.
  useEffect(() => {
    try {
      if (activeWebsiteCode) {
        localStorage.setItem(ACTIVE_WEBSITE_STORAGE_KEY, activeWebsiteCode);
      } else {
        localStorage.removeItem(ACTIVE_WEBSITE_STORAGE_KEY);
      }
    } catch {
      /* quota or disabled storage — no-op */
    }
  }, [activeWebsiteCode]);
  const [generationRunId, setGenerationRunId] = useState(0);
  const [previewThemeRevision, setPreviewThemeRevision] = useState(0);

  // ─── Comfort Designs: instant template apply ────────────────────────────────
  // Updates persisted preferences AND restyles the live preview iframe in
  // milliseconds by injecting a CSS override block. No AI roundtrip.
  const applyComfortTemplate = useCallback((id: string | null) => {
    // Use functional updates so re-clicks always operate on the freshest state.
    setDesignPreferences((prev) => {
      const next: DesignPreferences = {
        ...prev,
        templateId: id,
        savedAt: new Date().toISOString(),
      };
      saveDesignPreferences(next);
      return next;
    });

    // Force-restyle the live preview, even on re-click of the active template.
    // Strip any existing comfort-theme block first, then inject a fresh preset.
    setActiveWebsiteCode((prev) => {
      const base = prev || buildStarterWebsiteHtml(lastWebsitePrompt || "NazAI website preview");
      const restyled = applyTemplateThemeToHtml(base, id);
      // Always add a fresh invisible marker so the iframe remounts even when the
      // same active template is re-clicked and the CSS output is byte-identical.
      const marker = `<!-- comfort-theme:${id ?? "none"}:${Date.now()} -->`;
      return restyled.includes("</body>")
        ? restyled.replace(/<\/body>/i, `${marker}</body>`)
        : restyled + marker;
    });
    setPreviewThemeRevision((rev) => rev + 1);
    setIsWebsiteIntent(true);
    setIsWebsiteComplete(true);
    setIsPreviewActive(true);

    if (id) {
      const tpl = COMFORT_TEMPLATES.find((t) => t.id === id);
      toast.success(`Design applied · ${tpl?.name ?? "Template"} ✓`, {
        description: "Live preview restyled. Future edits will follow this design.",
        duration: 1800,
      });
    } else {
      toast.success("Template cleared", {
        description: "Preview restored to default styling.",
        duration: 1500,
      });
    }
  }, [lastWebsitePrompt]);


  // ── "Return to Preview" safety net ──────────────────────────────────────────
  // Keeps the website preview pane alive when the user temporarily leaves it.
  // When false, a floating glass "Return to Preview" button appears.
  const [isPreviewActive, setIsPreviewActive] = useState(true);

  // Whenever a new website-build directive fires, re-arm the preview.
  useEffect(() => {
    if (isWebsiteIntent) setIsPreviewActive(true);
  }, [isWebsiteIntent]);

  const handleEditTrigger = useCallback(() => {
    // 1. Force sandbox mode for free-form iteration commands
    setPromptMode("sandbox");
    // 2. Pulse the input pill (cyan glow) for ~2s
    setEditPulse(true);
    setTimeout(() => setEditPulse(false), 2200);
    // 3. Scroll the input into view
    requestAnimationFrame(() => {
      inputContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      textareaRef.current?.focus();
    });
    // 4. Soft haptic confirmation
    try {
      window.navigator?.vibrate?.([12, 6, 12]);
    } catch {
      /* noop */
    }
  }, []);

  // ── Live-Edit Sandbox Bridge: once the website is live, auto-switch the
  //    prompt mode to SANDBOX so the user can issue iteration commands inline.
  useEffect(() => {
    if (isIterationMode) {
      setPromptMode("sandbox");
    }
  }, [isIterationMode]);

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

  // Auto-open Settings + scroll to focused section when arriving via deep-link
  useEffect(() => {
    if (!settingsFocus) return;
    setShowSettings(true);
    setActiveNav("settings");
    const anchor = settingsFocus;
    requestAnimationFrame(() => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      setSettingsFocus(null);
    });
  }, [settingsFocus]);

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
  const handleSendMessage = useCallback(async (
    overridePrompt?: string,
    options?: {
      source?: "iteration";
      referenceImages?: { name: string; dataUrl: string }[];
    },
  ) => {
    let masterPrompt = typeof overridePrompt === "string" && overridePrompt.trim().length > 0
      ? overridePrompt
      : compileMasterPrompt();
    const trimmed = masterPrompt.trim();
    const visiblePrompt =
      typeof overridePrompt === "string" && overridePrompt.trim().length > 0
        ? overridePrompt.trim()
        : promptMode === "sandbox"
          ? sandboxText.trim() || "Generate a strategic business blueprint."
          : promptMode === "extractor"
            ? `Business blueprint: ${extractorData.industry || "industry TBD"}`
            : editablePrompt.trim() || "Generate a professional business blueprint.";

    if (isPending || trimmed.length === 0) {
      return;
    }

    if (!userId) {
      console.error("MISSION ABORTED: No User ID found.");
      setErrorMessage("Please sign in to save your progress.");
      return;
    }

    // ── Kinetic UI: Haptic Feedback ───────────────────────────────────────────
    // Pulse-pattern vibration on supported devices/wearables, plus a transient
    // "Haptic Sync" status banner so the user feels the asset's weight & texture
    // being processed before the visual result appears.
    try {
      if (typeof window !== "undefined" && window.navigator && typeof window.navigator.vibrate === "function") {
        window.navigator.vibrate([20, 10, 20]);
      }
    } catch {
      /* vibration unsupported — silent fallback */
    }
    setHapticStatus("Transmitting physical data to wearable interface...");
    setTimeout(() => setHapticStatus(null), 1800);

    // ── Sent animation: collapse prompt pill into a sleek 48px chat bar ───────
    setIsMinimized(true);

    // ── Auto-Orchestration: hidden system instruction telling the AI to pick
    //    the fastest + most accurate multi-agent toolchain for this directive.
    const ORCHESTRATION_DIRECTIVE =
      `[SYSTEM_ORCHESTRATION: AUTO]\n` +
      `Select the fastest and most accurate tools available via multi-agent ` +
      `orchestration based on the user's specific input. Route reasoning to the ` +
      `strongest model, delegate creative or media tasks to specialized agents, ` +
      `and parallelize independent steps. Do not ask the user which engine to use.\n\n`;

    // ── Anti-Repetition: force high-entropy, bespoke architectural responses.
    //    The AI must NEVER fall back on a static template — every output must
    //    be derived from this user's specific industry, vibe, and constraints.
    //    A unique seed (timestamp + random) is injected to break any caching
    //    or template-matching heuristics on the model side.
    const { industry: extIndustry, audience: extAudience, budget: extBudget, vibe: extVibe } = extractorData || {} as any;
    const VARIANCE_SEED = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const ANTI_REPETITION_DIRECTIVE =
      `[SYSTEM_ENTROPY: HIGH | SEED: ${VARIANCE_SEED}]\n` +
      `You are an Elite Web Architect. Do NOT use generic templates. ` +
      `Analyze the user's specific Industry, Vibe, and Audience. Create a ` +
      `bespoke, one-of-a-kind React component structure for every request. ` +
      `If the user is a "Gym Owner in [city]", the layout must look ` +
      `different than a "Crypto Startup in London" — different sections, ` +
      `different hierarchy, different color palette, different copy tone. ` +
      `Use Tailwind CSS utility classes and Lucide React icons exclusively ` +
      `to keep the output high-class, modern, and production-ready. ` +
      `Reject any template-style output.\n` +
      `EXTRACTOR_VARIABLES:\n` +
      `  • industry=${extIndustry || "(infer from prompt)"}\n` +
      `  • audience=${extAudience || "(infer from prompt)"}\n` +
      `  • budget=${extBudget || "(infer from prompt)"}\n` +
      `  • vibe=${extVibe || "(infer from prompt)"}\n` +
      `  • identity=${userContext?.identity || "(unspecified)"}\n` +
      `  • goals=${userContext?.goals || "(unspecified)"}\n` +
      `  • style=${userContext?.style || "(unspecified)"}\n\n`;

    masterPrompt = ORCHESTRATION_DIRECTIVE + ANTI_REPETITION_DIRECTIVE + masterPrompt;

    // ── Intent detection ──────────────────────────────────────────────────────
    //  • If a website is already live in the preview pane → treat any new
    //    sandbox prompt as an Iteration Command (e.g. "make the header red").
    //  • Otherwise, if the user asks for a website / landing page / site,
    //    inject the high-priority website-build directive.
    const lowerPrompt = trimmed.toLowerCase();
    const isRefine = trimmed.startsWith("[REFINE_DIRECTIVE");
    const websiteIntent =
      /\b(website|web\s*site|landing\s*page|landing|site|webpage|web\s*page|homepage|micro[-\s]?site)\b/.test(
        lowerPrompt,
      );

    // ── Context Bridge: when in SANDBOX after a generated site, treat any
    //    new prompt as a surgical edit on the active code, regardless of
    //    whether the new prompt re-mentions "website".
    const inSandboxEditMode =
      options?.source === "iteration" || (isWebsiteComplete && promptMode === "sandbox" && !isRefine);

    let shouldActivateWebsitePreview = false;

    if ((isWebsiteComplete && isWebsiteIntent && !isRefine) || inSandboxEditMode) {
      // ── Iteration Command: edit the existing live preview in place ─────────
      //    Inject the current website code so the AI performs surgical edits
      //    rather than regenerating an unrelated site.
      const currentCodeSnapshot = (activeWebsiteCode || "").trim() || buildStarterWebsiteHtml(lastWebsitePrompt || visiblePrompt);
      const instantCode = applyInstantWebsiteEdit(currentCodeSnapshot, visiblePrompt);
      if (instantCode !== activeWebsiteCode) {
        setActiveWebsiteCode(instantCode);
        setIsWebsiteIntent(true);
        setIsWebsiteComplete(true);
      }
      const refs = options?.referenceImages ?? [];
      const styleReferenceBlock = refs.length
        ? `[STYLE_REFERENCE_IMAGES: ${refs.length} attached]\n` +
          `INSTRUCTION: Analyze the reference image(s) below for colors, typography, spacing, glassmorphism level, accent style, and overall vibe. Adapt the current website to closely match the reference while preserving functionality and content structure. Treat the references as authoritative for visual style.\n` +
          refs
            .map(
              (r, i) =>
                `REFERENCE_${i + 1} (${r.name}): ${r.dataUrl.slice(0, 120)}…[truncated dataURL — full image attached to the multimodal payload]`,
            )
            .join("\n") +
          `\n\n`
        : "";
      const designPrefDirective = buildDesignPreferenceDirective(designPreferences);
      masterPrompt =
        `SYSTEM (HARD RULE — CODE OUTPUT MODE):\n` +
        `When the user asks to generate, build, modify, or edit a website or any visual component, ALWAYS output complete, valid, runnable code that can be applied directly to the live preview. Never respond with only text descriptions, summaries, strategies, or explanations unless the user explicitly asks for non-code content.\n` +
        `You are given the COMPLETE latest source code of the live preview below. First analyze the existing code carefully. Then make precise, targeted edits ONLY to the requested parts. Preserve everything else exactly. Never regenerate the entire site from scratch unless the user says "regenerate full site".\n` +
        `Return ONLY ONE complete, standalone HTML document inside a single \`\`\`html fenced block. Inline CSS/JS. No markdown prose, no TSX imports, no partial snippets, no explanations before or after.\n\n` +
        designPrefDirective +
        PREMIUM_WEBSITE_QUALITY_GUIDELINES +
        styleReferenceBlock +
        `[ITERATION_DIRECTIVE: LIVE_EDIT]\n` +
        `REQUESTED_CHANGE: ${visiblePrompt}\n` +
        `LAST_BUILD_DIRECTIVE: ${lastWebsitePrompt}\n\n` +
        `[COMPLETE_LATEST_LIVE_PREVIEW_SOURCE]\n\`\`\`html\n${instantCode}\n\`\`\`\n\n` +
        `[COMPLETE_PREVIEW_COMPONENT_TREE]\nWebsiteRevealPane > GeneratedWebsitePreview iframe[srcDoc] > activeWebsiteCode. The code above is the full rendered preview source.\n\n` +
        masterPrompt;
    } else if (websiteIntent) {
      shouldActivateWebsitePreview = true;
      setIsWebsiteIntent(true);
      setLastWebsitePrompt(trimmed);
      setActiveWebsiteCode(buildStarterWebsiteHtml(trimmed));
      const designPrefDirective = buildDesignPreferenceDirective(designPreferences);
      masterPrompt =
        `[PRIORITY_DIRECTIVE: WEBSITE_BUILD]\n` +
        `SYSTEM (HARD RULE — CODE OUTPUT MODE): Always output complete runnable code, never text-only explanations.\n` +
        `Return ONLY ONE complete, standalone HTML document inside a single \`\`\`html fenced block, with inline CSS/JS that renders in iframe srcDoc. No prose before or after the fence.\n` +
        `Use the user's exact prompt to create a bespoke premium website tailored to that business. Adapt sections, copy, visual emphasis, palette, typography, and imagery to the prompt — never reuse the same template across users.\n\n` +
        designPrefDirective +
        PREMIUM_WEBSITE_QUALITY_GUIDELINES +
        masterPrompt;
    }

    setIsPending(true);
    if (shouldActivateWebsitePreview || isWebsiteIntent || inSandboxEditMode) {
      setGenerationRunId((run) => run + 1);
    }

    if (currentAbortControllerRef.current) {
      currentAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    currentAbortControllerRef.current = controller;

    const userMessage = masterPrompt.trim();
    const aiMsgIndex = messages.length + 1;

    setErrorMessage(null);
    
    setMessages((prev) => [
      ...prev,
      { role: "user", text: visiblePrompt },
      { role: "ai", text: "Neural Architect: Processing blueprint..." },
    ]);

    // Secondary haptic pulse — confirms the agent processing phase is engaged
    try {
      window.navigator?.vibrate?.([15, 8, 15, 8, 25]);
    } catch {
      /* noop */
    }
    setHapticStatus("Synchronizing agent telemetry with wearable interface...");
    setTimeout(() => setHapticStatus(null), 2200);

    let missionToUpdateId = activeMissionId;
    let finalResponseText = "";

    try {
      if (missionToUpdateId) {
        // ── PROJECT CHAT CONTINUITY ──────────────────────────────────────────
        // We are inside an existing project thread (initial generation already
        // happened). DO NOT overwrite `directive` — that is the root prompt of
        // the thread and must be preserved so the conversation stays unified.
        // Only bump `updated_at` so the mission floats to the top of the feed.
        console.log("TITAN: Continuing existing project thread:", missionToUpdateId);
        await supabase
          .from("missions")
          .update({
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
            directive: visiblePrompt,
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
            prompt: savedMission.directive ?? visiblePrompt,
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

      const outputText = result.data?.plan || result.data?.response || result.data?.text || result.data?.content || `Blueprint ready.`;
      const generatedCode = extractGeneratedCode(outputText);
      finalResponseText = outputText;

      setMessages((prev) => {
        const updated = [...prev];
        if (updated[aiMsgIndex]) {
          updated[aiMsgIndex] = { ...updated[aiMsgIndex], text: outputText };
        }
        return updated;
      });

      // Reward gate: if AI confirms a website was generated, unlock Command Center
      const out = (outputText || "").toLowerCase();
      const websiteGenerated =
        /\b(website|landing\s*page|site|webpage|homepage)\b/.test(out) &&
        /\b(generated|built|created|deployed|ready|live|published|done|complete)\b/.test(out);
      if (websiteGenerated || shouldActivateWebsitePreview || inSandboxEditMode) {
        setIsWebsiteComplete(true);
      }
      // Snapshot the generated output so SANDBOX iteration prompts can feed
      // it back to the AI as `[CurrentCode]` for surgical edits.
      // CRITICAL: during an iteration, NEVER overwrite the live preview with a
      // fresh starter — if the AI returned prose-only, keep the previous code.
      if (shouldActivateWebsitePreview || isWebsiteIntent || websiteGenerated || inSandboxEditMode) {
        let appliedCodeChange = false;
        setActiveWebsiteCode((prev) => {
          const candidate = (generatedCode || outputText || "").trim();
          if (hasPreviewHtml(candidate)) {
            appliedCodeChange = candidate !== prev;
            return candidate;
          }
          if (hasPreviewHtml(prev)) return prev; // preserve live preview
          // First build with no usable HTML yet → fall back to bespoke starter
          return buildStarterWebsiteHtml(lastWebsitePrompt || visiblePrompt);
        });
        if (appliedCodeChange && inSandboxEditMode) {
          // Lightweight inline confirmation — no extra deps, dismisses itself.
          try {
            const { toast } = await import("sonner");
            toast.success("Preview updated ✓", { duration: 1800 });
          } catch { /* noop */ }
        }
      }

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
  }, [isPending, messages.length, selectedModel, userId, activeStyle, webSearchActive, activeMissionId, fetchMissions, compileMasterPrompt, extractorData, userContext, isWebsiteComplete, isWebsiteIntent, lastWebsitePrompt, activeWebsiteCode, promptMode, sandboxText, editablePrompt, designPreferences]);

  // ─── Listen for checklist / external action directives ────────────────────
  // The CommandCenterChecklist (and any other Dashboard widget) can dispatch
  // a `nazai:run-directive` CustomEvent to push a prompt straight into the
  // chat pipeline as if the user typed it. This keeps onboarding cards
  // functional without prop-drilling a callback through WebsiteRevealPane.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { directive?: string; source?: string }
        | undefined;
      const directive = detail?.directive?.trim();
      if (!directive) return;
      handleSendMessage(directive);
    };
    window.addEventListener("nazai:run-directive", handler as EventListener);
    return () =>
      window.removeEventListener("nazai:run-directive", handler as EventListener);
  }, [handleSendMessage]);

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
    // ── PROJECT CHAT CONTINUITY ──────────────────────────────────────────────
    // Re-entering an existing project thread: pin `activeMissionId` so every
    // subsequent Iteration Bar message is appended to THIS thread instead of
    // spawning a new mission row. Hydrate the original directive as the first
    // message so the conversation visibly starts from the original prompt.
    setActiveMissionId(mission.id);
    setActiveNav("home");
    setShowSettings(false);
    setIsSidebarOpen(false);
    const hydrated: { role: "user" | "ai"; text: string }[] = [
      { role: "user", text: mission.prompt || "" },
    ];
    if (mission.response) {
      hydrated.push({ role: "ai", text: mission.response });
    }
    setMessages(hydrated);
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
            designPreferences={designPreferences}
            setDesignPreferences={setDesignPreferences}
            onTemplateSelect={applyComfortTemplate}
            initialFocus={settingsFocus}
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
            isWebsiteComplete={isWebsiteComplete}
            isMinimized={isMinimized}
            setIsMinimized={setIsMinimized}
            hapticStatus={hapticStatus}
            isWebsiteIntent={isWebsiteIntent}
            setIsWebsiteIntent={setIsWebsiteIntent}
            lastWebsitePrompt={lastWebsitePrompt}
            isIterationMode={isIterationMode}
            onEditTrigger={handleEditTrigger}
            editPulse={editPulse}
            isPreviewActive={isPreviewActive}
            setIsPreviewActive={setIsPreviewActive}
            activeWebsiteCode={activeWebsiteCode}
            previewThemeRevision={previewThemeRevision}
            generationRunId={generationRunId}
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

        <AnimatePresence>
          {isWebsiteIntent && activeNav !== "home" && (
            <motion.button
              key="global-return-to-preview"
              type="button"
              onClick={() => {
                setActiveNav("home");
                setShowSettings(false);
                setIsPreviewActive(true);
              }}
              initial={{ opacity: 0, y: 24, scale: 0.92 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                boxShadow: [
                  "0 0 0 1px rgba(6,182,212,0.55), 0 0 18px rgba(6,182,212,0.35)",
                  "0 0 0 1px rgba(6,182,212,0.85), 0 0 32px rgba(6,182,212,0.7)",
                  "0 0 0 1px rgba(6,182,212,0.55), 0 0 18px rgba(6,182,212,0.35)",
                ],
              }}
              exit={{ opacity: 0, y: 24, scale: 0.92 }}
              transition={{
                opacity: { duration: 0.2 },
                y: { type: "spring", stiffness: 320, damping: 26 },
                scale: { type: "spring", stiffness: 320, damping: 26 },
                boxShadow: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
              className="fixed bottom-10 right-6 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-full font-mono text-[11px] tracking-wider uppercase"
              style={{
                background: "rgba(255,255,255,0.08)",
                backdropFilter: "blur(14px) saturate(140%)",
                WebkitBackdropFilter: "blur(14px) saturate(140%)",
                border: "1px solid rgba(6,182,212,0.6)",
                color: "#06b6d4",
              }}
              aria-label="Return to website preview"
            >
              <Maximize2 size={13} />
              Return to Preview
            </motion.button>
          )}
        </AnimatePresence>
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

      {/* First-visit Comfort Designs welcome modal */}
      <WelcomeTemplateModal
        open={welcomeOpen}
        onClose={closeWelcome}
        selectedId={designPreferences.templateId}
        onSelect={(id) => {
          applyComfortTemplate(id);
          closeWelcome();
        }}
      />

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

      {/* Chat surface shows clean dialogue history only.
          Iteration is driven by the secondary "Fix" prompt rendered in HomeView. */}
    </div>
  );
}
