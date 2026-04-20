/**
 * NazAI Brand Engine
 * Centralized validation + intelligence layer for the Design Guardian system.
 * All validators are pure functions — UI is responsible for applying results.
 */

// ─── AURA PROFILE (NazAI brand palette) ──────────────────────────────────────
export const AURA_PROFILE = {
  obsidian: { r: 2, g: 6, b: 23 },        // #020617
  cyan: { r: 0, g: 163, b: 255 },         // #00A3FF
  emerald: { r: 34, g: 197, b: 94 },      // #22c55e
  white: { r: 255, g: 255, b: 255 },
} as const;

export type RGB = { r: number; g: number; b: number };
export type AestheticTag = "minimalist" | "neon" | "dark" | "industrial" | "warm" | "vibrant" | "muted";

export interface BrandAsset {
  id: string;
  url: string;
  tags: AestheticTag[];
  dominantColor: RGB;
  aspectRatio: number; // width / height
}

export interface PlacedAsset extends BrandAsset {
  x: number;          // 0-1 normalized
  y: number;          // px from top of canvas
  width: number;      // grid columns (1-12)
  height: number;     // px
  filter?: string;    // applied CSS filter from Guardian
  overlay?: number;   // 0-1 black overlay opacity
}

// ─── COLOR UTILS ─────────────────────────────────────────────────────────────
export function rgbDistance(a: RGB, b: RGB): number {
  // Normalized euclidean distance (0-1)
  const max = Math.sqrt(3 * 255 * 255);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / max;
}

