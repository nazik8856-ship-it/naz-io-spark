// Content-gap backlog health check -- the same "notice quietly-stopped-
// working, alert once, clear on recovery" shape already proven by
// precedent-pipeline-health-sweep and auto-resolution-share-sweep,
// applied here to items 179-180's content-gap-cluster pipeline. Today an
// account owner only learns about a growing backlog of unanswered
// questions by polling GET /content-gaps or /content-gap-clusters
// themselves -- there's a per-occurrence escalation webhook (item 170),
// but nothing notices when the SAME question keeps recurring, unresolved,
// well past the point a reasonable person would have already added a
// rule or context entry for it.
//
// Deliberately keyed on the single LARGEST unresolved cluster's
// occurrence_count, not a total unresolved-gap count across all
// clusters -- a dozen different one-off questions that never repeat is
// normal, healthy variety in what end users ask, not a backlog problem.
// One question asked 20+ times with nothing ever added to answer it is
// the actual signal worth an account owner's attention.
export type GapClusterForBacklogHealth = { occurrenceCount: number };

// A cluster this large means the same unanswered question has come up
// often enough that it's clearly not a one-off -- worth flagging well
// before it reaches the volume a human would call unmissable.
export const CONTENT_GAP_BACKLOG_THRESHOLD = 20;

/** Pure -- true when this key's single largest unresolved content-gap cluster has grown past the threshold. */
export function isContentGapBacklogStale(topCluster: GapClusterForBacklogHealth | null): boolean {
  if (!topCluster) return false;
  return topCluster.occurrenceCount >= CONTENT_GAP_BACKLOG_THRESHOLD;
}

export function summarizeStaleContentGapBacklog(representativeMessage: string, occurrenceCount: number): string {
  const excerpt = representativeMessage.length > 200 ? `${representativeMessage.slice(0, 200)}…` : representativeMessage;
  return (
    `One of your API keys has an unanswered question that keeps recurring: "${excerpt}" has come up ` +
    `${occurrenceCount} times with no rule or context entry ever added to cover it. Add one via ` +
    `POST /api-keys/:id/context or POST /api-keys/:id/response-rules to stop end users hitting the ` +
    `honest "I don't have enough information" fallback for it.`
  );
}
