// "Real precedent memory" plan, item 14: if the embedding pipeline
// silently stops working -- a bug, a provider change, the per-key spend
// cap (item 11) quietly eating every call -- an account's "memory" could
// stop growing and nobody would notice, since nothing about any single
// decision LOOKS wrong in the moment. Same "notice quietly-stopped-
// working" alerting shape already proven for integration-revocation-sweep
// and auto-resolution-share-sweep, applied here to the embedding pipeline.
//
// Coverage is measured against the DECISIONS that happened in the
// window, not against embeddings created in that same window -- a
// backfilled decision's embedding row is created long after the
// decision itself, so windowing both sides the same way would make a
// perfectly healthy backfill look like a stale live pipeline.
export type DecisionRow = { id: string; api_key_id: string };

export type ApiKeyEmbeddingCoverage = {
  apiKeyId: string;
  recentDecisions: number;
  recentEmbeddings: number;
};

// Don't judge a barely-active key -- one or two decisions with no
// embedding yet is normal noise (the live attempt can fail for benign,
// transient reasons), not evidence the pipeline is broken.
export const MIN_RECENT_DECISIONS_TO_JUDGE = 5;
// Real, working coverage should be close to 100% -- anything below this
// looks like the pipeline itself has stopped, not just an occasional miss.
export const STALE_COVERAGE_RATIO = 0.1;

/** Pure -- groups decisions by api key and counts how many of each key's recent decisions actually got embedded (regardless of when the embedding itself was created). */
export function summarizeEmbeddingCoverage(decisions: DecisionRow[], embeddedDecisionIds: Iterable<string>): ApiKeyEmbeddingCoverage[] {
  const embedded = new Set(embeddedDecisionIds);
  const byKey = new Map<string, { total: number; withEmbedding: number }>();
  for (const d of decisions) {
    const entry = byKey.get(d.api_key_id) ?? { total: 0, withEmbedding: 0 };
    entry.total++;
    if (embedded.has(d.id)) entry.withEmbedding++;
    byKey.set(d.api_key_id, entry);
  }
  return [...byKey.entries()].map(([apiKeyId, { total, withEmbedding }]) => ({
    apiKeyId, recentDecisions: total, recentEmbeddings: withEmbedding,
  }));
}

/** Pure -- true when this key has enough recent traffic to judge, and hardly any of it got embedded. */
export function isEmbeddingPipelineStale(row: ApiKeyEmbeddingCoverage): boolean {
  if (row.recentDecisions < MIN_RECENT_DECISIONS_TO_JUDGE) return false;
  return row.recentEmbeddings / row.recentDecisions < STALE_COVERAGE_RATIO;
}

export function summarizeStalePipeline(row: ApiKeyEmbeddingCoverage, windowDays: number): string {
  const pct = Math.round((row.recentEmbeddings / row.recentDecisions) * 100);
  return (
    `Real-precedent memory looks broken for one of your API keys: ${row.recentDecisions} decisions in the ` +
    `last ${windowDays} days, but only ${row.recentEmbeddings} (${pct}%) actually got embedded. Automatic ` +
    `decisions for this key are running blind on stale or empty memory until this is fixed.`
  );
}
