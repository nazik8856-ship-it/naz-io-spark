import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Palette = {
  bg: string; surface: string; text: string; accent: string;
  accentSecondary: string; muted: string; border: string;
};
type Theme = {
  palette: Palette;
  font: { heading: string; body: string; mono?: string; display?: string };
  vibe?: string;
  layout?: string;
  motion?: string;
  design_rationale?: string;
};

type Section = { type: string; variant?: string; content: Record<string, unknown> };
type Page = {
  id: string;
  slug: string;
  title: string;
  seo_description: string | null;
  sections: Section[];
  order_index: number;
};
type Website = {
  id: string;
  name: string | null;
  tagline: string | null;
  theme: Partial<Theme> | null;
};

const DEFAULT_PALETTE: Palette = {
  bg: "#0B0B0F",
  surface: "#151520",
  text: "#F4F4F5",
  accent: "#00A3FF",
  accentSecondary: "#7C3AED",
  muted: "rgba(255,255,255,0.6)",
  border: "rgba(255,255,255,0.1)",
};

const DEFAULT_THEME: Theme = {
  palette: DEFAULT_PALETTE,
  font: { heading: "Inter", body: "Inter" },
  layout: "centered",
  motion: "subtle",
};

function fieldStr(o: Record<string, unknown>, k: string, fallback = ""): string {
  const v = o[k];
  return typeof v === "string" ? v : fallback;
}
function fieldArr<T = Record<string, unknown>>(o: Record<string, unknown>, k: string): T[] {
  const v = o[k];
  return Array.isArray(v) ? (v as T[]) : [];
}
function fieldStrArr(o: Record<string, unknown>, k: string): string[] {
  const v = o[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function fieldBool(o: Record<string, unknown>, k: string): boolean {
  return !!o[k];
}

// Deterministic hash → stable seed
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}
// PRNG from a numeric seed
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Bespoke SVG "signature" — gradient mesh + geometric marks — deterministic per (prompt+palette).
// Guarantees every site gets a unique visual identity instead of stock photography.
function signatureSvg(prompt: string, w: number, h: number, palette: Palette): string {
  const seed = seedFrom(prompt + "|" + palette.accent + "|" + palette.accentSecondary);
  const rand = rng(seed);
  const a = palette.accent;
  const b = palette.accentSecondary || palette.accent;
  const bg = palette.surface;
  const marks: string[] = [];
  const kind = seed % 4;
  const n = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const r = 40 + Math.floor(rand() * Math.min(w, h) * 0.35);
    const op = 0.10 + rand() * 0.35;
    const c = i % 2 === 0 ? a : b;
    if (kind === 0) {
      marks.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${op.toFixed(2)}" filter="url(#blur)"/>`);
    } else if (kind === 1) {
      const x2 = Math.floor(rand() * w);
      const y2 = Math.floor(rand() * h);
      marks.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${1 + rand() * 3}" opacity="${op.toFixed(2)}"/>`);
    } else if (kind === 2) {
      const size = r;
      const rot = Math.floor(rand() * 360);
      marks.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="none" stroke="${c}" stroke-width="1.5" opacity="${op.toFixed(2)}" transform="rotate(${rot} ${x + size / 2} ${y + size / 2})"/>`);
    } else {
      marks.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="1" opacity="${op.toFixed(2)}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><radialGradient id="g" cx="${20 + rand() * 60}%" cy="${20 + rand() * 60}%" r="80%"><stop offset="0%" stop-color="${a}" stop-opacity="0.7"/><stop offset="55%" stop-color="${b}" stop-opacity="0.35"/><stop offset="100%" stop-color="${bg}" stop-opacity="1"/></radialGradient><filter id="blur"><feGaussianBlur stdDeviation="${20 + rand() * 40}"/></filter></defs><rect width="${w}" height="${h}" fill="${bg}"/><rect width="${w}" height="${h}" fill="url(#g)"/>${marks.join("")}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function photoUrl(prompt: string, w: number, h: number): string {
  const seed = seedFrom(prompt);
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

function imageUrl(prompt: string, w: number, h: number, palette: Palette, mediaStyle?: string): string {
  const style = (mediaStyle || "").toLowerCase();
  if (style === "photo") return photoUrl(prompt, w, h);
  // default: bespoke signature (illustration/gradient/pattern) — no external dependency, unique per site
  return signatureSvg(prompt, w, h, palette);
}

// ─── Thematic motif system ────────────────────────────────────────────────
// A small library of subject icons expressed as SVG paths. The renderer picks
// one based on keywords in the site name/tagline/prompt so every decorative
// element (pattern, dividers, stats markers, footer) reinforces the theme.
const MOTIFS: Record<string, string> = {
  coffee: "M6 8h9a4 4 0 010 8h-1M6 8v9a3 3 0 003 3h3a3 3 0 003-3v-1M6 8H4",
  leaf: "M4 20c8 0 16-8 16-16-8 0-16 8-16 16zM4 20l8-8",
  spark: "M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4",
  wave: "M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0",
  mountain: "M3 20l6-10 4 6 3-4 5 8H3z",
  gear: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 3v3M12 18v3M5 5l2 2M17 17l2 2M3 12h3M18 12h3M5 19l2-2M17 7l2-2",
  code: "M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16",
  brush: "M4 20c6-2 10-6 12-12l-4-4C6 6 2 10 4 20z",
  camera: "M4 8h4l2-3h4l2 3h4v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z",
  music: "M9 18V6l10-2v12M9 18a2 2 0 11-4 0 2 2 0 014 0zM19 16a2 2 0 11-4 0 2 2 0 014 0z",
  plane: "M2 12l20-8-8 20-2-8-10-4z",
  book: "M4 4h7a4 4 0 014 4v12H8a4 4 0 01-4-4V4zM20 4h-5",
  dumbbell: "M6 8v8M4 10v4M10 6v12M18 6v12M14 8v8M20 10v4M10 12h4",
  home: "M3 12l9-8 9 8v9h-6v-6H9v6H3z",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20V8",
  flame: "M12 2c2 4 6 6 6 11a6 6 0 01-12 0c0-3 2-4 3-7 1 2 3 2 3-4z",
  diamond: "M6 3h12l4 6-10 12L2 9z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  star: "M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z",
  flower: "M12 3a3 3 0 100 6 3 3 0 000-6zM12 15a3 3 0 100 6 3 3 0 000-6zM6 12a3 3 0 10-6 0 3 3 0 006 0zM24 12a3 3 0 10-6 0 3 3 0 006 0z",
  compass: "M12 2a10 10 0 100 20 10 10 0 000-20zM8 16l3-7 5-1-2 7z",
  hotel: "M3 21V10l9-6 9 6v11h-6v-6H9v6z",
  paw: "M6 12a2 2 0 11-4 0 2 2 0 014 0zM22 12a2 2 0 11-4 0 2 2 0 014 0zM10 6a2 2 0 11-4 0 2 2 0 014 0zM18 6a2 2 0 11-4 0 2 2 0 014 0zM12 22c4 0 6-4 6-6a4 4 0 00-12 0c0 2 2 6 6 6z",
  scissors: "M6 4l14 14M6 20L20 6M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 20a2 2 0 11-4 0 2 2 0 014 0z",
  bike: "M5 18a3 3 0 100-6 3 3 0 000 6zM19 18a3 3 0 100-6 3 3 0 000 6zM5 15l4-8h4l3 8M9 7l6 8",
};

const MOTIF_KEYWORDS: [RegExp, keyof typeof MOTIFS][] = [
  [/coffee|cafe|espresso|roast|barista|latte/i, "coffee"],
  [/wellness|yoga|meditat|spa|therap|calm|mindful/i, "flower"],
  [/leaf|plant|garden|botan|nature|eco|sustain|forest|organic/i, "leaf"],
  [/mountain|hike|adventure|outdoor|climb|trail|explore/i, "mountain"],
  [/wave|surf|ocean|sea|beach|swim|marine|water|pool/i, "wave"],
  [/photo|camera|film|cinema|videograph/i, "camera"],
  [/music|band|dj|record|sound|audio|vinyl/i, "music"],
  [/travel|flight|tour|airline|voyage/i, "plane"],
  [/book|library|read|publish|literature|novel|editor/i, "book"],
  [/gym|fitness|workout|train|strength|athlet|crossfit|pilates/i, "dumbbell"],
  [/pet|dog|cat|vet|animal|groom/i, "paw"],
  [/salon|barber|hair|beauty|nails/i, "scissors"],
  [/bike|cycle|cycling|bicycle/i, "bike"],
  [/hotel|hospitality|resort|inn|bnb|stay/i, "hotel"],
  [/real estate|property|realtor|interior|home|architect/i, "home"],
  [/analytic|data|finance|invest|market|trading|fintech/i, "chart"],
  [/food|restaurant|kitchen|chef|dining|bake|patisserie|bistro/i, "flame"],
  [/luxury|jewel|diamond|premium|prestige|couture/i, "diamond"],
  [/energy|electric|power|solar|voltage|charge/i, "bolt"],
  [/award|elite|premier|top|hall of fame/i, "star"],
  [/code|dev|software|api|engineer|program|saas|app|platform|ai\b/i, "code"],
  [/art|paint|design|brand|creative|craft|illustrat/i, "brush"],
  [/mechan|auto|machin|industri|manufactur|garage/i, "gear"],
  [/compass|discovery|journey|guide/i, "compass"],
];

function motifFromPrompt(text: string): { key: string; path: string } {
  const t = (text || "").toLowerCase();
  for (const [re, key] of MOTIF_KEYWORDS) {
    if (re.test(t)) return { key, path: MOTIFS[key] };
  }
  return { key: "spark", path: MOTIFS.spark };
}

// Tiled background pattern: subtle dot grid seeded with the site's motif at a
// randomized position — every site gets a distinct decorative weave.
function patternDataUri(motifPath: string, palette: Palette, seed: number): string {
  const rand = rng(seed);
  const c = palette.accent;
  const c2 = palette.accentSecondary || c;
  const size = 180;
  const dots: string[] = [];
  for (let x = 10; x < size; x += 22) {
    for (let y = 10; y < size; y += 22) {
      dots.push(`<circle cx="${x}" cy="${y}" r="0.9" fill="${c}" opacity="0.30"/>`);
    }
  }
  const mx = Math.floor(rand() * (size - 60)) + 20;
  const my = Math.floor(rand() * (size - 60)) + 20;
  const rot = Math.floor(rand() * 360);
  const motif = `<g transform="translate(${mx} ${my}) rotate(${rot}) scale(1.4)"><path d="${motifPath}" fill="none" stroke="${c2}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${dots.join("")}${motif}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

// Grain overlay for texture — pure SVG turbulence, palette-agnostic.
const GRAIN_URI = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0"/></filter><rect width="200" height="200" filter="url(#n)"/></svg>`
)}")`;

// Reusable inline motif icon
function MotifIcon({ path, color, size = 20, strokeWidth = 1.6, className }: { path: string; color: string; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function SectionDivider({ path, palette }: { path: string; palette: Palette }) {
  return (
    <div className="nz-divider" aria-hidden="true">
      <span className="nz-divider-line" style={{ background: `linear-gradient(90deg, transparent, ${palette.accent}55, transparent)` }} />
      <MotifIcon path={path} color={palette.accent} size={18} strokeWidth={1.4} />
      <span className="nz-divider-line" style={{ background: `linear-gradient(90deg, transparent, ${palette.accent}55, transparent)` }} />
    </div>
  );
}

// Render a headline with optional highlight tokens: ~word~  or  **word**  → styled accent span.
function renderHeadline(text: string, palette: Palette, displayFont?: string): (string | JSX.Element)[] {
  if (!text) return [text];
  const parts = text.split(/(~[^~]+~|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^~([^~]+)~$|^\*\*([^*]+)\*\*$/);
    if (!m) return part;
    const inner = m[1] || m[2];
    return (
      <span
        key={i}
        className="nz-hl"
        style={{
          color: palette.accent,
          fontFamily: displayFont ? `'${displayFont}', serif` : undefined,
          fontStyle: "italic",
          fontWeight: 500,
        }}
      >
        {inner}
      </span>
    );
  });
}

// Simple safe formula: allow numbers, variable names, + - * / ( ) . spaces
function safeCalc(formula: string, vars: Record<string, number>): number | null {
  if (!formula) return null;
  if (!/^[\s\w+\-*/().]+$/.test(formula)) return null;
  const names = Object.keys(vars);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `"use strict"; return (${formula});`);
    const out = fn(...names.map((n) => vars[n] ?? 0));
    return typeof out === "number" && isFinite(out) ? out : null;
  } catch { return null; }
}

export default function WebsitePreview() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [site, setSite] = useState<Website | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string>(params.get("page") ?? "home");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: siteRow, error: siteErr }, { data: pageRows }] = await Promise.all([
        supabase.from("websites").select("id, name, tagline, theme").eq("id", id).maybeSingle(),
        supabase.from("website_pages").select("id, slug, title, seo_description, sections, order_index").eq("website_id", id).order("order_index", { ascending: true }),
      ]);
      if (cancelled) return;
      if (siteErr || !siteRow) {
        setError(siteErr?.message ?? "Website not found");
        setLoading(false);
        return;
      }
      setSite(siteRow as unknown as Website);
      setPages((pageRows ?? []) as unknown as Page[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const theme = useMemo<Theme>(() => {
    const t = site?.theme;
    if (!t || typeof t !== "object") return DEFAULT_THEME;
    return {
      palette: { ...DEFAULT_PALETTE, ...(t.palette ?? {}) },
      font: { ...DEFAULT_THEME.font, ...(t.font ?? {}) },
      vibe: t.vibe,
      layout: t.layout ?? "centered",
      motion: t.motion ?? "subtle",
      design_rationale: t.design_rationale,
    };
  }, [site]);

  const activePage = pages.find((p) => p.slug === activeSlug) ?? pages[0];

  // Fonts
  useEffect(() => {
    const families = [theme.font.heading, theme.font.body, theme.font.display, theme.font.mono]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) as string[];
    const parts = families.map((f) => `family=${f.replace(/\s+/g, "+")}:wght@300;400;500;600;700;800;900`);
    const href = `https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap`;
    const linkId = "nazai-website-fonts";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [theme]);

  // SEO
  useEffect(() => {
    if (!site) return;
    document.title = `${activePage?.title ?? site.name ?? "Site"} · ${site.name ?? ""}`.trim();
    const desc = activePage?.seo_description || site.tagline || "";
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = desc.slice(0, 160);
  }, [site, activePage]);

  // Scroll reveal + tilt + magnetic + scroll-driven bg shift
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (theme.motion === "none") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const root = rootRef.current;
    if (!root) return;

    // Reveal
    const revealEls = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).setAttribute("data-in", "1");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach((el) => io.observe(el));

    // Card tilt on hover (transform via CSS vars)
    const cards = root.querySelectorAll<HTMLElement>(".nz-card");
    const onCardMove = (ev: MouseEvent) => {
      const el = ev.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width - 0.5;
      const y = (ev.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--tx", `${(-y * 6).toFixed(2)}deg`);
      el.style.setProperty("--ty", `${(x * 8).toFixed(2)}deg`);
    };
    const onCardLeave = (ev: MouseEvent) => {
      const el = ev.currentTarget as HTMLElement;
      el.style.setProperty("--tx", "0deg");
      el.style.setProperty("--ty", "0deg");
    };
    cards.forEach((c) => {
      c.addEventListener("mousemove", onCardMove);
      c.addEventListener("mouseleave", onCardLeave);
    });

    // Magnetic pull on primary buttons
    const mags = root.querySelectorAll<HTMLElement>(".nz-btn-primary, [data-magnetic]");
    const onMagMove = (ev: MouseEvent) => {
      const el = ev.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      el.style.setProperty("--mx", `${(dx * 0.25).toFixed(1)}px`);
      el.style.setProperty("--my", `${(dy * 0.35).toFixed(1)}px`);
    };
    const onMagLeave = (ev: MouseEvent) => {
      const el = ev.currentTarget as HTMLElement;
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
    };
    mags.forEach((b) => {
      b.addEventListener("mousemove", onMagMove);
      b.addEventListener("mouseleave", onMagLeave);
    });

    // Scroll-driven background shift + parallax on hero image
    const sections = root.querySelectorAll<HTMLElement>("section");
    const onScroll = () => {
      const vh = window.innerHeight;
      let bestIdx = 0;
      let bestDist = Infinity;
      sections.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - vh / 2);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      // Subtly rotate the base hue every other section
      root.style.setProperty("--scroll-tint", bestIdx % 2 === 0 ? "0" : "1");
      // Parallax
      root.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const p = (r.top + r.height / 2 - vh / 2) / vh;
        el.style.transform = `translate3d(0, ${(-p * 24).toFixed(1)}px, 0)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      io.disconnect();
      cards.forEach((c) => {
        c.removeEventListener("mousemove", onCardMove);
        c.removeEventListener("mouseleave", onCardLeave);
      });
      mags.forEach((b) => {
        b.removeEventListener("mousemove", onMagMove);
        b.removeEventListener("mouseleave", onMagLeave);
      });
      window.removeEventListener("scroll", onScroll);
    };
  }, [theme, activePage]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm text-zinc-400">Loading preview…</span>
      </div>
    );
  }
  if (error || !site) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white gap-3">
        <p className="text-sm text-red-400">{error ?? "Site not found"}</p>
        <button onClick={() => navigate("/generator-home")} className="text-xs underline text-zinc-400">
          Back to generator
        </button>
      </div>
    );
  }

  const p = theme.palette;
  const layout = theme.layout ?? "centered";
  const containerMax =
    layout === "editorial" || layout === "magazine" ? "max-w-5xl" :
    layout === "brutalist" ? "max-w-7xl" :
    layout === "minimal-luxury" ? "max-w-4xl" :
    "max-w-6xl";

  // Scoped CSS — palette + fonts + animations
  const scopedCss = `
    .nz-root {
      --bg: ${p.bg}; --surface: ${p.surface}; --text: ${p.text};
      --accent: ${p.accent}; --accent2: ${p.accentSecondary};
      --muted: ${p.muted}; --border: ${p.border};
      background: var(--bg); color: var(--text);
      font-family: '${theme.font.body}', system-ui, sans-serif;
    }
    .nz-h { font-family: '${theme.font.display || theme.font.heading}', '${theme.font.heading}', system-ui, sans-serif; letter-spacing: -0.02em; }
    .nz-mono { font-family: '${theme.font.mono || "JetBrains Mono"}', ui-monospace, monospace; }
    .nz-root { --scroll-tint: 0; }
    .nz-root a { color: var(--accent); }
    .nz-btn-primary {
      background: var(--accent); color: var(--bg);
      --mx: 0px; --my: 0px;
      transform: translate3d(var(--mx), var(--my), 0);
      transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .3s ease, filter .3s ease;
    }
    .nz-btn-primary:hover { box-shadow: 0 18px 40px -14px var(--accent); filter: brightness(1.08); }
    .nz-btn-ghost { border: 1px solid var(--border); color: var(--text); transition: border-color .2s, background .2s, transform .3s ease; --mx:0px; --my:0px; transform: translate3d(var(--mx), var(--my), 0); }
    .nz-btn-ghost:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
    .nz-card {
      background: var(--surface); border: 1px solid var(--border);
      --tx: 0deg; --ty: 0deg;
      transform-style: preserve-3d;
      transform: perspective(900px) rotateX(var(--tx)) rotateY(var(--ty));
      transition: transform .35s cubic-bezier(.2,.7,.2,1), border-color .3s ease, box-shadow .3s ease;
    }
    .nz-card:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); box-shadow: 0 30px 60px -30px color-mix(in srgb, var(--accent) 50%, transparent); }
    .nz-input { background: color-mix(in srgb, var(--text) 6%, transparent); border: 1px solid var(--border); color: var(--text); }
    .nz-input:focus { outline: none; border-color: var(--accent); }
    .nz-hl { background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%); padding: 0 .12em; border-radius: 2px; }
    [data-reveal] { opacity: 0; transform: translateY(24px); transition: opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1); }
    [data-reveal][data-in="1"] { opacity: 1; transform: none; }
    [data-reveal-stagger] > * { opacity: 0; transform: translateY(20px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
    [data-reveal-stagger][data-in="1"] > * { opacity: 1; transform: none; }
    [data-reveal-stagger][data-in="1"] > *:nth-child(1) { transition-delay: .05s; }
    [data-reveal-stagger][data-in="1"] > *:nth-child(2) { transition-delay: .15s; }
    [data-reveal-stagger][data-in="1"] > *:nth-child(3) { transition-delay: .25s; }
    [data-reveal-stagger][data-in="1"] > *:nth-child(4) { transition-delay: .35s; }
    [data-reveal-stagger][data-in="1"] > *:nth-child(5) { transition-delay: .45s; }
    [data-reveal-stagger][data-in="1"] > *:nth-child(6) { transition-delay: .55s; }
    @keyframes nzFadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
    .nz-hero-in > * { animation: nzFadeUp .9s cubic-bezier(.2,.7,.2,1) both; }
    .nz-hero-in > *:nth-child(1) { animation-delay: .05s; }
    .nz-hero-in > *:nth-child(2) { animation-delay: .18s; }
    .nz-hero-in > *:nth-child(3) { animation-delay: .30s; }
    .nz-hero-in > *:nth-child(4) { animation-delay: .42s; }
    .nz-hero-in > *:nth-child(5) { animation-delay: .54s; }
    .nz-media { overflow: hidden; }
    .nz-media img { transition: transform .8s cubic-bezier(.2,.7,.2,1), filter .5s ease; width: 100%; height: 100%; object-fit: cover; display: block; }
    .nz-media:hover img { transform: scale(1.04); }
    .nz-gallery-item { position: relative; overflow: hidden; border-radius: 12px; }
    .nz-gallery-item .cap { position: absolute; inset: auto 0 0 0; padding: 12px; background: linear-gradient(to top, rgba(0,0,0,.7), transparent); color: #fff; font-size: 12px; transform: translateY(6px); opacity: 0; transition: .3s ease; }
    .nz-gallery-item:hover .cap { transform: none; opacity: 1; }
    .nz-link { position: relative; display: inline-block; }
    .nz-link::after { content: ""; position: absolute; left: 0; right: 0; bottom: -3px; height: 1px; background: var(--accent); transform: scaleX(0); transform-origin: right; transition: transform .3s ease; }
    .nz-link:hover::after { transform: scaleX(1); transform-origin: left; }
    section { transition: background-color .8s ease; }
  `;

  return (
    <div ref={rootRef} className="nz-root min-h-screen">
      <style>{scopedCss}</style>

      {/* Preview chrome */}
      <div className="sticky top-0 z-50 flex items-center justify-between gap-4 px-4 py-2.5 border-b backdrop-blur text-xs"
        style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.6)", color: "#fff" }}>
        <button onClick={() => navigate("/generator-home")} className="flex items-center gap-1.5 text-zinc-300 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="font-mono uppercase tracking-[0.24em] text-zinc-400 truncate">
          {site.name} · preview
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-[50%]">
          {pages.map((pg) => (
            <button
              key={pg.id}
              onClick={() => setActiveSlug(pg.slug)}
              className={`px-2.5 py-1 rounded-full border whitespace-nowrap ${
                activeSlug === pg.slug ? "border-white/60 bg-white/10" : "border-white/10 hover:border-white/30"
              }`}
            >
              {pg.title}
            </button>
          ))}
        </div>
      </div>

      {activePage?.sections.map((s, idx) => (
        <SectionBlock
          key={idx}
          section={s}
          palette={p}
          layout={layout}
          containerMax={containerMax}
          index={idx}
          displayFont={theme.font.display}
        />
      ))}

      {!activePage?.sections.length && (
        <div className="max-w-3xl mx-auto px-6 py-24 text-center opacity-70">
          <p>This page has no sections yet.</p>
        </div>
      )}

      <footer className="border-t px-6 py-8 text-center text-xs opacity-60" style={{ borderColor: p.border }}>
        © {new Date().getFullYear()} {site.name} · {site.tagline}
      </footer>
    </div>
  );
}

function SectionBlock({
  section, palette, layout, containerMax, index, displayFont,
}: {
  section: Section; palette: Palette; layout: string; containerMax: string; index: number; displayFont?: string;
}) {
  const c = section.content ?? {};
  const variant = section.variant ?? "";
  // Density contrast: stats/logos tighter, hero/about/testimonials spacious
  const dense = section.type === "stats" || section.type === "logos";
  const container = `${containerMax} mx-auto px-6 ${dense ? "py-10 md:py-14" : "py-20 md:py-28"}`;
  const headingCls = "nz-h text-3xl md:text-5xl font-bold tracking-tight mb-6";
  const eyebrow = "nz-mono text-[11px] uppercase tracking-[0.28em] mb-3";
  const heading = headingCls; // legacy alias used below

  switch (section.type) {
    case "hero":
      return <Hero c={c} variant={variant || (layout === "split" ? "split-image" : layout === "editorial" ? "editorial-lede" : layout === "brutalist" ? "asymmetric-mark" : layout === "minimal-luxury" ? "minimal-luxury" : "centered")} palette={palette} containerMax={containerMax} displayFont={displayFont} />;

    case "about":
      return (
        <section className={container} data-reveal>
          <div className={fieldStr(c, "image_prompt") ? "grid gap-10 md:grid-cols-2 items-center" : ""}>
            <div>
              <div className={eyebrow} style={{ color: palette.accent }}>About</div>
              <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "About"), palette, displayFont)}</h2>
              <p className="text-lg opacity-85 max-w-2xl">{fieldStr(c, "body")}</p>
              {fieldStrArr(c, "bullets").length > 0 && (
                <ul className="mt-6 grid gap-3 sm:grid-cols-2" data-reveal-stagger>
                  {fieldStrArr(c, "bullets").map((b, i) => (
                    <li key={i} className="flex gap-3">
                      <span style={{ backgroundColor: palette.accent }} className="mt-2 h-2 w-2 rounded-full shrink-0" />
                      <span className="opacity-90">{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {fieldStr(c, "pull_quote") && (
                <blockquote className="nz-h mt-8 text-2xl italic opacity-90 border-l-2 pl-5" style={{ borderColor: palette.accent }}>
                  "{fieldStr(c, "pull_quote")}"
                </blockquote>
              )}
            </div>
            {fieldStr(c, "image_prompt") && (
              <div className="nz-media rounded-2xl aspect-[4/5]" style={{ background: palette.surface }}>
                <img src={imageUrl(fieldStr(c, "image_prompt"), 1200, 1500, palette, fieldStr(c, "media_style"))} alt="" loading="lazy" />
              </div>
            )}
          </div>
        </section>
      );

    case "services": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      const v = variant || "cards";
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y" data-reveal>
          <div className={container} style={{ borderColor: palette.border }}>
            <div className={eyebrow} style={{ color: palette.accent }}>What we do</div>
            <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "Services"), palette, displayFont)}</h2>
            {v === "numbered" && (
              <div className="grid gap-8 md:grid-cols-2" data-reveal-stagger>
                {items.map((it, i) => (
                  <div key={i} className="flex gap-5">
                    <div className="nz-h text-5xl font-bold shrink-0" style={{ color: palette.accent }}>{String(i + 1).padStart(2, "0")}</div>
                    <div>
                      <h3 className="nz-h font-semibold text-xl mb-1">{fieldStr(it, "title")}</h3>
                      <p className="opacity-80 text-sm">{fieldStr(it, "description")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {v === "list" && (
              <ul className="divide-y" style={{ borderColor: palette.border }} data-reveal-stagger>
                {items.map((it, i) => (
                  <li key={i} className="py-5 flex items-baseline justify-between gap-6">
                    <h3 className="nz-h font-semibold text-2xl">{fieldStr(it, "title")}</h3>
                    <p className="opacity-70 max-w-md text-right text-sm">{fieldStr(it, "description")}</p>
                  </li>
                ))}
              </ul>
            )}
            {v === "zigzag" && (
              <div className="space-y-16">
                {items.map((it, i) => (
                  <div key={i} className={`grid gap-8 md:grid-cols-2 items-center ${i % 2 ? "md:[&>div:first-child]:order-2" : ""}`} data-reveal>
                    <div className="nz-media rounded-2xl aspect-[4/3]" style={{ background: palette.bg }}>
                      <img src={imageUrl(fieldStr(it, "image_prompt") || fieldStr(it, "title"), 1200, 900, palette)} alt="" loading="lazy" />
                    </div>
                    <div>
                      <div className={eyebrow} style={{ color: palette.accent }}>{String(i + 1).padStart(2, "0")}</div>
                      <h3 className="nz-h font-semibold text-2xl mb-2">{fieldStr(it, "title")}</h3>
                      <p className="opacity-80">{fieldStr(it, "description")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(v === "cards" || (v !== "numbered" && v !== "list" && v !== "zigzag")) && (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" data-reveal-stagger>
                {items.map((it, i) => (
                  <div key={i} className="nz-card rounded-xl p-6">
                    <div className="nz-mono text-xs uppercase tracking-[0.2em] mb-3" style={{ color: palette.accent }}>
                      {fieldStr(it, "icon", `0${i + 1}`)}
                    </div>
                    <h3 className="nz-h font-semibold text-lg mb-2">{fieldStr(it, "title")}</h3>
                    <p className="text-sm opacity-75">{fieldStr(it, "description")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      );
    }

    case "feature-split": {
      const reverse = fieldBool(c, "reverse") || index % 2 === 1;
      return (
        <section className={container} data-reveal>
          <div className={`grid gap-10 md:grid-cols-2 items-center ${reverse ? "md:[&>div:first-child]:order-2" : ""}`}>
            <div className="nz-media rounded-2xl aspect-[5/4]" style={{ background: palette.surface }}>
              <img src={imageUrl(fieldStr(c, "image_prompt") || fieldStr(c, "heading"), 1400, 1120, palette, fieldStr(c, "media_style"))} alt="" loading="lazy" />
            </div>
            <div>
              <h2 className={heading}>{renderHeadline(fieldStr(c, "heading"), palette, displayFont)}</h2>
              <p className="text-lg opacity-85">{fieldStr(c, "body")}</p>
              {fieldStrArr(c, "bullets").length > 0 && (
                <ul className="mt-6 space-y-2">
                  {fieldStrArr(c, "bullets").map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm opacity-90">
                      <span style={{ color: palette.accent }}>◆</span> {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      );
    }

    case "testimonials": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section className={container} data-reveal>
          <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "What clients say"), palette, displayFont)}</h2>
          <div className="grid gap-6 md:grid-cols-2" data-reveal-stagger>
            {items.map((it, i) => (
              <blockquote key={i} className="nz-card rounded-xl p-6 border-l-4" style={{ borderLeftColor: palette.accent }}>
                <p className="italic opacity-90 text-lg">"{fieldStr(it, "quote")}"</p>
                <footer className="mt-4 text-sm opacity-70">
                  — <span className="font-semibold">{fieldStr(it, "author")}</span>
                  {fieldStr(it, "role") && <span>, {fieldStr(it, "role")}</span>}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      );
    }

    case "gallery": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      const v = variant || "grid";
      const gridClass =
        v === "masonry" ? "columns-2 md:columns-3 lg:columns-4 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid" :
        v === "strip" ? "flex gap-4 overflow-x-auto snap-x" :
        v === "showcase" ? "grid gap-4 md:grid-cols-6" :
        "grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y" data-reveal>
          <div className={container} style={{ borderColor: palette.border }}>
            <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "Gallery"), palette, displayFont)}</h2>
            <div className={gridClass} data-reveal-stagger>
              {items.map((it, i) => {
                const showcaseSpan = v === "showcase" ? (i % 5 === 0 ? "md:col-span-4 md:row-span-2" : "md:col-span-2") : "";
                const stripSize = v === "strip" ? "min-w-[280px] snap-start aspect-[4/5]" : "";
                const heightClass = v === "masonry" ? (i % 3 === 0 ? "aspect-[3/4]" : i % 3 === 1 ? "aspect-square" : "aspect-[4/3]") : v === "showcase" ? "aspect-[4/3]" : v === "strip" ? "" : "aspect-square";
                return (
                  <div key={i} className={`nz-gallery-item ${showcaseSpan} ${stripSize} ${heightClass}`}
                    style={{ background: `linear-gradient(135deg, ${palette.accent}22, ${palette.accentSecondary}22)` }}>
                    <img src={imageUrl(fieldStr(it, "image_prompt") || fieldStr(it, "caption"), 900, 900, palette, "photo")} alt={fieldStr(it, "caption")} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {fieldStr(it, "caption") && <div className="cap">{fieldStr(it, "caption")}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    case "stats": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section className={container} data-reveal>
          {fieldStr(c, "heading") && <h2 className={heading}>{renderHeadline(fieldStr(c, "heading"), palette, displayFont)}</h2>}
          <div className="grid gap-8 grid-cols-2 md:grid-cols-4" data-reveal-stagger>
            {items.map((it, i) => (
              <div key={i}>
                <div className="nz-h text-4xl md:text-6xl font-bold" style={{ color: palette.accent }}>{fieldStr(it, "value")}</div>
                <div className="mt-2 text-sm opacity-70 uppercase tracking-wider">{fieldStr(it, "label")}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "process": {
      const steps = fieldArr<Record<string, unknown>>(c, "steps");
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y" data-reveal>
          <div className={container} style={{ borderColor: palette.border }}>
            <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "How it works"), palette, displayFont)}</h2>
            <div className="grid gap-8 md:grid-cols-3 relative" data-reveal-stagger>
              {steps.map((st, i) => (
                <div key={i} className="relative">
                  <div className="nz-mono text-xs opacity-60 mb-2">STEP {String(i + 1).padStart(2, "0")}</div>
                  <h3 className="nz-h font-semibold text-xl mb-2">{fieldStr(st, "title")}</h3>
                  <p className="opacity-80 text-sm">{fieldStr(st, "description")}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "cta":
      return (
        <section className={container} data-reveal>
          <div className="rounded-3xl px-8 py-16 md:py-24 text-center relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentSecondary})`, color: palette.bg }}>
            <h2 className="nz-h text-4xl md:text-6xl font-extrabold tracking-tight max-w-3xl mx-auto">
              {fieldStr(c, "headline")}
            </h2>
            {fieldStr(c, "subheadline") && (
              <p className="mt-4 text-lg opacity-90 max-w-xl mx-auto">{fieldStr(c, "subheadline")}</p>
            )}
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              {fieldStr(c, "cta_primary") && (
                <button className="px-6 py-3 rounded-lg font-semibold" style={{ background: palette.bg, color: palette.text }}>
                  {fieldStr(c, "cta_primary")}
                </button>
              )}
              {fieldStr(c, "cta_secondary") && (
                <button className="px-6 py-3 rounded-lg font-semibold border" style={{ borderColor: palette.bg, color: palette.bg }}>
                  {fieldStr(c, "cta_secondary")}
                </button>
              )}
            </div>
          </div>
        </section>
      );

    case "logos": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section className={container} data-reveal>
          {fieldStr(c, "heading") && <p className="text-center text-xs uppercase tracking-[0.28em] opacity-60 mb-8">{fieldStr(c, "heading")}</p>}
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-6 opacity-70">
            {items.map((it, i) => (
              <span key={i} className="nz-h font-semibold text-xl">{fieldStr(it, "name")}</span>
            ))}
          </div>
        </section>
      );
    }

    case "contact":
      return (
        <section className={container} data-reveal>
          <div className="grid gap-10 md:grid-cols-2 items-start">
            <div>
              <div className={eyebrow} style={{ color: palette.accent }}>Contact</div>
              <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "Get in touch"), palette, displayFont)}</h2>
              <p className="opacity-80">{fieldStr(c, "body")}</p>
              <ul className="mt-6 space-y-2 text-sm opacity-90">
                {fieldStr(c, "email") && <li><span className="nz-link">✉ {fieldStr(c, "email")}</span></li>}
                {fieldStr(c, "phone") && <li><span className="nz-link">☎ {fieldStr(c, "phone")}</span></li>}
                {fieldStr(c, "address") && <li>📍 {fieldStr(c, "address")}</li>}
              </ul>
            </div>
            <form className="nz-card rounded-xl p-6 space-y-3" onSubmit={(e) => { e.preventDefault(); alert("Thanks — we'll be in touch."); }}>
              {(fieldStrArr(c, "form_fields").length ? fieldStrArr(c, "form_fields") : ["Name", "Email", "Message"]).map((f, i) => (
                <div key={i}>
                  <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">{f}</label>
                  {f.toLowerCase().includes("message") ? (
                    <textarea rows={4} className="nz-input w-full rounded px-3 py-2 text-sm" />
                  ) : (
                    <input className="nz-input w-full rounded px-3 py-2 text-sm" />
                  )}
                </div>
              ))}
              <button type="submit" className="nz-btn-primary w-full rounded-lg py-2.5 font-semibold">Send</button>
            </form>
          </div>
        </section>
      );

    case "pricing": {
      const tiers = fieldArr<Record<string, unknown>>(c, "tiers");
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y" data-reveal>
          <div className={container} style={{ borderColor: palette.border }}>
            <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "Pricing"), palette, displayFont)}</h2>
            <div className="grid gap-6 md:grid-cols-3" data-reveal-stagger>
              {tiers.map((t, i) => {
                const featured = !!t.featured;
                return (
                  <div key={i} className="nz-card rounded-2xl p-6 flex flex-col"
                    style={{
                      background: palette.bg,
                      borderColor: featured ? palette.accent : palette.border,
                      transform: featured ? "scale(1.03)" : undefined,
                      boxShadow: featured ? `0 20px 60px -20px ${palette.accent}66` : undefined,
                    }}>
                    <div className="nz-mono text-xs uppercase tracking-[0.2em] opacity-70">{fieldStr(t, "name")}</div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="nz-h text-4xl font-bold">{fieldStr(t, "price")}</span>
                      {fieldStr(t, "period") && <span className="text-sm opacity-60">/{fieldStr(t, "period")}</span>}
                    </div>
                    <ul className="mt-5 space-y-2 text-sm flex-1">
                      {fieldStrArr(t, "features").map((f, j) => (
                        <li key={j} className="flex gap-2">
                          <span style={{ color: palette.accent }}>✓</span>
                          <span className="opacity-90">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button className={featured ? "nz-btn-primary mt-6 w-full rounded-lg py-2.5 font-semibold" : "nz-btn-ghost mt-6 w-full rounded-lg py-2.5 font-semibold"}>
                      {fieldStr(t, "cta", "Choose")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    case "faq": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section className={container} data-reveal>
          <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "FAQ"), palette, displayFont)}</h2>
          <div className="max-w-3xl space-y-3" data-reveal-stagger>
            {items.map((it, i) => (
              <details key={i} className="nz-card rounded-lg p-4 group">
                <summary className="cursor-pointer font-semibold flex justify-between items-center">
                  <span>{fieldStr(it, "q")}</span>
                  <span style={{ color: palette.accent }} className="ml-3">+</span>
                </summary>
                <p className="mt-3 opacity-80 text-sm">{fieldStr(it, "a")}</p>
              </details>
            ))}
          </div>
        </section>
      );
    }

    case "custom":
      return <CustomBlock c={c} palette={palette} container={container} heading={heading} eyebrow={eyebrow} displayFont={displayFont} />;

    default:
      return null;
  }
}

function Hero({
  c, variant, palette, containerMax, displayFont,
}: { c: Record<string, unknown>; variant: string; palette: Palette; containerMax: string; displayFont?: string }) {
  const rHead = (t: string) => renderHeadline(t, palette, displayFont);
  const eyebrow = fieldStr(c, "eyebrow");
  const headline = fieldStr(c, "headline", "Welcome");
  const subheadline = fieldStr(c, "subheadline");
  const ctaP = fieldStr(c, "cta_primary");
  const ctaS = fieldStr(c, "cta_secondary");
  const img = fieldStr(c, "image_prompt");
  const stats = fieldArr<Record<string, unknown>>(c, "stats");

  const eyebrowEl = eyebrow && (
    <div className="nz-mono text-[11px] uppercase tracking-[0.32em]" style={{ color: palette.accent }}>{eyebrow}</div>
  );
  const ctas = (
    <div className="flex items-center gap-3 flex-wrap">
      {ctaP && <button className="nz-btn-primary px-6 py-3 rounded-lg font-semibold">{ctaP}</button>}
      {ctaS && <button className="nz-btn-ghost px-6 py-3 rounded-lg font-semibold">{ctaS}</button>}
    </div>
  );

  if (variant === "split-image") {
    return (
      <section className="border-b" style={{ borderColor: palette.border }}>
        <div className={`${containerMax} mx-auto px-6 py-20 md:py-28 grid gap-10 md:grid-cols-2 items-center`}>
          <div className="nz-hero-in">
            {eyebrowEl}
            <h1 className="nz-h text-5xl md:text-7xl font-extrabold leading-[1.02] mt-3">{rHead(headline)}</h1>
            {subheadline && <p className="mt-5 text-lg opacity-80 max-w-lg">{subheadline}</p>}
            <div className="mt-8">{ctas}</div>
          </div>
          <div data-parallax className="nz-media rounded-3xl aspect-[4/5]" style={{ background: palette.surface }}>
            {img && <img src={imageUrl(img, 1200, 1500, palette, fieldStr(c, "media_style"))} alt="" />}
          </div>
        </div>
      </section>
    );
  }

  if (variant === "full-bleed") {
    return (
      <section className="relative overflow-hidden" style={{ minHeight: "88vh" }}>
        {img && (
          <div className="absolute inset-0 nz-media">
            <img src={imageUrl(img, 1920, 1200, palette, fieldStr(c, "media_style"))} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${palette.bg}77 0%, ${palette.bg}dd 100%)` }} />
          </div>
        )}
        <div className={`${containerMax} mx-auto px-6 py-32 md:py-44 relative nz-hero-in`}>
          {eyebrowEl}
          <h1 className="nz-h text-6xl md:text-8xl font-extrabold leading-[1.0] mt-3 max-w-4xl">{rHead(headline)}</h1>
          {subheadline && <p className="mt-6 text-xl opacity-90 max-w-2xl">{subheadline}</p>}
          <div className="mt-10">{ctas}</div>
        </div>
      </section>
    );
  }

  if (variant === "editorial-lede") {
    return (
      <section className="border-b" style={{ borderColor: palette.border }}>
        <div className={`${containerMax} mx-auto px-6 py-24 md:py-32 nz-hero-in`}>
          {eyebrowEl}
          <h1 className="nz-h text-6xl md:text-8xl font-black leading-[0.95] mt-4 max-w-5xl">{rHead(headline)}</h1>
          {subheadline && <p className="mt-8 text-xl opacity-80 max-w-2xl border-l-2 pl-6" style={{ borderColor: palette.accent }}>{subheadline}</p>}
          <div className="mt-10">{ctas}</div>
        </div>
      </section>
    );
  }

  if (variant === "asymmetric-mark") {
    return (
      <section className="relative overflow-hidden border-b" style={{ borderColor: palette.border }}>
        <div className="absolute -top-20 -right-20 w-[520px] h-[520px] rounded-full opacity-30 blur-3xl" style={{ background: palette.accent }} />
        <div className={`${containerMax} mx-auto px-6 py-24 md:py-36 grid md:grid-cols-12 gap-8 items-end relative nz-hero-in`}>
          <div className="md:col-span-8">
            {eyebrowEl}
            <h1 className="nz-h text-6xl md:text-8xl font-black leading-[0.95] mt-4">{rHead(headline)}</h1>
          </div>
          <div className="md:col-span-4">
            {subheadline && <p className="text-lg opacity-80">{subheadline}</p>}
            <div className="mt-6">{ctas}</div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === "minimal-luxury") {
    return (
      <section>
        <div className={`${containerMax} mx-auto px-6 py-32 md:py-48 text-center nz-hero-in`}>
          {eyebrowEl}
          <h1 className="nz-h text-5xl md:text-7xl font-light tracking-tight leading-[1.05] mt-4">{rHead(headline)}</h1>
          {subheadline && <p className="mt-8 text-lg opacity-70 max-w-xl mx-auto">{subheadline}</p>}
          <div className="mt-10 flex justify-center">{ctas}</div>
        </div>
      </section>
    );
  }

  // centered fallback
  return (
    <section className="border-b" style={{ borderColor: palette.border, background: `linear-gradient(135deg, ${palette.bg} 0%, ${palette.surface} 100%)` }}>
      <div className={`${containerMax} mx-auto px-6 py-28 md:py-36 text-center nz-hero-in`}>
        {eyebrowEl}
        <h1 className="nz-h text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] mt-3">{rHead(headline)}</h1>
        {subheadline && <p className="mt-6 text-lg md:text-xl opacity-80 max-w-2xl mx-auto">{subheadline}</p>}
        <div className="mt-10 flex justify-center">{ctas}</div>
        {stats.length > 0 && (
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {stats.map((s, i) => (
              <div key={i}>
                <div className="nz-h text-3xl md:text-4xl font-bold" style={{ color: palette.accent }}>{fieldStr(s, "value")}</div>
                <div className="text-xs opacity-70 uppercase tracking-wider mt-1">{fieldStr(s, "label")}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CustomBlock({
  c, palette, container, heading, eyebrow, displayFont,
}: { c: Record<string, unknown>; palette: Palette; container: string; heading: string; eyebrow: string; displayFont?: string }) {
  const kind = fieldStr(c, "kind");
  const fields = fieldArr<Record<string, unknown>>(c, "fields");
  const [values, setValues] = useState<Record<string, string>>({});

  if (kind === "calculator") {
    const nums: Record<string, number> = {};
    fields.forEach((f) => { nums[fieldStr(f, "name")] = parseFloat(values[fieldStr(f, "name")] || "0") || 0; });
    const result = safeCalc(fieldStr(c, "formula"), nums);
    return (
      <section className={container} data-reveal>
        <div className={eyebrow} style={{ color: palette.accent }}>Estimator</div>
        <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", "Quick estimate"), palette, displayFont)}</h2>
        <div className="grid gap-6 md:grid-cols-2 items-start">
          <div className="grid gap-4">
            {fields.map((f, i) => {
              const name = fieldStr(f, "name");
              const type = fieldStr(f, "type", "number");
              const opts = fieldStrArr(f, "options");
              return (
                <div key={i}>
                  <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">
                    {fieldStr(f, "label", name)} {fieldStr(f, "unit") && <span className="opacity-60">({fieldStr(f, "unit")})</span>}
                  </label>
                  {type === "select" ? (
                    <select className="nz-input w-full rounded px-3 py-2 text-sm"
                      value={values[name] || ""}
                      onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}>
                      {opts.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={type} className="nz-input w-full rounded px-3 py-2 text-sm"
                      value={values[name] || ""}
                      onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="nz-card rounded-2xl p-8 text-center">
            <div className="text-xs uppercase tracking-wider opacity-70">{fieldStr(c, "output_label", "Estimate")}</div>
            <div className="nz-h text-5xl md:text-6xl font-bold mt-3" style={{ color: palette.accent }}>
              {result !== null ? result.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
              {fieldStr(c, "output_unit") && <span className="text-2xl opacity-70 ml-2">{fieldStr(c, "output_unit")}</span>}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (kind === "newsletter") {
    return (
      <section className={container} data-reveal>
        <div className="nz-card rounded-2xl p-10 md:p-14 text-center max-w-2xl mx-auto">
          <h2 className="nz-h text-3xl md:text-4xl font-bold">{fieldStr(c, "heading", "Stay in the loop")}</h2>
          {fieldStr(c, "body") && <p className="mt-3 opacity-80">{fieldStr(c, "body")}</p>}
          <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); alert("Subscribed."); }}>
            <input type="email" required placeholder="you@email.com" className="nz-input flex-1 rounded px-4 py-3 text-sm" />
            <button className="nz-btn-primary rounded px-5 py-3 font-semibold text-sm">Subscribe</button>
          </form>
        </div>
      </section>
    );
  }

  // booking / quote / generic — real form
  return (
    <section className={container} data-reveal>
      <h2 className={heading}>{renderHeadline(fieldStr(c, "heading", kind || "Request"), palette, displayFont)}</h2>
      {fieldStr(c, "body") && <p className="opacity-80 max-w-2xl">{fieldStr(c, "body")}</p>}
      <form className="mt-8 nz-card rounded-2xl p-6 grid gap-4 md:grid-cols-2 max-w-3xl"
        onSubmit={(e) => { e.preventDefault(); alert("Request sent."); }}>
        {(fields.length ? fields : [
          { name: "name", label: "Name", type: "text" },
          { name: "email", label: "Email", type: "email" },
          { name: "date", label: "Date", type: "date" },
        ]).map((f, i) => {
          const name = fieldStr(f as Record<string, unknown>, "name");
          const type = fieldStr(f as Record<string, unknown>, "type", "text");
          return (
            <div key={i} className={type === "text" && name.toLowerCase().includes("message") ? "md:col-span-2" : ""}>
              <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">{fieldStr(f as Record<string, unknown>, "label", name)}</label>
              <input type={type} className="nz-input w-full rounded px-3 py-2 text-sm" />
            </div>
          );
        })}
        <div className="md:col-span-2">
          <button className="nz-btn-primary rounded-lg px-6 py-3 font-semibold">Submit</button>
        </div>
      </form>
    </section>
  );
}
