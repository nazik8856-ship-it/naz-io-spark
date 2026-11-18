// Outer Control: a connected AI tool's address. NazAI stores the provider's BASE address (https://api.groq.com/openai/v1) and adds
// the path of the call it makes: /chat/completions to send a message, /models to list the models a key can use (Anthropic-style:
// /messages and /models). A full address stored before this (…/v1/chat/completions) still works: the path is never added twice.
// Formats without a known path (generic_json, mcp) use the address exactly as given. Pure; the browser has a copy
// (src/lib/outer-control-tool-url.ts) held to this one by a test.

import { redactSecrets, maskUrlQueries } from "./redact-secrets.ts";
import { parseStrictObject } from "./model-output.ts";

export const CALL_PATH: Record<string, string> = { openai_chat: "/chat/completions", anthropic_messages: "/messages" };
const KNOWN_SUFFIXES: Record<string, RegExp> = {
  openai_chat: /\/(chat\/completions|completions|models)\/?$/i,
  anthropic_messages: /\/(messages|models)\/?$/i,
};

/** The address to store: the base, without the call path, trailing slashes or white space. Other formats: as given (trimmed). */
export function toolBaseUrl(raw: string, format: string): string {
  const t = String(raw ?? "").trim();
  const suffix = KNOWN_SUFFIXES[format];
  if (!suffix) return t;
  let u: URL;
  try { u = new URL(t); } catch { return t; }
  u.pathname = u.pathname.replace(/\/+$/, "").replace(suffix, "").replace(/\/+$/, "");
  const s = u.toString();
  return s.endsWith("/") && !u.search ? s.slice(0, -1) : s;
}

/** The address a message is sent to: the base plus the call path of its format. */
export function toolRequestUrl(stored: string, format: string): string {
  const path = CALL_PATH[format];
  if (!path) return String(stored ?? "").trim();
  const base = toolBaseUrl(stored, format);
  try {
    const u = new URL(base);
    u.pathname = `${u.pathname.replace(/\/+$/, "")}${path}`;
    return u.toString();
  } catch { return `${base}${path}`; }
}

/** The address that lists the models a key can use, or null when the format has none. */
export function toolModelsUrl(stored: string, format: string): string | null {
  if (!CALL_PATH[format]) return null;
  const base = toolBaseUrl(stored, format);
  try {
    const u = new URL(base);
    u.pathname = `${u.pathname.replace(/\/+$/, "")}/models`;
    return u.toString();
  } catch { return null; }
}

// ---- Models: which ids in a provider's list can chat ------------------------------------------------------------------------

/** Ids that are not chat models: speech, images, embeddings, moderation and guard models, legacy completion models. */
const NOT_CHAT = /(whisper|tts|transcri|speech|audio|realtime|dall-?e|image|imagen|veo|embed|moderation|guard|rerank|davinci|babbage|playai|distil|clip|vision-preview|search-preview|aqa|learnlm-tuning)/i;

/** The chat model ids in a provider's /models reply (OpenAI and Anthropic shape: {data: [{id}]}; Gemini's "models/…" prefix dropped). */
export function chatModelIds(payload: unknown, max = 200): string[] {
  const list = (payload as { data?: unknown; models?: unknown } | null)?.data ?? (payload as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const m of list) {
    const raw = typeof m === "string" ? m : (m as { id?: unknown; name?: unknown } | null)?.id ?? (m as { name?: unknown } | null)?.name;
    if (typeof raw !== "string") continue;
    const id = raw.replace(/^models\//, "").trim();
    if (!id || id.length > 120 || /[\s<>"']/.test(id) || NOT_CHAT.test(id)) continue;
    if ((m as { active?: unknown })?.active === false) continue;
    if (!ids.includes(id)) ids.push(id);
    if (ids.length >= max) break;
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

// ---- What a failed call means, with the exact address and the provider's own words ------------------------------------------

/** The provider's own error message from a failed reply (OpenAI, Anthropic, Groq, Gemini shapes), short and with secrets masked. */
export function providerMessage(bodyText: string): { message: string | null; code: string | null } {
  let message: string | null = null;
  let code: string | null = null;
  // Read with the shared bounded reader (an error reply is outside text like any other); not an object: plain text below.
  const j = parseStrictObject(bodyText);
  if (j) {
    const e = j;
    const err = e?.error;
    if (err && typeof err === "object") {
      const o = err as Record<string, unknown>;
      message = typeof o.message === "string" ? o.message : null;
      code = typeof o.code === "string" ? o.code : typeof o.type === "string" ? o.type : typeof o.status === "string" ? o.status : null;
    } else if (typeof err === "string") message = err;
    if (!message && typeof e?.message === "string") message = e.message as string;
    if (!message && typeof e?.detail === "string") message = e.detail as string;
  } else {
    const t = String(bodyText ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    message = t && t.length < 300 && !/<!doctype|<html/i.test(bodyText) ? t : null;
  }
  const clean = (s: string | null) => s ? maskUrlQueries(redactSecrets(s)).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 220) : null;
  return { message: clean(message), code: clean(code) };
}

/** Whether a failed reply means the model is unknown or not open to this key (OpenAI-style APIs answer that with HTTP 404). */
export function isModelProblem(status: number, msg: { message: string | null; code: string | null }): boolean {
  const text = `${msg.code ?? ""} ${msg.message ?? ""}`.toLowerCase();
  if (/model_not_found|model_decommissioned|model_not_available|invalid_model|not_found_error/.test(text) && /model/.test(text)) return true;
  return (status === 404 || status === 400 || status === 403) && /\bmodel\b/.test(text) && /(not exist|not found|no access|do not have access|decommission|deprecat|not available|not supported|invalid|retired)/.test(text);
}

/** The address as shown to the person: no query string (it may hold a key). */
export const shownUrl = (u: string) => maskUrlQueries(u);
