// Shared LLM-gateway resolver. Prefers a direct OpenAI call (OPENAI_API_KEY)
// and falls back to the Lovable AI gateway (LOVABLE_API_KEY) when that's
// the only key configured. Established by generate-ai-agent; centralized
// here so every function that calls an LLM resolves the same way and stays
// in sync if the provider priority ever changes again.
//
// Both endpoints speak the same OpenAI-chat-completions-shaped request/
// response (Lovable's gateway is itself OpenAI-compatible), so callers only
// need to swap the URL/header/model — the body shape (messages, temperature,
// response_format, tools, stream) carries over unchanged.
import { fetchWithRetry } from "./fetch-retry.ts";

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

// GAP 8 (Speed & Reliability Layer): the AI provider call previously had
// zero resilience of its own -- a single bare fetch, no retry on a
// transient 429/5xx, and no circuit breaker. This is deliberately
// DISTINCT from agent-runtime's own per-(account, action_type) breakers
// (circuit_breakers table, control-gate.ts): those judge one account's
// one action kind; this judges one AI PROVIDER's own reachability, a
// platform-wide concern no single account's breaker row could represent,
// and every caller of callAiGateway across the codebase (15+ functions,
// not just the two generators) benefits transparently with no call-site
// change.
//
// Retry reuses fetch-retry.ts's existing transient-failure backoff
// (429/5xx, network errors) -- the same policy already proven for
// outbound provider writes, just pointed at the AI gateway endpoint
// instead. The circuit breaker is in-memory, per-isolate, keyed by
// provider name: after enough calls have ultimately failed (post-retry)
// within a short window, every further call fails FAST with a synthetic
// 503 Response -- no network attempt at all -- for a cooldown period,
// instead of every concurrent caller independently retrying against a
// provider that's already down.
const PROVIDER_BREAKER_FAILURE_THRESHOLD = 5;
const PROVIDER_BREAKER_WINDOW_MS = 60_000;
const PROVIDER_BREAKER_COOLDOWN_MS = 30_000;

type ProviderBreakerState = { failureTimestamps: number[]; trippedUntil: number | null };
const providerBreakers = new Map<string, ProviderBreakerState>();

function getProviderBreaker(provider: string): ProviderBreakerState {
  let state = providerBreakers.get(provider);
  if (!state) {
    state = { failureTimestamps: [], trippedUntil: null };
    providerBreakers.set(provider, state);
  }
  return state;
}

/** True while this provider's breaker is tripped -- self-clears once the cooldown elapses, same half-open-on-next-call shape control-gate.ts's own breaker uses, just simpler (no half-open trial bookkeeping needed for a fail-fast-only breaker). */
function isProviderBreakerTripped(provider: string): boolean {
  const state = providerBreakers.get(provider);
  if (!state?.trippedUntil) return false;
  if (Date.now() >= state.trippedUntil) {
    state.trippedUntil = null;
    state.failureTimestamps = [];
    return false;
  }
  return true;
}

function recordProviderFailure(provider: string): void {
  const state = getProviderBreaker(provider);
  const now = Date.now();
  state.failureTimestamps = state.failureTimestamps.filter((t) => now - t < PROVIDER_BREAKER_WINDOW_MS);
  state.failureTimestamps.push(now);
  if (state.failureTimestamps.length >= PROVIDER_BREAKER_FAILURE_THRESHOLD) {
    state.trippedUntil = now + PROVIDER_BREAKER_COOLDOWN_MS;
  }
}

function recordProviderSuccess(provider: string): void {
  const state = getProviderBreaker(provider);
  state.failureTimestamps = [];
  state.trippedUntil = null;
}

/** Exported for tests only -- resets every provider's breaker state between test cases. */
export function resetProviderBreakersForTests(): void {
  providerBreakers.clear();
}
/** Exported for tests only -- the pure breaker mechanics, so threshold/cooldown/per-provider-scoping can be verified without a real network call or a real 300ms+ retry delay. */
export { isProviderBreakerTripped as isProviderBreakerTrippedForTests, recordProviderFailure as recordProviderFailureForTests, recordProviderSuccess as recordProviderSuccessForTests };

/** Non-streaming chat completion. Body should already have `model` set (usually cfg.model or cfg.deepModel). */
export async function callAiGateway(body: Record<string, unknown>, cfg: GatewayConfig, signal?: AbortSignal): Promise<Response> {
  if (isProviderBreakerTripped(cfg.provider)) {
    return new Response(
      JSON.stringify({ error: { message: `AI provider "${cfg.provider}" is temporarily circuit-broken after repeated failures -- cooling down before the next attempt.` } }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    const res = await fetchWithRetry(cfg.url, {
      method: "POST",
      headers: aiGatewayHeaders(cfg),
      body: JSON.stringify(body),
      signal,
    }, { attempts: 3, baseDelayMs: 300 });
    if (res.ok) recordProviderSuccess(cfg.provider);
    else if (res.status === 429 || res.status >= 500) recordProviderFailure(cfg.provider);
    return res;
  } catch (err) {
    recordProviderFailure(cfg.provider);
    throw err;
  }
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
