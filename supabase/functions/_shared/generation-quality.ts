// Visual-consistency checks and repairs, Strict Mode rules, and the check
// states behind the Live Quality Preview Strip (2026-10-12). Pure: no model
// call, no I/O. generation-floor.ts remains the structure/claims floor; this
// module adds the two remaining quality dimensions (visual consistency and
// strict wording/link rules) and the shared vocabulary the strip renders.

type SectionLike = { type: string; variant?: string; content?: Record<string, unknown> | null };
type PageLike = { slug: string; title?: string; sections: SectionLike[] };
type ThemeLike = {
  palette?: Record<string, string | undefined>;
  font?: Record<string, string | undefined>;
  layout?: string;
  motion?: string;
  [k: string]: unknown;
};
export type VisualManifestLike = { name?: string; theme?: ThemeLike; pages: PageLike[] };

// ---- Check vocabulary (Live Quality Preview Strip) -----------------------------

export type CheckId = "structure" | "visual" | "images" | "claims";
export type CheckStatus = "pending" | "checking" | "passed" | "fixed" | "flagged";
export type QualityCheck = { id: CheckId; label: string; status: CheckStatus; detail?: string };

export const CHECK_LABELS: Record<CheckId, string> = {
  structure: "Structure",
  visual: "Visual consistency",
  images: "Image relevance",
  claims: "No hallucinations",
};
const CHECK_ORDER: CheckId[] = ["structure", "visual", "images", "claims"];

export function initialChecks(): QualityCheck[] {
  return CHECK_ORDER.map((id) => ({ id, label: CHECK_LABELS[id], status: "pending" as CheckStatus }));
}

export function setCheck(checks: QualityCheck[], id: CheckId, status: CheckStatus, detail?: string): QualityCheck[] {
  return checks.map((c) => (c.id === id ? { ...c, status, detail } : c));
}

/** passed = nothing found; fixed = issues found and none remain; flagged = issues remain. */
export function statusFromCounts(before: number, after: number): "passed" | "fixed" | "flagged" {
  if (after > 0) return "flagged";
  return before > 0 ? "fixed" : "passed";
}

