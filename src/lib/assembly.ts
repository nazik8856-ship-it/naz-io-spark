// Phase model for the generation "assembly" visual (Intake → Calibration →
// Synthesis → Synchronization → Output).
//
// The visual is driven by the REAL generation progress, never by a timer:
// compile-website-manifest reports its stage to generation_progress
// ("understanding", "generating", "refining", "reviewing", "saving") and the
// caller maps that to a phase here. `done` is only set once the saved site
// exists, so a page can never be shown as merged before it was built.

export type AssemblyPhase = 0 | 1 | 2 | 3 | 4;

export const ASSEMBLY_STAGES = [
  { phase: 0, label: "Intake", caption: "Reading your prompt" },
  { phase: 1, label: "Calibration", caption: "Calibrating the structure" },
  { phase: 2, label: "Synthesis", caption: "Writing every page" },
  { phase: 3, label: "Synchronization", caption: "Checking and merging" },
  { phase: 4, label: "Vortex", caption: "Your site is assembled" },
] as const;

const STAGE_TO_PHASE: Record<string, AssemblyPhase> = {
  understanding: 0,
  generating: 1,
  refining: 2,
  reviewing: 3,
  saving: 3,
};

/** Maps a generation_progress stage to a phase. Unknown/missing stages stay at Intake. */
export function assemblyPhase(stage: string | null | undefined, done = false): AssemblyPhase {
  if (done) return 4;
  return (stage && STAGE_TO_PHASE[stage]) || 0;
}

/** Phases only ever move forward: a late or out-of-order poll must not rewind the animation. */
export function advancePhase(current: AssemblyPhase, next: AssemblyPhase): AssemblyPhase {
  return next > current ? next : current;
}

export type AssemblyPage = { slug: string; title: string; sections: string[] };

type PageLike = { slug?: unknown; title?: unknown; sections?: unknown };

/** Real pages (outline pages or saved website_pages rows) → the visual's page cards. */
export function toAssemblyPages(pages: PageLike[] | null | undefined, max = 6): AssemblyPage[] {
  if (!Array.isArray(pages)) return [];
  return pages.slice(0, max).map((p, i) => {
    const slug = typeof p?.slug === "string" && p.slug ? p.slug : `page-${i + 1}`;
    const title = typeof p?.title === "string" && p.title.trim() ? p.title.trim() : slug;
    const sections = (Array.isArray(p?.sections) ? p.sections : [])
      .map((s) => (typeof s === "string" ? s : typeof (s as { type?: unknown })?.type === "string" ? (s as { type: string }).type : ""))
      .filter(Boolean);
    return { slug, title, sections };
  });
}

export type CardState = "queued" | "building" | "merging" | "merged";

/** What a page card says about itself at a given phase. */
export function cardState(phase: AssemblyPhase): CardState {
  if (phase >= 4) return "merged";
  if (phase === 3) return "merging";
  if (phase === 2) return "building";
  return "queued";
}

export const CARD_STATE_LABEL: Record<CardState, string> = {
  queued: "Planned",
  building: "Building",
  merging: "Merging",
  merged: "Merged",
};

export function summarizeAssembly(pages: AssemblyPage[]): { pages: number; sections: number } {
  return { pages: pages.length, sections: pages.reduce((n, p) => n + p.sections.length, 0) };
}
