// "Real precedent memory" plan, item 3: real semantic precedent search
// over one api key's own embedded decisions (item 1). Every call is
// best-effort -- precedent is a helpful extra signal, never a required
// one (item 12's own discipline, needed from this very first caller
// onward, not deferred).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PrecedentMatch = {
  decisionId: string;
  actionType: string;
  provider: string;
  similarity: number;
  createdAt: string;
};

// A cosine similarity below this is "not actually similar" -- pgvector's
// nearest-neighbor search always returns something up to the limit, even
// when nothing in the account's history looks anything like this action.
export const MIN_SIMILARITY = 0.55;
const DEFAULT_LIMIT = 8;

/** Pure -- keeps only genuinely similar matches, dropping pgvector's "closest available, however far" results. */
export function filterPrecedentMatches(rows: PrecedentMatch[], minSimilarity: number = MIN_SIMILARITY): PrecedentMatch[] {
  return rows.filter((r) => r.similarity >= minSimilarity);
}

/**
 * Finds this api key's own most similar past decisions to the given
 * embedding. Never throws -- returns an empty array on any failure at
 * all (missing RPC, network error, malformed rows), so a caller can
 * always treat "no precedent" as a normal, expected outcome.
 */
export async function findPrecedent(
  admin: SupabaseClient,
  apiKeyId: string,
  embeddingLiteral: string,
  excludeDecisionId?: string | null,
  limit: number = DEFAULT_LIMIT,
): Promise<PrecedentMatch[]> {
  try {
    const { data, error } = await admin.rpc("search_decision_precedent", {
      _api_key_id: apiKeyId,
      _embedding: embeddingLiteral,
      _exclude_decision_id: excludeDecisionId ?? null,
      _limit: limit,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = (data as { decision_id: string; action_type: string; provider: string; similarity: number; created_at: string }[])
      .map((r) => ({
        decisionId: r.decision_id, actionType: r.action_type, provider: r.provider,
        similarity: Number(r.similarity), createdAt: r.created_at,
      }));
    return filterPrecedentMatches(rows);
  } catch {
    return [];
  }
}

// "Real precedent memory" plan, item 4: the AI-scored judgment prompt
// needs the free-text decision/reasoning behind each precedent match,
// not just its id -- a second, small select joining onto agent_decisions
// rather than teaching search_decision_precedent's own SQL to return
// arbitrarily-truncated free text.
export type PrecedentPromptMatch = PrecedentMatch & { decision: string; reasoning: string };

/**
 * Same as findPrecedent, but also fetches the free-text decision +
 * reasoning for each match, for building a real-precedent prompt block.
 * Never throws -- an empty array means "no precedent to show," same
 * posture as findPrecedent itself.
 */
export async function loadPrecedentForPrompt(
  admin: SupabaseClient,
  apiKeyId: string,
  embeddingLiteral: string,
  excludeDecisionId?: string | null,
  limit: number = DEFAULT_LIMIT,
): Promise<PrecedentPromptMatch[]> {
  const matches = await findPrecedent(admin, apiKeyId, embeddingLiteral, excludeDecisionId, limit);
  if (!matches.length) return [];
  try {
    const { data } = await admin
      .from("agent_decisions")
      .select("id, decision, reasoning")
      .in("id", matches.map((m) => m.decisionId));
    const byId = new Map(((data ?? []) as { id: string; decision: string; reasoning: string }[]).map((r) => [r.id, r]));
    return matches
      .map((m) => {
        const row = byId.get(m.decisionId);
        return row ? { ...m, decision: row.decision, reasoning: row.reasoning } : null;
      })
      .filter((m): m is PrecedentPromptMatch => m !== null);
  } catch {
    return [];
  }
}

/**
 * Looks up the embedding already stored for one decision (as a pgvector
 * literal string, ready to feed straight into findPrecedent) -- reuses
 * whatever item 1 already computed at log time rather than generating a
 * second embedding for the same action. Returns null when no embedding
 * exists yet (the live attempt failed, or hasn't run) -- callers must
 * treat that as "no precedent available," never an error.
 */
export async function loadStoredEmbeddingLiteral(admin: SupabaseClient, decisionId: string): Promise<string | null> {
  try {
    const { data } = await admin.from("decision_embeddings").select("embedding").eq("decision_id", decisionId).maybeSingle();
    const embedding = (data as { embedding?: string } | null)?.embedding;
    return typeof embedding === "string" ? embedding : null;
  } catch {
    return null;
  }
}
