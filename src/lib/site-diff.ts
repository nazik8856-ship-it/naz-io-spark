// Instant before/after comparison: a plain-language list of what differs
// between two states of a generated site (a saved version vs the current
// pages). Deterministic and side-effect free so it can be unit tested; the
// side-by-side / toggle views render the real previews, this lists the why.

export type DiffSection = { type: string; variant?: string; content?: Record<string, unknown> | null };
export type DiffPage = { slug: string; title?: string; sections: DiffSection[] };
export type DiffSite = { theme?: Record<string, any> | null; pages: DiffPage[] };

export type SiteDiff = {
  lines: string[];
  changed: boolean;
  imagesAdded: number;
  pagesAdded: string[];
  pagesRemoved: string[];
};

const TEXT_KEYS = ["headline", "heading", "subheadline", "body", "eyebrow", "cta_primary", "cta_secondary", "caption", "quote", "pull_quote"];
const IGNORED_FOR_TEXT = new Set(["asset_url", "image_prompt", "media_style"]);

const MAX_LINES = 12;
const pageName = (p: DiffPage) => (p.title && p.title.trim()) || p.slug;

function countAssetUrls(sections: DiffSection[]): number {
  let n = 0;
  for (const s of sections) {
    const c = (s.content ?? {}) as Record<string, unknown>;
    if (typeof c.asset_url === "string" && c.asset_url) n++;
    if (Array.isArray(c.items)) for (const it of c.items as Record<string, unknown>[]) if (it && typeof it.asset_url === "string" && it.asset_url) n++;
  }
  return n;
}

function stripIgnored(content: Record<string, unknown>): string {
  const clone = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  for (const k of IGNORED_FOR_TEXT) delete clone[k];
  if (Array.isArray(clone.items)) clone.items = (clone.items as Record<string, unknown>[]).map((it) => {
    const c2 = { ...(it ?? {}) } as Record<string, unknown>;
    for (const k of IGNORED_FOR_TEXT) delete c2[k];
    return c2;
  });
  return JSON.stringify(clone);
}

function changedTextKey(a: Record<string, unknown>, b: Record<string, unknown>): string | null {
  for (const k of TEXT_KEYS) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return k;
  return null;
}

export function diffSites(before: DiffSite, after: DiffSite): SiteDiff {
  const lines: string[] = [];
  const bySlug = (pages: DiffPage[]) => new Map(pages.map((p) => [p.slug, p]));
  const b = bySlug(before.pages), a = bySlug(after.pages);

  const pagesAdded = after.pages.filter((p) => !b.has(p.slug)).map(pageName);
  const pagesRemoved = before.pages.filter((p) => !a.has(p.slug)).map(pageName);
  if (pagesAdded.length) lines.push(`Added page${pagesAdded.length > 1 ? "s" : ""}: ${pagesAdded.join(", ")}`);
  if (pagesRemoved.length) lines.push(`Removed page${pagesRemoved.length > 1 ? "s" : ""}: ${pagesRemoved.join(", ")}`);

  for (const page of after.pages) {
    const prev = b.get(page.slug);
    if (!prev) continue;
    const name = pageName(page);
    const prevTypes = prev.sections.map((s) => s.type), nextTypes = page.sections.map((s) => s.type);
    if (JSON.stringify(prevTypes) !== JSON.stringify(nextTypes)) {
      lines.push(`${name}: sections changed (${prevTypes.join(", ") || "none"} → ${nextTypes.join(", ") || "none"})`);
      continue;
    }
    page.sections.forEach((s, i) => {
      const p0 = prev.sections[i];
      const c1 = (p0.content ?? {}) as Record<string, unknown>, c2 = (s.content ?? {}) as Record<string, unknown>;
      if (stripIgnored(c1) === stripIgnored(c2) && (p0.variant ?? "") === (s.variant ?? "")) return;
      if ((p0.variant ?? "") !== (s.variant ?? "")) lines.push(`${name} › ${s.type}: layout variant changed (${p0.variant || "default"} → ${s.variant || "default"})`);
      const key = changedTextKey(c1, c2);
      if (key) lines.push(`${name} › ${s.type}: ${key.replace(/_/g, " ")} changed`);
      else if (stripIgnored(c1) !== stripIgnored(c2)) lines.push(`${name} › ${s.type}: content changed`);
    });
  }

  const imagesBefore = before.pages.reduce((n, p) => n + countAssetUrls(p.sections), 0);
  const imagesAfter = after.pages.reduce((n, p) => n + countAssetUrls(p.sections), 0);
  const imagesAdded = Math.max(0, imagesAfter - imagesBefore);
  if (imagesAfter !== imagesBefore) {
    lines.push(imagesAfter > imagesBefore ? `Images: ${imagesAfter - imagesBefore} added` : `Images: ${imagesBefore - imagesAfter} removed`);
  } else if (before.pages.some((p) => JSON.stringify(p.sections.map((s) => (s.content as any)?.asset_url ?? null)) !== JSON.stringify((a.get(p.slug)?.sections ?? []).map((s) => (s.content as any)?.asset_url ?? null)))) {
    lines.push("Images: some were replaced");
  }

  const t1 = (before.theme ?? {}) as Record<string, any>, t2 = (after.theme ?? {}) as Record<string, any>;
  const palette = new Set([...Object.keys(t1.palette ?? {}), ...Object.keys(t2.palette ?? {})]);
  const changedColours = [...palette].filter((k) => (t1.palette?.[k] ?? null) !== (t2.palette?.[k] ?? null));
  if (changedColours.length) lines.push(`Colours changed: ${changedColours.join(", ")}`);
  for (const k of ["layout", "motion", "spacing"] as const) {
    if ((t1[k] ?? null) !== (t2[k] ?? null)) lines.push(`Theme ${k}: ${t1[k] ?? "default"} → ${t2[k] ?? "default"}`);
  }
  if (JSON.stringify(t1.font ?? null) !== JSON.stringify(t2.font ?? null)) lines.push("Fonts changed");

  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`…and ${lines.length - MAX_LINES} more`);
  return { lines: shown, changed: lines.length > 0, imagesAdded, pagesAdded, pagesRemoved };
}
