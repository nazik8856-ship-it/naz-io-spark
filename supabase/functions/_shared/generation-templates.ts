// Smart Structure Selector (2026-10-12): the user picks one of four site
// structures before generation. Each template is a set of deterministic,
// checkable rules -- not only prompt text -- so "the Generator follows the
// template" is enforced the same way generation-floor.ts enforces the
// quality floor: violations are listed as concrete issues, fed to the
// bounded revision loop, and disclosed if they survive it.
//
// Everything here is pure (no I/O, no model call). The same four ids and
// labels are duplicated in src/lib/site-structures.ts for the picker UI
// (edge functions cannot import from src/, same reasoning as
// src/lib/agent-policy.ts documents).

type SectionLike = { type: string; variant?: string; content?: Record<string, unknown> | null };
type PageLike = { slug: string; title?: string; sections: SectionLike[] };
export type TemplateManifestLike = { pages: PageLike[] };

export const STRUCTURE_IDS = ["simple-landing", "full-business", "pricing-focused", "agency"] as const;
export type StructureId = typeof STRUCTURE_IDS[number];

export function isStructureId(v: unknown): v is StructureId {
  return typeof v === "string" && (STRUCTURE_IDS as readonly string[]).includes(v);
}

// Slugs that mean the same kind of page. Matching by alias keeps a perfectly
// good "our-story" page from being reported as a missing "about" page.
const ABOUT_SLUGS = ["about", "about-us", "our-story", "story", "team", "studio"];
const OFFERING_SLUGS = ["services", "what-we-do", "offerings", "solutions", "menu", "products", "treatments", "classes", "capabilities"];
const WORK_SLUGS = ["work", "portfolio", "projects", "case-studies", "cases", "gallery", "our-work"];
const PRICING_SLUGS = ["pricing", "plans", "packages", "rates"];

// Pages the renderer/normalizer add on their own; they never count as the
// user's content pages.
const AUTO_SLUGS = new Set([
  "contact", "privacy-policy", "privacy", "privacy-notice",
  "terms", "terms-of-service", "terms-conditions", "terms-and-conditions", "tos",
]);

type PageRequirement = {
  label: string;
  slugs: string[];
  minSections: number;
  /** Each inner array is an any-of group; every group must be satisfied. */
  sectionGroups?: string[][];
  /** Extra check that only runs on the matched page. */
  extra?: (page: PageLike) => string | null;
};

type TemplateRules = {
  /** Home needs one section from each group (any-of). */
  homeGroups: string[][];
  homeServicesMin: number;
  homeHeroVariants?: string[];
  homeMinSections: number;
  homeMaxSections: number;
  /** The last section of home must be this type (a closing call to action). */
  homeLastType?: string;
  /** Content pages are everything except contact/legal, INCLUDING home. */
  contentPages: { min: number; max: number };
  requiredPages: PageRequirement[];
  /** Some site-wide section must exist (e.g. a process section for agencies). */
  siteWideGroups?: string[][];
  /** At least one home CTA must link to a page with one of these slugs. */
  homeLinksTo?: string[];
};

export type StructureTemplate = {
  id: StructureId;
  label: string;
  blurb: string;
  bestFor: string;
  /** Bullet list shown in the picker. */
  includes: string[];
  rules: TemplateRules;
};

