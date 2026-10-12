// Smart Structure Selector + progressive outline + live quality strip: the
// client-side vocabulary. The authoritative rules live in
// supabase/functions/_shared/generation-templates.ts and generation-quality.ts;
// edge functions cannot be imported from src/, so the ids/labels/check shapes
// are duplicated here (same approach as src/lib/agent-policy.ts).

export type StructureId = "simple-landing" | "full-business" | "pricing-focused" | "agency";

export type StructureOption = {
  id: StructureId;
  label: string;
  blurb: string;
  bestFor: string;
  includes: string[];
};

export const STRUCTURE_OPTIONS: StructureOption[] = [
  {
    id: "simple-landing",
    label: "Simple Landing",
    blurb: "One focused page that explains the offer and ends in a single call to action.",
    bestFor: "A single offer, an event, a freelancer, a quick launch",
    includes: ["Home (hero, about, services, one proof/FAQ block, closing CTA)", "Contact form page"],
  },
  {
    id: "full-business",
    label: "Full Business Site",
    blurb: "A complete multi-page site: home, about, what you offer, and contact.",
    bestFor: "Restaurants, clinics, local services, shops, studios",
    includes: ["Home", "About page", "Services / menu / offering page", "Contact form page"],
  },
  {
    id: "pricing-focused",
    label: "Pricing-focused",
    blurb: "Built around a clear plans page so visitors can compare and choose.",
    bestFor: "Subscriptions, packages, SaaS-style offers, classes, memberships",
    includes: ["Home that points to pricing", "Pricing page (3+ plans) with FAQ", "Contact form page"],
  },
  {
    id: "agency",
    label: "Agency-style",
    blurb: "Bold, work-led layout: services, a portfolio page, and a visible process.",
    bestFor: "Agencies, studios, consultancies, photographers, creatives",
    includes: ["Bold home (full-bleed / editorial hero)", "Work / portfolio page", "Services page with process", "Contact form page"],
  },
];

export const DEFAULT_STRUCTURE: StructureId = "full-business";

export function structureLabel(id: string | null | undefined): string | null {
  return STRUCTURE_OPTIONS.find((s) => s.id === id)?.label ?? null;
}

// ---- Outline (progressive refinement, stage 1) ---------------------------------

export type OutlineSection = { type: string; variant?: string };
export type OutlinePage = { slug: string; title: string; sections: OutlineSection[] };
export type Outline = { pages: OutlinePage[] };

export const SECTION_LABELS: Record<string, string> = {
  hero: "Hero",
  about: "About",
  "feature-split": "Feature split",
  services: "Services",
  gallery: "Gallery",
  process: "Process",
  faq: "FAQ",
  pricing: "Pricing",
  cta: "Call to action",
  contact: "Contact form",
  testimonials: "Testimonials",
  stats: "Stats",
  logos: "Logos",
  custom: "Custom",
};

/** Section types that may be added in the outline editor (mirrors OUTLINE_ADDABLE_TYPES server-side). */
export const OUTLINE_ADDABLE_TYPES = ["about", "feature-split", "services", "gallery", "process", "faq", "pricing", "cta"] as const;

/** Pages that must stay: home is the entry point, contact holds the working form. */
export const LOCKED_PAGE_SLUGS = new Set(["home", "contact"]);

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---- Live quality strip ---------------------------------------------------------

export type CheckId = "structure" | "visual" | "images" | "claims";
export type CheckStatus = "pending" | "checking" | "passed" | "fixed" | "flagged";
export type QualityCheck = { id: CheckId; label: string; status: CheckStatus; detail?: string };

export const INITIAL_CHECKS: QualityCheck[] = [
  { id: "structure", label: "Structure", status: "pending" },
  { id: "visual", label: "Visual consistency", status: "pending" },
  { id: "images", label: "Image relevance", status: "pending" },
  { id: "claims", label: "No hallucinations", status: "pending" },
];

/** Accepts whatever came back from the API/DB and returns four well-formed checks. */
export function normalizeChecks(raw: unknown): QualityCheck[] {
  const arr = Array.isArray(raw) ? (raw as Partial<QualityCheck>[]) : [];
  return INITIAL_CHECKS.map((base) => {
    const found = arr.find((c) => c?.id === base.id);
    const status = found?.status;
    const ok = status === "pending" || status === "checking" || status === "passed" || status === "fixed" || status === "flagged";
    return { ...base, status: ok ? (status as CheckStatus) : "pending", detail: typeof found?.detail === "string" ? found.detail : undefined };
  });
}

// ---- Auto-fix notes ----------------------------------------------------------------

export const GUARD_PREFIX = "Relevance Guard: ";
export const VISUAL_FIX_PREFIX = "Visual fix: ";

export function isAutoFixNote(note: unknown): note is string {
  return typeof note === "string" && (note.startsWith(GUARD_PREFIX) || note.startsWith(VISUAL_FIX_PREFIX));
}

export function stripNotePrefix(note: string): string {
  return note.startsWith(GUARD_PREFIX) ? note.slice(GUARD_PREFIX.length) : note.startsWith(VISUAL_FIX_PREFIX) ? note.slice(VISUAL_FIX_PREFIX.length) : note;
}
