// "White-labeled 'brain' endpoint" plan, item 2: per-key grounding context
// for POST /control-api/v1/respond -- the facts an integrating company
// gives NazAI so it can answer its own end user's messages accurately.
// Scoped strictly to one api_key_id (see the accompanying migration),
// never account-wide like knowledge_base_entries -- one company's context
// must never leak into another key's answers, which matters here in a way
// it doesn't for the judgment-vocabulary knowledge base (that's a single
// account judging its own actions; this is a multi-tenant "brain" feature
// serving many unrelated end customers through the same account).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ResponseContextEntry = {
  id: string;
  entry_text: string;
};

const MAX_PROMPT_ENTRIES = 20;
const MAX_ENTRY_CHARS = 1000;

// "/respond" MVP backlog, item 163: retrieval-based context. A cosine
// similarity below this is "not actually relevant" -- pgvector's
// nearest-neighbor search always returns something up to the limit, even
// when nothing in this key's context looks anything like the incoming
// message. Same threshold precedent-search.ts's own MIN_SIMILARITY uses --
// no reason for the two to drift apart, they're the same kind of judgment
// ("is this genuinely similar, or just the closest of a bad lot").
export const MIN_CONTEXT_SIMILARITY = 0.55;
const DEFAULT_CONTEXT_LIMIT = 8;

/**
 * Finds this api key's context entries most relevant to the given
 * (already-embedded) message. Never throws -- returns an empty array on
 * any failure at all (missing RPC, network error, malformed rows), the
 * same "no match is a normal, expected outcome" posture
 * precedent-search.ts's findPrecedent already established. An empty
 * result here is NOT the same as "no context configured" -- callers
 * should fall back to loading every enabled entry directly when this
 * comes back empty, so a key whose entries predate embeddings (or whose
 * embedding calls failed) still gets its context included rather than
 * silently losing it.
 */
export async function findRelevantContext(
  admin: SupabaseClient,
  apiKeyId: string,
  embeddingLiteral: string,
  limit: number = DEFAULT_CONTEXT_LIMIT,
): Promise<ResponseContextEntry[]> {
  try {
    const { data, error } = await admin.rpc("search_response_context", {
      _api_key_id: apiKeyId,
      _embedding: embeddingLiteral,
      _limit: limit,
    });
    if (error || !Array.isArray(data)) return [];
    return (data as { id: string; entry_text: string; similarity: number }[])
      .filter((r) => Number(r.similarity) >= MIN_CONTEXT_SIMILARITY)
      .map((r) => ({ id: r.id, entry_text: r.entry_text }));
  } catch {
    return [];
  }
}

/**
 * Pure -- builds the prompt block, or "" when nothing is configured
 * (never injects an empty/misleading section header). Framed as strict
 * grounding material for a generated ANSWER, not judgment vocabulary for
 * a verdict -- this endpoint responds to a message, it doesn't gate an
 * action.
 */
export function buildContextPromptBlock(entries: ResponseContextEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.slice(0, MAX_PROMPT_ENTRIES).map((e) => `- ${e.entry_text.slice(0, MAX_ENTRY_CHARS)}`);
  return (
    `\n# CONTEXT PROVIDED BY THIS INTEGRATION -- use only this to answer; never invent facts beyond it.\n` +
    `${lines.join("\n")}\n`
  );
}

const MAX_MESSAGE_CHARS = 4000;
export const MAX_PERSONA_CHARS = 500;
const MAX_HISTORY_MESSAGES = 20;

export type RespondChatMessage = { role: "user" | "assistant"; content: string };

export type ParsedRespondRequest =
  | { message: string; conversationHistory: RespondChatMessage[] }
  | { error: string };

/**
 * Pure -- validates and normalizes a POST /control-api/v1/respond body.
 * Rejects an empty or oversized message before anything ever touches the
 * model, same "validate before spending a real call" posture as
 * parseControlApiAction.
 */
export function parseRespondRequest(raw: unknown): ParsedRespondRequest {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const message = String(b?.message ?? "").trim();
  if (!message) return { error: "message is required" };
  if (message.length > MAX_MESSAGE_CHARS) {
    return { error: `message must be at most ${MAX_MESSAGE_CHARS} characters` };
  }

  const rawHistory = Array.isArray(b?.conversation_history) ? b.conversation_history : [];
  if (rawHistory.length > MAX_HISTORY_MESSAGES) {
    return { error: `conversation_history supports at most ${MAX_HISTORY_MESSAGES} messages` };
  }
  const conversationHistory: RespondChatMessage[] = [];
  for (const entry of rawHistory) {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const role = e?.role === "assistant" ? "assistant" : e?.role === "user" ? "user" : null;
    const content = String(e?.content ?? "").trim();
    if (!role || !content) {
      return { error: "each conversation_history entry needs a role ('user' or 'assistant') and non-empty content" };
    }
    conversationHistory.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }

  return { message, conversationHistory };
}

/** Pure -- a valid api_keys.response_persona value: null (clear it), or a non-empty string within the column's own CHECK-constraint length. */
export function isValidPersona(persona: unknown): persona is string | null {
  if (persona === null) return true;
  return typeof persona === "string" && persona.trim().length > 0 && persona.length <= MAX_PERSONA_CHARS;
}