const itemsOf = (s: SectionLike | undefined, key = "items"): unknown[] => {
  const v = (s?.content as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(v) ? v : [];
};

export const STRUCTURE_TEMPLATES: Record<StructureId, StructureTemplate> = {
  "simple-landing": {
    id: "simple-landing",
    label: "Simple Landing",
    blurb: "One focused page that explains the offer and ends in a single call to action.",
    bestFor: "A single offer, an event, a freelancer, a quick launch",
    includes: ["Home (hero, about, services, one proof/FAQ block, closing CTA)", "Contact form page"],
    rules: {
      homeGroups: [["about", "feature-split"], ["gallery", "faq", "process"]],
      homeServicesMin: 3,
      homeMinSections: 6,
      homeMaxSections: 9,
      homeLastType: "cta",
      contentPages: { min: 1, max: 1 },
      requiredPages: [],
    },
  },
  "full-business": {
    id: "full-business",
    label: "Full Business Site",
    blurb: "A complete multi-page site: home, about, what you offer, and contact.",
    bestFor: "Restaurants, clinics, local services, shops, studios",
    includes: ["Home", "About page", "Services / menu / offering page", "Contact form page"],
    rules: {
      homeGroups: [["about", "feature-split"], ["gallery", "faq", "process"]],
      homeServicesMin: 3,
      homeMinSections: 5,
      homeMaxSections: 10,
      contentPages: { min: 3, max: 5 },
      requiredPages: [
        { label: "about", slugs: ABOUT_SLUGS, minSections: 2 },
        { label: "services / menu / offering", slugs: OFFERING_SLUGS, minSections: 2 },
      ],
    },
  },
  "pricing-focused": {
    id: "pricing-focused",
    label: "Pricing-focused",
    blurb: "Built around a clear plans page so visitors can compare and choose.",
    bestFor: "Subscriptions, packages, SaaS-style offers, classes, memberships",
    includes: ["Home that points to pricing", "Pricing page (3+ plans) with FAQ", "Contact form page"],
    rules: {
      homeGroups: [["about", "feature-split", "services"], ["gallery", "faq", "process"]],
      homeServicesMin: 0,
      homeMinSections: 5,
      homeMaxSections: 9,
      homeLastType: "cta",
      contentPages: { min: 2, max: 4 },
      homeLinksTo: PRICING_SLUGS,
      requiredPages: [
        {
          label: "pricing",
          slugs: PRICING_SLUGS,
          minSections: 3,
          sectionGroups: [["pricing"], ["faq"]],
          extra: (page) => {
            const tiers = page.sections.filter((s) => s.type === "pricing").flatMap((s) => itemsOf(s, "tiers"));
            return tiers.length < 3 ? `The "${page.slug}" page's pricing section has ${tiers.length} plan(s); a pricing-focused site needs at least 3 so visitors can compare.` : null;
          },
        },
      ],
    },
  },
  agency: {
    id: "agency",
    label: "Agency-style",
    blurb: "Bold, work-led layout: services, a portfolio page, and a visible process.",
    bestFor: "Agencies, studios, consultancies, photographers, creatives",
    includes: ["Bold home (full-bleed / editorial hero)", "Work / portfolio page", "Services page with process", "Contact form page"],
    rules: {
      homeGroups: [["about", "feature-split"], ["gallery"]],
      homeServicesMin: 3,
      homeHeroVariants: ["full-bleed", "editorial-lede", "asymmetric-mark"],
      homeMinSections: 5,
      homeMaxSections: 9,
      homeLastType: "cta",
      contentPages: { min: 3, max: 5 },
      siteWideGroups: [["process"]],
      requiredPages: [
        {
          label: "work / portfolio",
          slugs: WORK_SLUGS,
          minSections: 2,
          sectionGroups: [["gallery"]],
          extra: (page) => {
            const items = page.sections.filter((s) => s.type === "gallery").flatMap((s) => itemsOf(s));
            return items.length < 3 ? `The "${page.slug}" page's gallery has ${items.length} item(s); an agency-style work page needs at least 3 projects.` : null;
          },
        },
        {
          label: "services",
          slugs: OFFERING_SLUGS,
          minSections: 2,
          sectionGroups: [["services"]],
          extra: (page) => {
            const svc = page.sections.find((s) => s.type === "services");
            return svc && !["zigzag", "numbered"].includes(svc.variant ?? "")
              ? `The "${page.slug}" page's services section should use the "zigzag" or "numbered" variant for an agency-style layout (it uses "${svc.variant ?? "default"}").`
              : null;
          },
        },
      ],
    },
  },
};

export function getTemplate(id: StructureId): StructureTemplate {
  return STRUCTURE_TEMPLATES[id];
}

function matchPage(pages: PageLike[], slugs: string[]): PageLike | undefined {
  return pages.slice(1).find((p) => slugs.includes(p.slug.toLowerCase()));
}

function hrefTargets(home: PageLike): string[] {
  const out: string[] = [];
  for (const s of home.sections) {
    const c = (s.content ?? {}) as Record<string, unknown>;
    for (const key of ["cta_primary_href", "cta_secondary_href"]) if (typeof c[key] === "string") out.push(c[key] as string);
    for (const tier of itemsOf(s, "tiers")) {
      const h = (tier as Record<string, unknown> | null)?.cta_href;
      if (typeof h === "string") out.push(h);
    }
  }
  return out.map((h) => h.replace(/^#/, "").replace(/^\//, "").toLowerCase());
}

/**
 * Concrete, checkable violations of the chosen structure -- written as
 * instructions so they can be passed straight to the revision call.
 */
export function findTemplateIssues(manifest: TemplateManifestLike, id: StructureId, opts: { outlineOnly?: boolean } = {}): string[] {
  const { rules, label } = STRUCTURE_TEMPLATES[id];
  const home = manifest.pages[0];
  if (!home) return [];
  const issues: string[] = [];
  const types = new Set(home.sections.map((s) => s.type));
  const prefix = `Structure "${label}":`;

  if (home.sections[0]?.type !== "hero") {
    issues.push(`${prefix} the "home" page must start with a "hero" section (it starts with "${home.sections[0]?.type ?? "nothing"}").`);
  }
  if (rules.homeHeroVariants && home.sections[0]?.type === "hero" && !rules.homeHeroVariants.includes(home.sections[0].variant ?? "")) {
    issues.push(`${prefix} the home hero must use one of ${rules.homeHeroVariants.map((v) => `"${v}"`).join(", ")} (it uses "${home.sections[0].variant ?? "default"}").`);
  }
  for (const group of rules.homeGroups) {
    if (!group.some((t) => types.has(t))) {
      issues.push(`${prefix} the "home" page needs a ${group.map((t) => `"${t}"`).join(" or ")} section.`);
    }
  }
  if (rules.homeServicesMin > 0) {
    const n = itemsOf(home.sections.find((s) => s.type === "services")).length;
    if (n < rules.homeServicesMin) issues.push(`${prefix} the "home" page needs a "services" section with at least ${rules.homeServicesMin} real items (it has ${n}).`);
  }
  if (home.sections.length < rules.homeMinSections) {
    issues.push(`${prefix} the "home" page has ${home.sections.length} section(s); it needs at least ${rules.homeMinSections}.`);
  }
  if (home.sections.length > rules.homeMaxSections) {
    issues.push(`${prefix} the "home" page has ${home.sections.length} sections; keep it to at most ${rules.homeMaxSections} so it stays focused.`);
  }
  if (rules.homeLastType && home.sections[home.sections.length - 1]?.type !== rules.homeLastType) {
    issues.push(`${prefix} the "home" page must end with a "${rules.homeLastType}" section (it ends with "${home.sections[home.sections.length - 1]?.type ?? "nothing"}").`);
  }

  const contentPages = manifest.pages.filter((p) => !AUTO_SLUGS.has(p.slug.toLowerCase()));
  if (contentPages.length < rules.contentPages.min) {
    issues.push(`${prefix} the site has ${contentPages.length} content page(s) (including home); it needs at least ${rules.contentPages.min}.`);
  }
  if (contentPages.length > rules.contentPages.max) {
    issues.push(`${prefix} the site has ${contentPages.length} content pages (including home); this structure allows at most ${rules.contentPages.max}. Merge or remove the extra pages: ${contentPages.slice(rules.contentPages.max).map((p) => `"${p.slug}"`).join(", ")}.`);
  }

  for (const req of rules.requiredPages) {
    const page = matchPage(manifest.pages, req.slugs);
    if (!page) {
      issues.push(`${prefix} a ${req.label} page is required (use one of the slugs ${req.slugs.slice(0, 3).map((s) => `"${s}"`).join(", ")}).`);
      continue;
    }
    if (page.sections.length < req.minSections) {
      issues.push(`${prefix} the "${page.slug}" page needs at least ${req.minSections} sections (it has ${page.sections.length}).`);
    }
    const pageTypes = new Set(page.sections.map((s) => s.type));
    for (const group of req.sectionGroups ?? []) {
      if (!group.some((t) => pageTypes.has(t))) issues.push(`${prefix} the "${page.slug}" page needs a ${group.map((t) => `"${t}"`).join(" or ")} section.`);
    }
    const extra = req.extra?.(page);
    if (extra) issues.push(`${prefix} ${extra}`);
  }

  for (const group of rules.siteWideGroups ?? []) {
    const has = manifest.pages.some((p) => p.sections.some((s) => group.includes(s.type)));
    if (!has) issues.push(`${prefix} the site needs a ${group.map((t) => `"${t}"`).join(" or ")} section somewhere (for example on the services page).`);
  }

  // An outline has no buttons yet, so link wiring can only be judged on real content.
  if (rules.homeLinksTo && !opts.outlineOnly) {
    const targets = hrefTargets(home);
    const pricingPage = matchPage(manifest.pages, rules.homeLinksTo);
    if (pricingPage && !targets.includes(pricingPage.slug.toLowerCase())) {
      issues.push(`${prefix} at least one call-to-action on the "home" page must link to the "${pricingPage.slug}" page (set its cta_primary_href to "${pricingPage.slug}").`);
    }
  }
  return issues;
}

/** The prompt block that makes the template part of the generation instructions. */
export function structurePromptBlock(id: StructureId): string {
  const t = STRUCTURE_TEMPLATES[id];
  const r = t.rules;
  const lines = [
    `MANDATORY SITE STRUCTURE — "${t.label}" (chosen by the user; it overrides the generic page-count guidance above):`,
    `- ${t.blurb}`,
    `- Content pages (everything except "contact" and legal pages, counting "home"): ${r.contentPages.min === r.contentPages.max ? `exactly ${r.contentPages.min}` : `${r.contentPages.min} to ${r.contentPages.max}`}.`,
    `- "home" has ${r.homeMinSections}-${r.homeMaxSections} sections, starts with a hero${r.homeHeroVariants ? ` (variant: ${r.homeHeroVariants.join(" | ")})` : ""}, and includes ${r.homeGroups.map((g) => g.join(" or ")).join("; plus ")}${r.homeServicesMin ? `; its services section has at least ${r.homeServicesMin} items` : ""}${r.homeLastType ? `; its last section is a "${r.homeLastType}"` : ""}.`,
  ];
  for (const req of r.requiredPages) {
    lines.push(`- Required page: ${req.label} (slug one of ${req.slugs.slice(0, 3).join(", ")}) with at least ${req.minSections} sections${req.sectionGroups ? `, containing ${req.sectionGroups.map((g) => g.join(" or ")).join(" and ")}` : ""}.`);
  }
  if (r.siteWideGroups) lines.push(`- Somewhere on the site include a ${r.siteWideGroups.map((g) => g.join(" or ")).join(" and ")} section.`);
  if (r.homeLinksTo) lines.push(`- At least one home call-to-action links to the ${r.homeLinksTo[0]} page.`);
  if (id === "pricing-focused") {
    lines.push(`- Plans: use the exact prices the brief states. If the brief gives none, write clearly illustrative plan prices (the owner will edit them); never present invented prices as a verified claim elsewhere in the copy.`);
  }
  if (id === "agency") {
    lines.push(`- Never invent client names, logos, or testimonials; show the work through the gallery and the process through the process section.`);
  }
  return lines.join("\n");
}

// ---- Outline (progressive refinement, stage 1) -------------------------------

export type OutlineSection = { type: string; variant?: string };
export type OutlinePage = { slug: string; title: string; sections: OutlineSection[] };
export type Outline = { pages: OutlinePage[] };

/** Section types a user may add in the outline editor. Testimonials/stats/logos are excluded: they are only valid when the brief supplies real ones. */
export const OUTLINE_ADDABLE_TYPES = ["about", "feature-split", "services", "gallery", "process", "faq", "pricing", "cta"] as const;
const OUTLINE_TYPES = new Set<string>([...OUTLINE_ADDABLE_TYPES, "hero", "contact", "testimonials", "stats", "logos", "custom"]);

/** A deterministic starting outline per template; the model may personalise page titles/slugs, never the rules. */
export function defaultOutline(id: StructureId): Outline {
  const home = (extra: OutlineSection[]): OutlinePage => ({ slug: "home", title: "Home", sections: [{ type: "hero", variant: id === "agency" ? "full-bleed" : "split-image" }, ...extra] });
  const contact: OutlinePage = { slug: "contact", title: "Contact", sections: [{ type: "contact" }] };
  switch (id) {
    case "simple-landing":
      return { pages: [home([{ type: "about" }, { type: "services", variant: "cards" }, { type: "process" }, { type: "faq" }, { type: "cta" }]), contact] };
    case "full-business":
      return { pages: [
        home([{ type: "about" }, { type: "services", variant: "cards" }, { type: "gallery", variant: "masonry" }, { type: "cta" }]),
        { slug: "about", title: "About", sections: [{ type: "about" }, { type: "process" }] },
        { slug: "services", title: "Services", sections: [{ type: "services", variant: "numbered" }, { type: "faq" }] },
        contact,
      ] };
    case "pricing-focused":
      return { pages: [
        home([{ type: "feature-split" }, { type: "services", variant: "cards" }, { type: "faq" }, { type: "cta" }]),
        { slug: "pricing", title: "Pricing", sections: [{ type: "pricing" }, { type: "faq" }, { type: "cta" }] },
        contact,
      ] };
    case "agency":
      return { pages: [
        home([{ type: "about" }, { type: "services", variant: "zigzag" }, { type: "gallery", variant: "showcase" }, { type: "cta" }]),
        { slug: "work", title: "Work", sections: [{ type: "gallery", variant: "showcase" }, { type: "feature-split" }] },
        { slug: "services", title: "Services", sections: [{ type: "services", variant: "zigzag" }, { type: "process" }] },
        contact,
      ] };
  }
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * Cleans an outline coming from the model or the client: known section types
 * only, unique slugs, home first and starting with a hero, contact present,
 * at most 6 pages and 10 sections per page. Never throws; returns null when
 * nothing usable remains (the caller then uses defaultOutline).
 */
export function sanitizeOutline(raw: unknown): Outline | null {
  const pagesIn = (raw as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pagesIn) || !pagesIn.length) return null;
  const used = new Set<string>(["home"]);
  const pages: OutlinePage[] = [];
  pagesIn.slice(0, 6).forEach((p, idx) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 60) : idx === 0 ? "Home" : `Page ${idx + 1}`;
    let slug = idx === 0 ? "home" : slugify(typeof o.slug === "string" && o.slug ? o.slug : title) || `page-${idx + 1}`;
    if (idx > 0) { let n = 2; const base = slug; while (used.has(slug)) slug = `${base}-${n++}`; used.add(slug); }
    const sections = (Array.isArray(o.sections) ? o.sections : [])
      .map((s) => {
        const so = (s ?? {}) as Record<string, unknown>;
        const type = typeof so.type === "string" ? so.type.toLowerCase() : "";
        return OUTLINE_TYPES.has(type) ? { type, ...(typeof so.variant === "string" && so.variant ? { variant: so.variant } : {}) } : null;
      })
      .filter((s): s is OutlineSection => !!s)
      .slice(0, 10);
    if (sections.length) pages.push({ slug, title, sections });
  });
  if (!pages.length) return null;
  if (pages[0].slug !== "home") pages[0] = { ...pages[0], slug: "home" };
  if (pages[0].sections[0].type !== "hero") pages[0].sections.unshift({ type: "hero" });
  if (!pages.some((p) => p.slug === "contact")) pages.push({ slug: "contact", title: "Contact", sections: [{ type: "contact" }] });
  return { pages };
}

/**
 * Template violations of an outline, judged with the same rules as a full
 * manifest (an outline is just pages with empty sections).
 */
export function findOutlineTemplateIssues(outline: Outline, id: StructureId): string[] {
  const asManifest: TemplateManifestLike = {
    pages: outline.pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      sections: p.sections.map((s) => ({
        type: s.type,
        variant: s.variant,
        // Item-count rules cannot be judged before content exists: give the
        // placeholder enough items so only the structural rules apply.
        content: { items: [1, 2, 3], tiers: [1, 2, 3] },
      })),
    })),
  };
  return findTemplateIssues(asManifest, id, { outlineOnly: true });
}

