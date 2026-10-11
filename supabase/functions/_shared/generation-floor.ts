// Generator Quality (2026-10-11): deterministic quality floor for generated
// website manifests, independent of the LLM self-critique in
// generation-critique.ts. A live generation of "a bakery website" came back
// with trust_score 100 and empty generation_notes while containing (a)
// testimonials attributed to the invented people "Jane Doe" and "John Smith"
// and (b) a "menu" page that was one lone gallery section -- the soft
// critique passed both, and the old findStructuralIssues only ever looked at
// the home page. Everything here is pure (no model call, no I/O) so it is
// directly testable and can never be skipped the way a prompt instruction can.
//
// Structural types are deliberately minimal so compile-website-manifest's
// Manifest/Page/Section satisfy them without importing from the function's
// index.ts (importing an edge function's index.ts re-runs its top-level
// Deno.serve registration -- same hazard guardrail-reconciliation.ts documents).

type SectionLike = { type: string; content?: Record<string, unknown> | null };
type PageLike = { slug: string; sections: SectionLike[] };
export type ManifestLike = { name?: string; pages: PageLike[] };

// Pages that are legitimately a single section: the auto-injected legal pages
// and the dedicated contact form page (ensureContactPage).
const SINGLE_SECTION_OK_SLUGS = new Set([
  "contact", "privacy-policy", "privacy", "privacy-notice",
  "terms", "terms-of-service", "terms-conditions", "terms-and-conditions", "tos",
]);
export const MIN_SECTIONS_NON_HOME = 2;

export function findStructuralIssues(manifest: ManifestLike): string[] {
  const home = manifest.pages[0];
  if (!home) return [];
  const issues: string[] = [];
  if (home.sections[0]?.type !== "hero") {
    issues.push(`The "home" page must start with a "hero" section (it currently starts with "${home.sections[0]?.type ?? "nothing"}").`);
  }
  const types = new Set(home.sections.map((s) => s.type));
  if (!types.has("about") && !types.has("feature-split")) {
    issues.push(`The "home" page is missing an "about" or "feature-split" section describing what the business actually does.`);
  }
  const servicesSection = home.sections.find((s) => s.type === "services");
  const serviceItems = Array.isArray((servicesSection?.content as { items?: unknown[] } | undefined)?.items)
    ? ((servicesSection!.content as { items: unknown[] }).items)
    : [];
  if (serviceItems.length < 3) {
    issues.push(`The "home" page needs a "services" section with at least 3 real, specific items (currently has ${serviceItems.length}).`);
  }
  const hasExtra = (["testimonials", "gallery", "stats", "faq", "process"] as const).some((t) => types.has(t));
  if (!hasExtra) {
    issues.push(`The "home" page needs one more section (gallery, faq, or process -- testimonials or stats only if the brief supplied real ones) -- right now it reads as a thin landing page, not a complete site.`);
  }
  for (const page of manifest.pages.slice(1)) {
    if (SINGLE_SECTION_OK_SLUGS.has(page.slug.toLowerCase())) continue;
    if (page.sections.length < MIN_SECTIONS_NON_HOME) {
      issues.push(`The "${page.slug}" page has only ${page.sections.length} section(s) -- every page other than contact and legal pages needs at least ${MIN_SECTIONS_NON_HOME} (for example a heading section plus a supporting faq, process, or cta section).`);
    }
  }
  return issues;
}

// ---- Invented social proof -------------------------------------------------

export type UngroundedClaim = { kind: "testimonial" | "stat"; path: string; value: string };

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
function numberTokens(s: string): string[] {
  return Array.from(s.matchAll(NUMBER_RE), (m) => m[0].replace(/,/g, ""));
}
// Zero-padded ordinals ("01", "03") are decorative numbering, not a factual
// claim about the business.
const ORDINAL_RE = /^0\d$/;

function statGrounded(value: string, sourceNumbers: Set<string>): boolean {
  const v = value.trim();
  if (ORDINAL_RE.test(v)) return true;
  const tokens = numberTokens(v);
  if (!tokens.length) return true;
  return tokens.every((t) => sourceNumbers.has(t));
}

function testimonialGrounded(item: unknown, sourceLower: string): boolean {
  const author = typeof (item as { author?: unknown })?.author === "string" ? (item as { author: string }).author.trim() : "";
  return author.length > 0 && sourceLower.includes(author.toLowerCase());
}

type StatItem = { value?: unknown };

function walkStats(pages: PageLike[], visit: (loc: { page: number; section: number; where: "items" | "stats" }, items: StatItem[]) => void) {
  pages.forEach((page, pi) => page.sections.forEach((section, si) => {
    const content = (section.content ?? {}) as Record<string, unknown>;
    if (section.type === "stats" && Array.isArray(content.items)) visit({ page: pi, section: si, where: "items" }, content.items as StatItem[]);
    if (Array.isArray(content.stats)) visit({ page: pi, section: si, where: "stats" }, content.stats as StatItem[]);
  }));
}

/**
 * Finds customer testimonials and numeric stats that the brief never
 * supplied. A testimonial is grounded only if its author's name appears in
 * the source; a stat is grounded only if every number in its value appears
 * in the source (zero-padded ordinals are exempt). `sourceText` is the same
 * brief text findUngroundedFacts receives.
 */
