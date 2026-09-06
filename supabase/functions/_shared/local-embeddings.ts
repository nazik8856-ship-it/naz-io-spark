// "Own decision-making machine" plan, item 178: text embeddings with zero
// external AI dependency. Supabase's Edge Runtime ships a first-party,
// no-API-key inference session (`Supabase.ai.Session`) running the
// `gte-small` model in-process -- no network call, no Lovable/OpenAI/
// Anthropic key, available identically on hosted and self-hosted
// projects. This replaces decision-embeddings.ts's Lovable-gateway-based
// `generateEmbedding` for every NEW embedding this plan's items (176-181)
// need. decision-embeddings.ts itself is left untouched for now -- the
// judgment/precedent system it serves is separate, existing
// functionality out of scope for this round (see item 178's own "share
// embeddings across features" as later, deliberate follow-up work, not
// a same-day migration of already-live precedent data).
//
// gte-small is English-only and truncates input past 512 tokens (roughly
// 2000 characters) -- both acceptable for this endpoint's own message/
// entry-text length caps (response-context.ts's MAX_MESSAGE_CHARS/
// MAX_ENTRY_CHARS are already well under that).
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

// Ambient global -- the Supabase Edge Runtime injects this directly into
// every function's scope, the same way `Deno` is a global rather than an
// import. No package to install, no type declarations shipped for it.
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options?: Record<string, unknown>): Promise<unknown>;
    };
  };
};

// One session per isolate, not per call -- Supabase's own docs note
// sessions are reusable across requests; creating a fresh one per call
// would re-pay whatever one-time model-load cost the runtime incurs.
let session: InstanceType<typeof Supabase.ai.Session> | null = null;
function getSession() {
  if (!session) session = new Supabase.ai.Session("gte-small");
  return session;
}

/**
 * Never throws -- returns null on any failure at all (runtime without
 * the Supabase.ai global, a malformed result, wrong dimension), the same
 * "no embedding is a normal, expected outcome" posture
 * decision-embeddings.ts's own generateEmbedding already established.
 * Unlike that function, this never needs a budget/spend-cap check --
 * there is no per-call cost to gate, it's local inference.
 */
export async function generateLocalEmbedding(text: string): Promise<number[] | null> {
  try {
    if (!text.trim()) return null;
    const result = await getSession().run(text, { mean_pool: true, normalize: true });
    const vector = Array.isArray(result) ? result : (result as { data?: unknown })?.data;
    if (!Array.isArray(vector) || vector.length !== LOCAL_EMBEDDING_DIMENSIONS) return null;
    if (!vector.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) return null;
    return vector as number[];
  } catch {
    return null;
  }
}
