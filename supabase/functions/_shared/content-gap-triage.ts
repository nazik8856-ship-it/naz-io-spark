// "Own decision-making machine" plan, items 179-180 (Phase 3): pure
// decision logic for content-gap-triage-sweep. The actual similarity
// search runs in Postgres (search_gap_clusters); this just decides what
// to do with the rows it returns, in isolation from any DB dependency.
export type GapClusterCandidate = { id: string; representative_message: string; similarity: number };

// Reuses response-context.ts's own MIN_CONTEXT_SIMILARITY value
// deliberately, not a second independently-tuned number: both are the
// same underlying question ("is this genuinely the same thing, or just
// the closest of a bad lot") over the exact same gte-small embedding
// space, so there's no reason for the two thresholds to drift apart.
// See that constant's own comment for how 0.83 was derived empirically.
export const CLUSTER_SIMILARITY_THRESHOLD = 0.83;

/**
 * Pure -- `candidates` is expected already ranked nearest-first (see
 * search_gap_clusters's own ORDER BY). Returns the matching cluster's id
 * when the single nearest one clears the threshold, or null when this
 * gap should start a brand new cluster instead (no existing cluster is
 * close enough, or this key has none yet).
 */
export function pickMatchingCluster(candidates: GapClusterCandidate[]): { id: string } | null {
  const best = candidates[0];
  if (!best || best.similarity < CLUSTER_SIMILARITY_THRESHOLD) return null;
  return { id: best.id };
}

// Caps how many rows content-gap-triage-sweep processes per pass, for
// each of its two independent phases (resolution re-check, cluster
// assignment). Local embedding is free, but a single sweep invocation
// still shouldn't be allowed to run unbounded against a huge backlog --
// an account with more open gaps than this per phase just gets caught
// up over a few more 30-minute ticks instead of one very long request.
export const MAX_GAPS_PER_SWEEP_PHASE = 200;
