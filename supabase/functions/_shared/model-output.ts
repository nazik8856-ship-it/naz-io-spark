// Safe input & output handling, front 3: what comes back from a model is untrusted input, exactly like what a person types.
//
// Models wrap JSON in prose and code fences, cut it off, add fields, use the wrong type, and (when the text they were given had
// instructions in it) say what a stranger told them to say. Every function used to unwrap that its own way. This is the one way:
//
//   const r = await parseModelJson(raw, schema);          // extract -> bound -> clean -> check against the schema
//   const r = await askForJson({ call, schema });         // the same, with ONE retry that tells the model what was wrong
//
// Both answer { ok: true, value } or { ok: false, reason, error }; they never throw. A reply that still does not fit after the retry is
// the caller's existing "could not complete" path, so nothing half-valid is ever stored or delivered.
// Schemas come from schema.ts. For model output use clip mode (long text is cut, long lists keep their first items, unknown keys are
// dropped, a wrong optional field falls back to its default) -- a long answer is not an attack, an unexpected shape is only a retry.

import { jsonDepth, sanitizeJson, type InputLimits } from "./input.ts";
import type { Check } from "./schema.ts";

export type ModelJsonFailure = { ok: false; reason: "empty" | "too_large" | "not_json" | "too_deep" | "too_many_items" | "schema"; error: string };
export type ModelJson<T> = { ok: true; value: T; repaired: boolean } | ModelJsonFailure;

export const MODEL_JSON_MAX_CHARS = 400_000;

/** The JSON text inside a reply: a code fence is opened, prose around the first balanced object or list is ignored. null = none found. */
export function extractJsonText(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  const fence = s.match(/^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/);
  if (fence) s = fence[1].trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    const end = balancedEnd(s, 0);
    if (end > 0) return s.slice(0, end);
    return s; // unbalanced (cut off): let the parser say so
  }
  // prose first: the first fenced block that holds JSON, else the first { or [ that balances
  const inner = s.match(/```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```/);
  if (inner) { const t = inner[1].trim(); if (t.startsWith("{") || t.startsWith("[")) return extractJsonText(t); }
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{" && s[i] !== "[") continue;
    const end = balancedEnd(s, i);
    if (end > i) return s.slice(i, end);
    if (i > 2000) break; // not going to scan the whole reply for a start
  }
  return null;
}

/** Index just past the bracket that closes the one at `start`, or -1. */
function balancedEnd(s: string, start: number): number {
  let depth = 0, inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inString) { if (c === 92) i++; else if (c === 34) inString = false; continue; }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

export function parseModelJson<T>(raw: unknown, schema: Check<T>, limits: InputLimits & { maxChars?: number } = {}): ModelJson<T> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "empty", error: "the reply was empty" };
  if (raw.length > (limits.maxChars ?? MODEL_JSON_MAX_CHARS)) return { ok: false, reason: "too_large", error: "the reply was too long" };
  const text = extractJsonText(raw);
  if (text === null) return { ok: false, reason: "not_json", error: "the reply did not contain JSON" };
  if (jsonDepth(text, limits.maxDepth ?? 16) > (limits.maxDepth ?? 16)) return { ok: false, reason: "too_deep", error: "the JSON was nested too deeply" };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, reason: "not_json", error: `the JSON could not be read (${e instanceof Error ? e.message.slice(0, 80) : "invalid"})` }; }
  const clean = sanitizeJson(parsed, { maxArray: 5000, maxKeys: 500, maxValues: 50_000, maxDepth: 16, ...limits });
  if (!clean) return { ok: false, reason: "too_many_items", error: "the JSON had too many items" };
  const checked = schema(clean.value, "");
  if (!checked.ok) return { ok: false, reason: "schema", error: checked.error };
  return { ok: true, value: checked.value, repaired: text.length !== raw.trim().length };
}

export type AskResult<T> = { ok: true; value: T; attempts: number } | (ModelJsonFailure & { attempts: number });

/**
 * Calls the model, checks the reply, and if it does not fit asks once more -- telling the model exactly what was wrong. `call` receives
 * undefined the first time and a short correction message the second time (append it as a final user message).
 */
export async function askForJson<T>(opts: {
  call: (correction?: string) => Promise<string | null | undefined>;
  schema: Check<T>;
  retries?: number;
  limits?: InputLimits & { maxChars?: number };
}): Promise<AskResult<T>> {
  let last: ModelJsonFailure = { ok: false, reason: "empty", error: "no reply" };
  const attempts = 1 + Math.max(0, Math.min(opts.retries ?? 1, 2));
  for (let n = 1; n <= attempts; n++) {
    let raw: string | null | undefined;
    try { raw = await opts.call(n === 1 ? undefined : correctionFor(last)); } catch { raw = null; }
    const r = parseModelJson(raw, opts.schema, opts.limits);
    if (r.ok) return { ok: true, value: r.value, attempts: n };
    last = r;
  }
  return { ...last, attempts };
}

export function correctionFor(f: ModelJsonFailure): string {
  return `Your previous reply could not be used: ${f.error}. Reply again with ONLY the JSON object described above -- no explanation, no code fence.`;
}

const anyObject: Check<Record<string, unknown>> = (v, path = "") =>
  v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false, error: `${path || "reply"}: must be an object` };

/**
 * A model's reply as a plain object, or null: found inside fences and prose, bounded (size, depth, list lengths), strings cleaned.
 * For code that already checks each field it uses and treats null as "no usable answer".
 */
export function parseModelObject(raw: unknown, limits: InputLimits & { maxChars?: number } = {}): Record<string, unknown> | null {
  const r = parseModelJson(raw, anyObject, limits);
  return r.ok ? r.value : null;
}

/** Like parseModelObject, but only when the text IS the JSON object (starts with "{"): plain prose that mentions JSON is not read as one. */
export function parseStrictObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "string" && raw.trim().startsWith("{") ? parseModelObject(raw) : null;
}