/**
 * Differences between an approved outline and a generated manifest: pages
 * (by slug, in order, ignoring auto-injected legal pages) and each page's
 * section types in order.
 */
export function findOutlineConformanceIssues(manifest: TemplateManifestLike, outline: Outline): string[] {
  const issues: string[] = [];
  const bySlug = new Map(manifest.pages.map((p) => [p.slug.toLowerCase(), p]));
  for (const want of outline.pages) {
    const got = bySlug.get(want.slug.toLowerCase());
    if (!got) { issues.push(`The approved outline has a "${want.slug}" page that is missing from the site.`); continue; }
    const wantTypes = want.sections.map((s) => s.type);
    const gotTypes = got.sections.map((s) => s.type);
    if (JSON.stringify(wantTypes) !== JSON.stringify(gotTypes)) {
      issues.push(`The "${want.slug}" page must have exactly these sections in this order: ${wantTypes.join(", ")} (it has: ${gotTypes.join(", ") || "none"}).`);
    }
  }
  const wanted = new Set(outline.pages.map((p) => p.slug.toLowerCase()));
  for (const p of manifest.pages) {
    if (!wanted.has(p.slug.toLowerCase()) && !AUTO_SLUGS.has(p.slug.toLowerCase())) {
      issues.push(`The site has a "${p.slug}" page that is not in the approved outline; remove it.`);
    }
  }
  return issues;
}

export function outlinePromptBlock(outline: Outline): string {
  return `APPROVED OUTLINE — the user reviewed and approved this structure. Build exactly these pages (slug, title) with exactly these section types in exactly this order; do not add, remove, rename, or reorder pages or sections:\n${outline.pages
    .map((p) => `- ${p.slug} ("${p.title}"): ${p.sections.map((s) => s.type + (s.variant ? `[${s.variant}]` : "")).join(" → ")}`)
    .join("\n")}`;
}
