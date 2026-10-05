// "/respond" MVP backlog, item 174: response caching for repeated/near-
// duplicate questions. Two independent lookup paths, both scoped to one
// api_key_id (see the accompanying migration):
//
//  * an exact-hash match (cheap: no embedding call) for the same question
//    asked verbatim (modulo case/whitespace) again;
//  * a near-duplicate match, reusing whatever embedding of the incoming
//    message context retrieval (response-context.ts) already computed --
//    this deliberately never generates a SECOND embedding purely for
//    caching, so a key with no context configured (and therefore no
//    embedding computed anyway) only ever gets the exact-hash path.
//
// Only ever populated with a genuinely grounded answer -- see
// control-api/index.ts's own call site for why caching an "I don't know"
// fallback would blunt items 169/170's content-gap tracking.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "./api-key-auth.ts";
import type { ResponseSource } from "./response-context.ts";

export const CACHE_TTL_HOURS = 24;

// Deliberately far stricter than response-context.ts's own
// MIN_CONTEXT_SIMILARITY (0.55) -- "similar topic" is plenty for useful
// grounding CONTEXT, but nowhere near enough to safely replay as a
// cached ANSWER to what might be a meaningfully different question. Only
// a near-verbatim rephrasing should ever hit this path.
export const MIN_CACHE_SIMILARITY = 0.97;

export type CachedResponse = { answer: string; sources: ResponseSource[] | null; confidence: string | null };

/** Pure -- the same key for "Refund policy?" and "refund policy?  ", so trivial formatting differences still hit the cache. */
export async function cacheKeyFor(message: string): Promise<string> {
  return sha256Hex(message.trim().toLowerCase());
}

/**
 * GAP 6 (Persistent Ongoing Enforcement): every lookup and write below now
 * requires an exact policy_version match -- the account's CURRENT active
 * policy snapshot id (control-gate.ts/get_active_policy_version's own
 * self-healing mechanism, the SAME one every agent decision is already
 * pinned to via agent_decisions.policy_version). A cache entry written
 * under an older policy version is never served again, even if its TTL
 * hasn't expired yet: the moment the account's hard_rules/safety_rules
 * change, every previously-cached answer falls through to a fresh,
 * fully re-governed one instead of continuing to replay a verdict that
 * may no longer be compliant.
 */

/** Never throws -- a lookup failure just means "no cache hit," never breaks a real answer. */
export async function findExactCachedResponse(
  admin: SupabaseClient,
  apiKeyId: string,
  messageHash: string,
  currentPolicyVersion: number,
): Promise<CachedResponse | null> {
  try {
    const { data } = await admin
      .from("api_response_cache")
      .select("answer, sources, confidence")
      .eq("api_key_id", apiKeyId)
      .eq("message_hash", messageHash)
      .eq("policy_version", currentPolicyVersion)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as CachedResponse | null) ?? null;
  } catch {
    return null;
  }
}

/** Never throws. `embeddingLiteral` is expected to already be an embedding of the CURRENT incoming message (see decision-embeddings.ts's formatEmbeddingLiteral), reused from context retrieval rather than generated fresh here. */
export async function findNearDuplicateCachedResponse(
  admin: SupabaseClient,
  apiKeyId: string,
  embeddingLiteral: string,
  currentPolicyVersion: number,
): Promise<CachedResponse | null> {
  try {
    const { data, error } = await admin.rpc("search_response_cache", {
      _api_key_id: apiKeyId,
      _embedding: embeddingLiteral,
      _policy_version: currentPolicyVersion,
      _limit: 1,
    });
    if (error || !Array.isArray(data) || !data.length) return null;
    const row = data[0] as { answer: string; sources: ResponseSource[] | null; confidence: string | null; similarity: number };
    if (Number(row.similarity) < MIN_CACHE_SIMILARITY) return null;
    return { answer: row.answer, sources: row.sources ?? null, confidence: row.confidence ?? null };
  } catch {
    return null;
  }
}

/** Best-effort -- storing a cache entry must never break a real answer that already succeeded. */
export async function storeCachedResponse(
  admin: SupabaseClient,
  userId: string,
  apiKeyId: string,
  message: string,
  messageHash: string,
  embeddingLiteral: string | null,
  answer: string,
  sources: ResponseSource[] | undefined,
  confidence: string,
  policyVersion: number,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    await admin.from("api_response_cache").insert({
      user_id: userId,
      api_key_id: apiKeyId,
      message_hash: messageHash,
      message: message.slice(0, 500),
      embedding: embeddingLiteral,
      answer,
      sources: sources ?? null,
      confidence,
      expires_at: expiresAt,
      policy_version: policyVersion,
    });
  } catch { /* caching must never break a real answer that already succeeded */ }
}
