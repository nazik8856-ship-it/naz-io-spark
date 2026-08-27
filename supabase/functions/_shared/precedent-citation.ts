// "Real precedent memory" plan, item 9: "the AI decided this partly
// because of precedent" isn't good enough for a company that needs to
// explain its own automated decisions to ITS customers or auditors. When
// precedent materially changed a verdict -- item 3/5's own
// shouldRejectOnPrecedent override, never just "precedent was looked
// at" -- record exactly which past decisions were cited and why. Same
// "never a black box" idea gate-trace.ts already established for the
// deterministic gate layers, applied here to a precedent-informed
// override specifically.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PrecedentAdvice } from "./precedent-advice.ts";
import type { PrecedentMatch } from "./precedent-search.ts";

export type PrecedentCitation = { decisionId: string; similarity: number; nonAllow: boolean };

export type PrecedentCitationRecord = {
  reason: "non_allow_majority" | "contradictory";
  sampleSize: number;
  nonAllowShare: number;
  citedDecisions: PrecedentCitation[];
};

/**
 * Pure -- only ever meaningful to call once shouldRejectOnPrecedent has
 * already returned true for the same advice. `matches` and
 * `nonAllowFlags` must be the exact same arrays (same order) the caller
 * built `advice` from -- this doesn't recompute anything, just packages
 * what already happened into a real, storable record.
 */
export function buildPrecedentCitationRecord(
  advice: Extract<PrecedentAdvice, { available: true }>,
  matches: PrecedentMatch[],
  nonAllowFlags: boolean[],
): PrecedentCitationRecord {
  return {
    reason: advice.contradictory ? "contradictory" : "non_allow_majority",
    sampleSize: advice.sampleSize,
    nonAllowShare: advice.nonAllowShare,
    citedDecisions: matches.map((m, i) => ({ decisionId: m.decisionId, similarity: m.similarity, nonAllow: nonAllowFlags[i] ?? false })),
  };
}

/**
 * Persists the citation trail onto the decision it explains. Best-effort
 * -- a write failure here must never surface to the caller or unwind the
 * real override it's merely documenting, the same posture every other
 * enrichment write in this feature already has.
 */
export async function recordPrecedentCitation(
  admin: SupabaseClient,
  decisionId: string,
  record: PrecedentCitationRecord,
): Promise<void> {
  try {
    await admin.from("agent_decisions").update({ precedent_citations: record }).eq("id", decisionId);
  } catch { /* citation trail is enrichment -- must never break the real decision it's describing */ }
}
