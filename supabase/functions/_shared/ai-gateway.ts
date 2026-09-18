// Shared LLM-gateway resolver. Prefers a direct OpenAI call (OPENAI_API_KEY)
// and falls back to the Lovable AI gateway (LOVABLE_API_KEY) when that's
// the only key configured. Established by run-ai-agent/generate-ai-agent;
// centralized here so every function that calls an LLM resolves the same
// way and stays in sync if the provider priority ever changes again.
//
// Both endpoints speak the same OpenAI-chat-completions-shaped request/
// response (Lovable's gateway is itself OpenAI-compatible), so callers only
// need to swap the URL/header/model — the body shape (messages, temperature,
// response_format, tools, stream) carries over unchanged.
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODEL = "gpt-4o-mini";
// A stronger tier for genuinely hard reasoning tasks (deep analysis, audits,
// multi-step plans) — mirrors the two-tier MODEL/DEEP_MODEL split several
// functions already used on the Lovable gateway.
export const OPENAI_DEEP_MODEL = "gpt-4o";
export const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const LOVABLE_MODEL = "google/gemini-3-flash-preview";

export type GatewayConfig = { url: string; model: string; deepModel: string; key: string; provider: "openai" | "lovable" };

export function pickAiGateway(): GatewayConfig | null {
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) return { url: OPENAI_URL, model: OPENAI_MODEL, deepModel: OPENAI_DEEP_MODEL, key: openai, provider: "openai" };
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  if (lovable) return { url: LOVABLE_URL, model: LOVABLE_MODEL, deepModel: LOVABLE_MODEL, key: lovable, provider: "lovable" };
  return null;
}

export function aiGatewayHeaders(cfg: GatewayConfig): Record<string, string> {
  return {
    ...(cfg.provider === "openai" ? { Authorization: `Bearer ${cfg.key}` } : { "Lovable-API-Key": cfg.key }),
    "Content-Type": "application/json",
  };
}

/** Non-streaming chat completion. Body should already have `model` set (usually cfg.model or cfg.deepModel). */
export async function callAiGateway(body: Record<string, unknown>, cfg: GatewayConfig, signal?: AbortSignal): Promise<Response> {
  return await fetch(cfg.url, {
    method: "POST",
    headers: aiGatewayHeaders(cfg),
    body: JSON.stringify(body),
    signal,
  });
}

// ---------------------------------------------------------------------------
// Embeddings — a DIFFERENT endpoint/model family than chat completions.
// ---------------------------------------------------------------------------
export const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const LOVABLE_EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
export const LOVABLE_EMBEDDING_MODEL = "google/text-embedding-004";
// Fixed dimension every embedding call must return — pgvector columns are a
// fixed width. OpenAI's v3 embedding models support truncating output via
// the `dimensions` request param, so this stays constant across providers.
export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddingGatewayConfig = { url: string; model: string; key: string; provider: "openai" | "lovable" };

export function pickEmbeddingGateway(): EmbeddingGatewayConfig | null {
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) return { url: OPENAI_EMBEDDINGS_URL, model: OPENAI_EMBEDDING_MODEL, key: openai, provider: "openai" };
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  if (lovable) return { url: LOVABLE_EMBEDDINGS_URL, model: LOVABLE_EMBEDDING_MODEL, key: lovable, provider: "lovable" };
  return null;
}

/** Returns the embedding vector, or null on any failure — callers treat embeddings as best-effort. */
export async function callEmbeddingGateway(text: string, cfg: EmbeddingGatewayConfig): Promise<number[] | null> {
  try {
    const body: Record<string, unknown> = { model: cfg.model, input: text };
    if (cfg.provider === "openai") body.dimensions = EMBEDDING_DIMENSIONS;
    // Both providers' embeddings endpoints take a plain Bearer token (unlike
    // chat completions, where Lovable expects its own "Lovable-API-Key" header).
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const vec = data?.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch {
    return null;
  }
}
