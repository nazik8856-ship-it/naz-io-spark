// Blueprint task #78: content_gap_clusters/api_response_generations were
// fully computed (content-gap-triage-sweep) and exposed via the public
// Control API (GET /control-api/v1/content-gap-clusters, backed by the
// service_role-only RPC list_gap_clusters_ranked), but nothing in the
// dashboard ever read them -- an account owner had no way to see what
// their own API key's /respond traffic keeps asking that nothing
// currently answers. Both backing tables are already RLS-readable
// directly by the owner/team members, so this mirrors
// list_gap_clusters_ranked's own grouping logic client-side instead of
// needing a new service_role-gated endpoint.
export type ContentGapClusterRow = { id: string; representative_message: string };
export type ContentGapGenerationRow = { content_gap_cluster_id: string | null; created_at: string; resolved_at: string | null };

export type RankedContentGap = {
  clusterId: string;
  representativeMessage: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

/**
 * Pure -- every cluster with at least one still-unresolved member,
 * ranked by how many times it's actually come up (ties broken by most
 * recent). Same shape as list_gap_clusters_ranked's SQL, so the
 * dashboard's ranking always matches the Control API's own.
 */
export function rankContentGapClusters(
  clusters: ContentGapClusterRow[],
  generations: ContentGapGenerationRow[],
): RankedContentGap[] {
  const stats = new Map<string, { count: number; first: string; last: string }>();
  for (const g of generations) {
    if (!g.content_gap_cluster_id || g.resolved_at) continue;
    const existing = stats.get(g.content_gap_cluster_id);
    if (existing) {
      existing.count += 1;
      if (g.created_at < existing.first) existing.first = g.created_at;
      if (g.created_at > existing.last) existing.last = g.created_at;
    } else {
      stats.set(g.content_gap_cluster_id, { count: 1, first: g.created_at, last: g.created_at });
    }
  }
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  return [...stats.entries()]
    .map(([clusterId, stat]) => {
      const cluster = clusterById.get(clusterId);
      if (!cluster) return null;
      return {
        clusterId,
        representativeMessage: cluster.representative_message,
        occurrenceCount: stat.count,
        firstSeenAt: stat.first,
        lastSeenAt: stat.last,
      };
    })
    .filter((g): g is RankedContentGap => g !== null)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}