// ---- Colour maths ------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return 0;
  const la = luminance(pa), lb = luminance(pb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const toHex = ([r, g, b]: [number, number, number]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

/** Moves a colour's lightness away from `against` until the contrast reaches `target` (keeps hue and saturation). */
function adjustForContrast(color: string, against: string, target: number): string {
  const rgb = parseHex(color), bg = parseHex(against);
  if (!rgb || !bg) return color;
  const [h, s, l] = rgbToHsl(rgb);
  const goLighter = luminance(bg) < 0.5;
  for (let i = 1; i <= 40; i++) {
    const nl = Math.max(0, Math.min(1, l + (goLighter ? 1 : -1) * i * 0.025));
    const next = toHex(hslToRgb([h, s, nl]));
    if (contrastRatio(next, against) >= target) return next;
  }
  return goLighter ? "#ffffff" : "#000000";
}

// ---- Visual consistency ------------------------------------------------------

export const ALLOWED_LAYOUTS = ["centered", "asymmetric", "editorial", "split", "grid-heavy", "magazine", "minimal-luxury", "brutalist", "playful"];
export const ALLOWED_MOTIONS = ["subtle", "expressive", "kinetic", "none"];
export const ALLOWED_HERO_VARIANTS = ["centered", "split-image", "full-bleed", "editorial-lede", "asymmetric-mark", "minimal-luxury"];
const HEADED_TYPES = new Set(["about", "services", "gallery", "faq", "process", "pricing", "feature-split"]);

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_ACCENT_CONTRAST = 3;

export function findVisualIssues(manifest: VisualManifestLike): string[] {
  const issues: string[] = [];
  const pal = manifest.theme?.palette ?? {};
  for (const key of ["bg", "surface", "text", "accent"] as const) {
    if (!pal[key] || !HEX_RE.test(pal[key]!)) issues.push(`Theme palette "${key}" is not a valid hex colour (${pal[key] ?? "missing"}).`);
  }
  if (pal.bg && pal.text && HEX_RE.test(pal.bg) && HEX_RE.test(pal.text) && contrastRatio(pal.text, pal.bg) < MIN_TEXT_CONTRAST) {
    issues.push(`Body text on the background has a contrast of ${contrastRatio(pal.text, pal.bg).toFixed(1)}:1; it must be at least ${MIN_TEXT_CONTRAST}:1.`);
  }
  if (pal.bg && pal.accent && HEX_RE.test(pal.bg) && HEX_RE.test(pal.accent) && contrastRatio(pal.accent, pal.bg) < MIN_ACCENT_CONTRAST) {
    issues.push(`The accent colour on the background has a contrast of ${contrastRatio(pal.accent, pal.bg).toFixed(1)}:1; buttons and highlights need at least ${MIN_ACCENT_CONTRAST}:1.`);
  }
  if (pal.accent && pal.accentSecondary && pal.accent.toLowerCase() === pal.accentSecondary.toLowerCase()) {
    issues.push(`accentSecondary is identical to accent, so gradients cannot read; pick a distinct secondary colour.`);
  }
  if (manifest.theme?.layout && !ALLOWED_LAYOUTS.includes(manifest.theme.layout)) issues.push(`Theme layout "${manifest.theme.layout}" is not a supported layout.`);
  if (manifest.theme?.motion && !ALLOWED_MOTIONS.includes(manifest.theme.motion)) issues.push(`Theme motion "${manifest.theme.motion}" is not a supported motion level.`);
  if (!manifest.theme?.font?.heading || !manifest.theme?.font?.body) issues.push(`Theme must name both a heading font and a body font.`);

  manifest.pages.forEach((page) => {
    page.sections.forEach((s, i) => {
      if (s.type === "hero" && s.variant && !ALLOWED_HERO_VARIANTS.includes(s.variant)) issues.push(`The hero on "${page.slug}" uses unsupported variant "${s.variant}".`);
      const c = (s.content ?? {}) as Record<string, unknown>;
      if (HEADED_TYPES.has(s.type) && !(typeof c.heading === "string" && c.heading.trim())) issues.push(`The ${s.type} section #${i + 1} on "${page.slug}" has no heading.`);
      if (i >= 2 && s.type === page.sections[i - 1].type && s.type === page.sections[i - 2].type) {
        issues.push(`The "${page.slug}" page stacks three "${s.type}" sections in a row; break the rhythm with a different section type.`);
      }
    });
  });
  return issues;
}

/**
 * Deterministic repair of the visual issues that have a safe mechanical fix:
 * invalid colours, low contrast, identical secondary accent, unsupported
 * layout/motion/hero variant. Returns notes for what changed. Issues that
 * need new content (missing headings, repeated section types) are left for
 * the revision call.
 */
export function repairVisual<M extends VisualManifestLike>(manifest: M): { manifest: M; notes: string[] } {
  const notes: string[] = [];
  const theme: ThemeLike = JSON.parse(JSON.stringify(manifest.theme ?? {}));
  const pal = { ...(theme.palette ?? {}) } as Record<string, string | undefined>;
  const defaults: Record<string, string> = { bg: "#0B0B0F", surface: "#151520", text: "#F4F4F5", accent: "#E8834A" };
  for (const key of Object.keys(defaults)) {
    if (!pal[key] || !HEX_RE.test(pal[key]!)) { pal[key] = defaults[key]; notes.push(`Replaced an invalid ${key} colour with a safe default.`); }
  }
  if (contrastRatio(pal.text!, pal.bg!) < MIN_TEXT_CONTRAST) {
    pal.text = adjustForContrast(pal.text!, pal.bg!, MIN_TEXT_CONTRAST);
    notes.push(`Adjusted the text colour so body copy is readable on the background (contrast ${contrastRatio(pal.text, pal.bg!).toFixed(1)}:1).`);
  }
  if (contrastRatio(pal.accent!, pal.bg!) < MIN_ACCENT_CONTRAST) {
    pal.accent = adjustForContrast(pal.accent!, pal.bg!, MIN_ACCENT_CONTRAST);
    notes.push(`Adjusted the accent colour so buttons and highlights stand out from the background.`);
  }
  if (pal.accentSecondary && pal.accentSecondary.toLowerCase() === pal.accent!.toLowerCase()) {
    const rgb = parseHex(pal.accent!);
    if (rgb) {
      const [h, s, l] = rgbToHsl(rgb);
      pal.accentSecondary = toHex(hslToRgb([h + 40, s, l]));
      notes.push(`Made the secondary accent distinct from the primary so gradients read.`);
    }
  }
  theme.palette = pal;
  if (theme.layout && !ALLOWED_LAYOUTS.includes(theme.layout)) { theme.layout = "asymmetric"; notes.push(`Replaced an unsupported layout with "asymmetric".`); }
  if (theme.motion && !ALLOWED_MOTIONS.includes(theme.motion)) { theme.motion = "subtle"; notes.push(`Replaced an unsupported motion level with "subtle".`); }
  const pages = manifest.pages.map((page) => ({
    ...page,
    sections: page.sections.map((s) => {
      if (s.type === "hero" && s.variant && !ALLOWED_HERO_VARIANTS.includes(s.variant)) {
        notes.push(`Replaced an unsupported hero variant on "${page.slug}" with "split-image".`);
        return { ...s, variant: "split-image" };
      }
      return s;
    }),
  }));
  return { manifest: { ...manifest, theme, pages }, notes };
}

// ---- Strict Mode -------------------------------------------------------------

const HYPE_RE = /\b(world[- ]class|best[- ]in[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|revolutionary|unparalleled|unmatched|unrivall?ed|game[- ]chang(?:er|ing)|next[- ]level|groundbreaking|second to none|number one|leading provider|premier)\b/i;
const EXTERNAL_HREF_RE = /^(https?:\/\/|mailto:|tel:)/i;

const strOf = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * The hardest wording and wiring rules. Applied only when the user switches
 * Strict Mode on, and always by the "Make it more professional" pass. Each
 * message is a concrete instruction for the revision call.
 */
export function findStrictIssues(manifest: VisualManifestLike, brief: string): string[] {
  const issues: string[] = [];
  const slugs = new Set(manifest.pages.map((p) => p.slug.toLowerCase()));
  const briefLower = brief.toLowerCase();
  const headingsSeen = new Map<string, string>();

  if (manifest.theme?.motion === "kinetic" && !/playful|game|gaming|hype|kinetic/.test(briefLower)) {
    issues.push(`Motion is "kinetic" but the brief does not ask for a playful or gaming feel; use "subtle" or "expressive".`);
  }
  if (manifest.pages.length > 6) issues.push(`The site has ${manifest.pages.length} pages; strict mode allows at most 6.`);

  manifest.pages.forEach((page) => {
    if (page.sections.length > 10) issues.push(`The "${page.slug}" page has ${page.sections.length} sections; strict mode allows at most 10.`);
    page.sections.forEach((s, i) => {
      const c = (s.content ?? {}) as Record<string, unknown>;
      const where = `${page.slug}.sections[${i}] (${s.type})`;
      for (const key of ["headline", "heading", "subheadline", "body", "eyebrow", "pull_quote"]) {
        const v = strOf(c[key]);
        const m = v.match(HYPE_RE);
        if (m) issues.push(`${where}.${key} uses the hype phrase "${m[0]}"; replace it with a concrete, checkable statement.`);
      }
      for (const key of ["headline", "heading", "cta_primary", "cta_secondary"]) {
        if (strOf(c[key]).includes("!")) issues.push(`${where}.${key} contains an exclamation mark; strict mode uses a calm tone.`);
      }
      if (s.type === "hero" && strOf(c.headline).replace(/~/g, "").length > 80) issues.push(`${where}.headline is longer than 80 characters; shorten it.`);
      if (strOf(c.body).length > 520) issues.push(`${where}.body is longer than 520 characters; split or shorten it.`);
      for (const key of ["cta_primary_href", "cta_secondary_href"]) {
        const label = key.replace("_href", "");
        if (strOf(c[label]) && !strOf(c[key])) issues.push(`${where} has a "${label}" button with no ${key}.`);
        const href = strOf(c[key]);
        if (href && !EXTERNAL_HREF_RE.test(href) && !href.startsWith("#") && !slugs.has(href.replace(/^\//, "").toLowerCase())) {
          issues.push(`${where}.${key} points to "${href}", which is not a page in this site.`);
        }
      }
      if (s.type === "pricing" && Array.isArray(c.tiers)) {
        (c.tiers as Record<string, unknown>[]).forEach((t, ti) => {
          const href = strOf(t?.cta_href);
          if (!href) issues.push(`${where}.tiers[${ti}] has no cta_href.`);
          else if (!EXTERNAL_HREF_RE.test(href) && !href.startsWith("#") && !slugs.has(href.replace(/^\//, "").toLowerCase())) issues.push(`${where}.tiers[${ti}].cta_href points to "${href}", which is not a page in this site.`);
        });
      }
      if ((s.type === "hero" || s.type === "feature-split") && !strOf(c.image_prompt) && !strOf(c.asset_url)) {
        issues.push(`${where} has no image_prompt, so no matching image can be produced for it.`);
      }
      if (s.type === "gallery" && Array.isArray(c.items)) {
        (c.items as Record<string, unknown>[]).forEach((it, ii) => {
          if (!strOf(it?.image_prompt) && !strOf(it?.asset_url)) issues.push(`${where}.items[${ii}] has no image_prompt.`);
        });
      }
      if (s.type === "custom" && strOf(c.kind) === "embed") {
        const url = strOf(c.embed_url);
        if (!url || !brief.includes(url)) issues.push(`${where} embeds "${url || "nothing"}", which the brief never supplied; remove the embed section.`);
      }
      const h = strOf(c.heading).replace(/~/g, "").trim().toLowerCase();
      if (h && HEADED_TYPES.has(s.type)) {
        const prev = headingsSeen.get(h);
        if (prev && prev !== page.slug) issues.push(`The heading "${strOf(c.heading).replace(/~/g, "")}" is used on both "${prev}" and "${page.slug}"; give each page its own wording.`);
        else headingsSeen.set(h, page.slug);
      }
    });
  });
  return issues;
}

/** Temperature and wording constraints injected into the generation prompt when Strict Mode is on. */
export const STRICT_PROMPT_BLOCK = `STRICT MODE (chosen by the user; it overrides any creative guidance above):
- No creative risks: use a conventional, highly legible layout ("split", "editorial", "centered" or "minimal-luxury"), "subtle" motion, and a safe, widely available font pairing.
- Stay strictly inside the brief. Do not add claims, specifics, features, or offers the brief did not state. Where the brief is silent, write plain descriptive copy.
- Tone: calm and factual. No superlatives or hype ("world-class", "best-in-class", "cutting-edge", "revolutionary", "ultimate", "number one"), no exclamation marks, no rhetorical flourishes.
- Hero headlines at most 80 characters; paragraphs at most 3 short sentences.
- Every call to action has a resolvable href; every hero, feature-split and gallery item has a specific image_prompt that names the real subject of this business.
- Never use an "embed" custom section unless the brief supplied the exact URL.`;

// ---- Visible auto-fix notes -----------------------------------------------------
// generation_notes entries that start with one of these describe something
// the Generator fixed by itself (as opposed to something that needs the
// owner's attention). The dashboard lists them under "Fixed automatically",
// and GeneratorHome only raises its "needs attention" toast for the rest.
export const GUARD_PREFIX = "Relevance Guard: ";
export const VISUAL_FIX_PREFIX = "Visual fix: ";

export function isAutoFixNote(note: unknown): boolean {
  return typeof note === "string" && (note.startsWith(GUARD_PREFIX) || note.startsWith(VISUAL_FIX_PREFIX));
}