export function relativeLuminance({ r, g, b }: RGB): number {
  const norm = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── 1. MAGIC WAND — vibe matching ───────────────────────────────────────────
export function findVibeMatches(active: BrandAsset, library: BrandAsset[]): BrandAsset[] {
  if (!active.tags.length) return library.filter((a) => a.id !== active.id);
  return library
    .filter((a) => a.id !== active.id)
    .map((a) => {
      const overlap = a.tags.filter((t) => active.tags.includes(t)).length;
      return { asset: a, score: overlap };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.asset);
}

// ─── 2. MAGNETIC GRID — 12-column snap ───────────────────────────────────────
export const GRID_COLUMNS = 12;
export const SNAP_THRESHOLD_PX = 24;

export function snapToGrid(
  rawX: number,
  rawY: number,
  containerWidth: number,
  rowHeight = 48
): { x: number; y: number; col: number; row: number } {
  const colWidth = containerWidth / GRID_COLUMNS;
  const col = Math.max(0, Math.min(GRID_COLUMNS - 1, Math.round(rawX / colWidth)));
  const row = Math.max(0, Math.round(rawY / rowHeight));
  return {
    x: col * colWidth,
    y: row * rowHeight,
    col,
    row,
  };
}

export interface DropTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "text" | "asset";
}

export function suggestAlignment(
  drop: { x: number; y: number; width: number; height: number },
  targets: DropTarget[]
): "wrap-left" | "wrap-right" | "above" | "below" | null {
  const textNear = targets.find(
    (t) => t.type === "text" && Math.abs(t.y - drop.y) < 120 && Math.abs(t.x - drop.x) < 240
  );
  if (!textNear) return null;
  const dropCenterX = drop.x + drop.width / 2;
  const textCenterX = textNear.x + textNear.width / 2;
  const dropCenterY = drop.y + drop.height / 2;
  const textCenterY = textNear.y + textNear.height / 2;
  if (Math.abs(dropCenterY - textCenterY) < Math.abs(dropCenterX - textCenterX)) {
    return dropCenterX < textCenterX ? "wrap-left" : "wrap-right";
  }
  return dropCenterY < textCenterY ? "above" : "below";
}

// ─── 3. BRAND-SNAP GUARDIAN ──────────────────────────────────────────────────
export type GuardianAction =
  | { type: "overlay"; opacity: number; reason: string }
  | { type: "blur"; px: number; reason: string }
  | { type: "filter"; css: string; reason: string }
  | { type: "fit-suggestion"; mode: "fit" | "fill"; reason: string }
  | { type: "alignment"; mode: "wrap-left" | "wrap-right" | "above" | "below"; reason: string };

export interface GuardianResult {
  actions: GuardianAction[];
  filterCss: string;
  overlay: number;
  fitSuggestion: "fit" | "fill" | null;
  alignment: GuardianAction["mode"] | null;
}

export interface GuardianContext {
  asset: BrandAsset;
  drop: { x: number; y: number; width: number; height: number };
  containerAspect: number;
  textBlocksUnder: { color: RGB }[];
  nearbyTargets: DropTarget[];
}

export function runGuardian(ctx: GuardianContext): GuardianResult {
  const actions: GuardianAction[] = [];
  let overlay = 0;
  const filters: string[] = [];
  let fitSuggestion: "fit" | "fill" | null = null;
  let alignment: GuardianResult["alignment"] = null;

  // ── Accessibility: contrast check vs text under image ─────────────────────
  for (const text of ctx.textBlocksUnder) {
    const ratio = contrastRatio(ctx.asset.dominantColor, text.color);
    if (ratio < 4.5) {
      overlay = Math.max(overlay, 0.4);
      actions.push({
        type: "overlay",
        opacity: 0.4,
        reason: `Contrast ${ratio.toFixed(2)} below WCAG AA — applied 40% black overlay.`,
      });
      if (ratio < 2.5) {
        filters.push("blur(0px)"); // marker; UI applies backdrop-blur on text
        actions.push({ type: "blur", px: 12, reason: "Severe contrast — backdrop blur recommended." });
      }
      break;
    }
  }

  // ── Brand Enforcement: deviation from Aura palette ────────────────────────
  const palette: RGB[] = [AURA_PROFILE.obsidian, AURA_PROFILE.cyan, AURA_PROFILE.emerald];
  const minDist = Math.min(...palette.map((p) => rgbDistance(ctx.asset.dominantColor, p)));
  if (minDist > 0.3) {
    const cssFilter = minDist > 0.55
      ? "grayscale(100%) contrast(1.1)"
      : "saturate(0.6) hue-rotate(-15deg)";
    filters.push(cssFilter);
    actions.push({
      type: "filter",
      css: cssFilter,
      reason: `Asset deviates ${(minDist * 100).toFixed(0)}% from Aura palette — forcing brand tone.`,
    });
  }

  // ── Ugly-drop prevention: aspect ratio mismatch ───────────────────────────
  const dropAspect = ctx.drop.width / Math.max(ctx.drop.height, 1);
  const ratioGap = Math.abs(ctx.asset.aspectRatio - dropAspect) / Math.max(ctx.asset.aspectRatio, dropAspect);
  if (ratioGap > 0.35) {
    fitSuggestion = ctx.asset.aspectRatio > dropAspect ? "fit" : "fill";
    actions.push({
      type: "fit-suggestion",
      mode: fitSuggestion,
      reason: `Aspect mismatch ${(ratioGap * 100).toFixed(0)}% — suggest ${fitSuggestion.toUpperCase()}.`,
    });
  }

  // ── Smart alignment near text blocks ──────────────────────────────────────
  const align = suggestAlignment(ctx.drop, ctx.nearbyTargets);
  if (align) {
    alignment = align;
    actions.push({ type: "alignment", mode: align, reason: `Detected text block — align ${align}.` });
  }

  return {
    actions,
    filterCss: filters.filter((f) => !f.startsWith("blur")).join(" "),
    overlay,
    fitSuggestion,
    alignment,
  };
}

// ─── DOMINANT COLOR EXTRACTION (client-side from <img>) ──────────────────────
export async function extractDominantColor(url: string): Promise<RGB> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 32;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(AURA_PROFILE.obsidian);
      try {
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        if (!count) return resolve(AURA_PROFILE.obsidian);
        resolve({ r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) });
      } catch {
        resolve(AURA_PROFILE.obsidian);
      }
    };
    img.onerror = () => resolve(AURA_PROFILE.obsidian);
    img.src = url;
  });
}

// ─── AESTHETIC INFERENCE FROM COLOR ──────────────────────────────────────────
export function inferTags(color: RGB, aspectRatio: number): AestheticTag[] {
  const tags: AestheticTag[] = [];
  const lum = relativeLuminance(color);
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  if (lum < 0.15) tags.push("dark");
  if (lum < 0.1 && saturation < 0.3) tags.push("industrial");
  if (saturation > 0.6 && lum > 0.4) tags.push("vibrant");
  if (saturation > 0.7 && (color.b > 180 || color.g > 180)) tags.push("neon");
  if (saturation < 0.25) tags.push("minimalist", "muted");
  if (color.r > color.b + 40) tags.push("warm");
  return tags.length ? tags : ["minimalist"];
}
