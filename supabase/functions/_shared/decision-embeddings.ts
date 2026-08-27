// "Real precedent memory" plan, item 1: real semantic memory for the
// Control API's automated decision-making, replacing pure guesswork with
// an actual searchable fingerprint of every external-company decision.
//
// Scoped strictly to `origin: "external-api"` decisions -- the same
// established signal (a real `api_key_id`) used throughout the "zero
// human review" round. NazAI's own internal agents are untouched: this
// module is never called for a decision with no api_key_id.
//
// Generates embeddings via the same Lovable AI gateway every other AI
// call in this codebase already uses (control-engine's own
// `https://ai.gateway.lovable.dev/v1/chat/completions`), on the
// documented assumption that gateway also exposes an OpenAI-compatible
// `/v1/embeddings` route -- this needs verifying against the gateway's
// actual docs before this is ever run against a real account; if the
// model name or response shape differs, `generateEmbedding` fails
// closed (returns null) rather than silently storing garbage.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getApiKeySpendStatus, recordAiSpend } from "./spend-guard.ts";

const EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

// NOTE: EMBEDDING_DIMENSIONS must exactly match whatever EMBEDDING_MODEL
// actually returns -- pgvector's column dimension is fixed at table-
// creation time (see the accompanying migration), so changing either of
// these after real rows exist requires a real migration, not just an
// edit here. 768 matches Google's common text-embedding-004 family,
// a reasonable default given every other AI call in this codebase
// already routes through a "google/..." model on this same gateway --
// confirm against the gateway's actual embeddings support before this
// runs against a live account.
export const EMBEDDING_MODEL = "google/text-embedding-004";
export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddableAction = {
  actionType: string;
  provider: string;
  description: string;
  params: unknown;
};

/**
 * Pure -- the exact text embedded for one action. Deterministic: the
 * same action always produces the same input text, so two literally
 * identical requests always get comparable embeddings regardless of
 * when they were embedded.
 */
export function buildEmbeddingInput(action: EmbeddableAction): string {
  let paramsText = "";
  try {
    paramsText = JSON.stringify(action.params ?? {});
  } catch {
    paramsText = "";
  }
  const base = `${action.actionType} | ${action.provider} | ${action.description}`;
  const withParams = paramsText && paramsText !== "{}" ? `${base} | ${paramsText}` : base;
  return withParams.slice(0, 4000);
}

/** Pure -- pgvector's plain-text literal format for an embedding array (e.g. "[0.1,0.2,...]"), the format supabase-js must send since it has no native vector type support. */
export function formatEmbeddingLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// "Real precedent memory" plan, item 2: backfilling historical rows.
export type BackfillableDecisionRow = {
  action_type: string | null;
  provider: string | null;
  description: string | null;
  params: unknown;
  decision: string;
  reasoning: string;
};

/**
 * Pure -- builds embedding input for a HISTORICAL agent_decisions row,
 * which may predate structured description/params capture (only ever
 * populated for the two deterministic BLOCK call sites -- see
 * control-gate.ts's logStop, whose own comment documents this as
 * deliberate scope, not an oversight). Falls back to the row's own
 * free-text decision/reasoning, which every row always has, when the
 * structured fields are missing.
 */
export function buildBackfillEmbeddingInput(row: BackfillableDecisionRow): string {
  const actionType = row.action_type ?? "unknown";
  const provider = row.provider ?? "unknown";
  if (row.description) {
    return buildEmbeddingInput({ actionType, provider, description: row.description, params: row.params });
  }
  return buildEmbeddingInput({ actionType, provider, description: `${row.decision} — ${row.reasoning}`, params: {} });
}

/**
 * Calls the embeddings endpoint. Never throws -- returns null on any
 * failure at all (missing key, network error, non-2xx, malformed body,
 * wrong dimension) so a caller can always treat "no embedding" as a
 * normal, expected outcome rather than an exception to catch.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey || !text) return null;
    const res = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vector = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
    if (!vector.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) return null;
    return vector as number[];
  } catch {
    return null;
  }
}

// "Real precedent memory" plan, item 11: a very high-volume external
// integration shouldn't be able to run up an open-ended new cost just by
// sending lots of traffic that each generate an embedding. Capped the
// exact same way AI-judgment spend already is -- this api key's own
// daily ai_spend_caps/ai_spend_daily row (spend-guard.ts), not a second,
// separate embedding-specific budget. A key with no cap of its own is
// unaffected, same as judgment spend today.

/** Pure -- ~4 chars/token, the standard estimate when a provider's exact tokenizer isn't available. An embedding call has no output tokens to price, only input. */
export function estimateEmbeddingTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * generateEmbedding, but budget-aware: skips the call entirely once this
 * api key's own daily spend cap is already used up (never wastes a real
 * API call just to throw its result away), and meters a successful
 * call's estimated cost into that same running total afterwards -- so
 * embedding costs and AI-judgment costs share one real budget per key,
 * exactly like the plan asks. Never throws; returns null on a skip the
 * same way generateEmbedding itself already returns null on failure, so
 * every existing caller's "no embedding" fallback already handles this
 * without any change.
 */
export async function generateEmbeddingWithinBudget(
  admin: SupabaseClient,
  userId: string,
  apiKeyId: string,
  text: string,
): Promise<number[] | null> {
  try {
    const status = await getApiKeySpendStatus(admin, userId, apiKeyId);
    if (status.has_cap && status.over_cap) return null;
  } catch { /* a status-check hiccup must never block a real embedding -- fall through and try it */ }

  const embedding = await generateEmbedding(text);
  if (!embedding) return null;

  try {
    await recordAiSpend(admin, userId, EMBEDDING_MODEL, { prompt_tokens: estimateEmbeddingTokens(text) }, "embedding", null, apiKeyId);
  } catch { /* a metering hiccup must never throw away a real embedding that already succeeded */ }

  return embedding;
}

/**
 * Best-effort: embeds and stores ONE external-api decision. Only ever
 * does anything when BOTH a real decisionId (already inserted into
 * agent_decisions) and a real apiKeyId are present -- the same
 * established "this is genuinely an external Control API decision"
 * signal used throughout the prior round. Never throws, and a failure
 * here can never roll back or affect the real decision that already
 * happened -- this is pure enrichment, always applied strictly after
 * the fact.
 */
export async function embedDecisionIfExternal(
  admin: SupabaseClient,
  input: { decisionId: string | null; apiKeyId: string | null | undefined; userId: string } & EmbeddableAction,
): Promise<void> {
  if (!input.decisionId || !input.apiKeyId) return;
  try {
    const text = buildEmbeddingInput(input);
    const embedding = await generateEmbeddingWithinBudget(admin, input.userId, input.apiKeyId, text);
    if (!embedding) return;
    await admin.from("decision_embeddings").insert({
      user_id: input.userId,
      decision_id: input.decisionId,
      api_key_id: input.apiKeyId,
      action_type: input.actionType,
      provider: input.provider,
      embedding: formatEmbeddingLiteral(embedding),
    });
  } catch { /* embedding is a best-effort enrichment, never a required step */ }
}