export function findUngroundedClaims(pages: PageLike[], sourceText: string): UngroundedClaim[] {
  const claims: UngroundedClaim[] = [];
  const sourceLower = sourceText.toLowerCase();
  const sourceNumbers = new Set(numberTokens(sourceText));
  pages.forEach((page, pi) => page.sections.forEach((section, si) => {
    if (section.type !== "testimonials") return;
    const items = (section.content as { items?: unknown[] } | null | undefined)?.items;
    (Array.isArray(items) ? items : []).forEach((item, ii) => {
      if (!testimonialGrounded(item, sourceLower)) {
        const author = (item as { author?: unknown })?.author;
        claims.push({ kind: "testimonial", path: `${page.slug}.sections[${si}].items[${ii}]`, value: typeof author === "string" && author.trim() ? author.trim() : "(unattributed)" });
      }
    });
  }));
  walkStats(pages, (loc, items) => {
    items.forEach((item, ii) => {
      const value = typeof item?.value === "string" ? item.value : typeof item?.value === "number" ? String(item.value) : "";
      if (value && !statGrounded(value, sourceNumbers)) {
        claims.push({ kind: "stat", path: `${pages[loc.page].slug}.sections[${loc.section}].${loc.where}[${ii}]`, value });
      }
    });
  });
  return claims;
}

export function describeUngroundedClaims(claims: UngroundedClaim[]): string[] {
  const issues: string[] = [];
  const testimonials = claims.filter((c) => c.kind === "testimonial");
  const stats = claims.filter((c) => c.kind === "stat");
  if (testimonials.length) {
    issues.push(`The site contains ${testimonials.length} customer testimonial(s) from named people (${testimonials.map((c) => `"${c.value}"`).join(", ")}) who appear nowhere in the brief. Remove invented testimonials entirely and use a faq, process, or gallery section instead.`);
  }
  if (stats.length) {
    issues.push(`The site contains numeric figures (${stats.map((c) => `"${c.value}"`).join(", ")}) that the brief never states. Remove invented statistics; only use numbers the brief provides.`);
  }
  return issues;
}

/**
 * Deterministically removes every ungrounded testimonial item and stat item,
 * dropping a section that ends up empty, a hero's `stats` key that ends up
 * empty, and a non-home page that ends up with no sections. Never mutates
 * its input. Home is never dropped.
 */
export function repairUngroundedClaims<M extends ManifestLike>(
  manifest: M,
  sourceText: string,
): { manifest: M; notes: string[]; removed: UngroundedClaim[] } {
  const removed = findUngroundedClaims(manifest.pages, sourceText);
  if (!removed.length) return { manifest, notes: [], removed };

  const sourceLower = sourceText.toLowerCase();
  const sourceNumbers = new Set(numberTokens(sourceText));

  const pages = manifest.pages.map((page) => {
    const sections: SectionLike[] = [];
    for (const section of page.sections) {
      const content = { ...((section.content ?? {}) as Record<string, unknown>) };
      if (section.type === "testimonials" && Array.isArray(content.items)) {
        content.items = (content.items as unknown[]).filter((it) => testimonialGrounded(it, sourceLower));
        if (!(content.items as unknown[]).length) continue;
      }
      if (section.type === "stats" && Array.isArray(content.items)) {
        content.items = (content.items as StatItem[]).filter((it) => !itemValueUngrounded(it, sourceNumbers));
        if (!(content.items as unknown[]).length) continue;
      }
      if (Array.isArray(content.stats)) {
        const kept = (content.stats as StatItem[]).filter((it) => !itemValueUngrounded(it, sourceNumbers));
        if (kept.length) content.stats = kept; else delete content.stats;
      }
      sections.push({ ...section, content });
    }
    return { ...page, sections };
  }).filter((page, idx) => idx === 0 || page.sections.length > 0);

  const notes: string[] = [];
  const nT = removed.filter((c) => c.kind === "testimonial").length;
  const nS = removed.filter((c) => c.kind === "stat").length;
  if (nT) notes.push(`Removed ${nT} customer testimonial(s) that weren't in your brief -- invented endorsements are never published. Add real ones through chat when you have them.`);
  if (nS) notes.push(`Removed ${nS} statistic(s) that weren't in your brief -- invented figures are never published. Tell the chat your real numbers to add them.`);
  return { manifest: { ...manifest, pages }, notes, removed };
}

function itemValueUngrounded(item: StatItem, sourceNumbers: Set<string>): boolean {
  const value = typeof item?.value === "string" ? item.value : typeof item?.value === "number" ? String(item.value) : "";
  return !!value && !statGrounded(value, sourceNumbers);
}

// ---- Placeholder copy -------------------------------------------------------

const PLACEHOLDER_RE = /lorem ipsum|coming soon|\bplaceholder\b|\bTODO\b|\bTBD\b|\bFeature \d\b|insert [\w\s]{1,30} here|your (?:headline|text|content|name) here/i;

export function findPlaceholderCopy(manifest: ManifestLike): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      const m = value.match(PLACEHOLDER_RE);
      if (m) hits.push(`${path}: "${m[0]}"`);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, `${path}.${k}`);
    }
  };
  manifest.pages.forEach((page) => page.sections.forEach((section, si) => walk(section.content, `${page.slug}.sections[${si}]`)));
  return hits.length ? [`Placeholder copy found (${hits.slice(0, 4).join("; ")}) -- replace with specific copy for this business.`] : [];
}

// ---- The floor --------------------------------------------------------------

export function assessProfessionalFloor(manifest: ManifestLike, sourceText: string): { pass: boolean; issues: string[] } {
  const issues = [
    ...findStructuralIssues(manifest),
    ...describeUngroundedClaims(findUngroundedClaims(manifest.pages, sourceText)),
    ...findPlaceholderCopy(manifest),
  ];
  if (manifest.name !== undefined && (!manifest.name.trim() || manifest.name === "Untitled Site")) {
    issues.push(`The site has no real name -- derive a specific business name from the brief.`);
  }
  return { pass: issues.length === 0, issues };
}
