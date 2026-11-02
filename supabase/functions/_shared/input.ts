// Safe input & output handling, front 1: the one place a function reads what a caller sent.
//
//   const body = await readJson(req, { headers: corsHeaders });
//   if (!body.ok) return body.response;          // 400 / 413 in the function's usual { error } shape, never a 500
//   const { prompt } = body.value;
//
// What it guarantees before the function sees a single field:
//   - the body is read with a byte cap (256 KB unless the function asks for more, e.g. a file import) and stops reading at the cap, so
//     a huge or endless upload costs a few KB of memory, not the whole thing; an honest Content-Length over the cap is refused unread
//   - the JSON is not nested deeper than 12 levels (the parser and every later recursive walk stay safe), has no list longer than 2000
//     items, no object with more than 500 keys, and no more than 20,000 values in all (all overridable per function)
//   - NUL bytes, other control characters and lone surrogate halves are taken out of every string (they make the database refuse the
//     row, which used to surface as a 500) and the key "__proto__" is dropped
//   - the result is a plain object (unless the function says it also takes a list); an empty body is {}, as the old
//     `req.json().catch(() => ({}))` gave
// parseBody() adds a schema (see schema.ts); readQuery() does the same for ?a=b parameters.

import { scrubString } from "./clean-text.ts";
import type { Check } from "./schema.ts";

export const DEFAULT_MAX_BYTES = 256 * 1024;
export const FILE_MAX_BYTES = 5 * 1024 * 1024;

export type InputLimits = {
  maxBytes?: number;
  maxDepth?: number;
  maxArray?: number;
  maxKeys?: number;
  maxValues?: number;
};

export type InputOptions = InputLimits & {
  /** Headers for the refusal (the function's CORS headers). */
  headers?: HeadersInit;
  /** Also accept a top-level list (default: the body must be an object). */
  allowArray?: boolean;
  /** Empty body: {} (default) or refuse. */
  requireBody?: boolean;
  /** How this function words an error, when it does not use { error: message }. */
  errorBody?: (f: { code: InputFailureCode; message: string }) => unknown;
};

export type InputFailureCode = "body_too_large" | "invalid_json" | "not_an_object" | "too_deep" | "too_many_items" | "empty_body" | "invalid_input";
export type InputFailure = { ok: false; status: 400 | 413; code: InputFailureCode; message: string; response: Response };
export type JsonRead<T> = { ok: true; value: T; body: T } | InputFailure;

const MESSAGES: Record<InputFailureCode, string> = {
  body_too_large: "The request is too large.",
  invalid_json: "The request body is not valid JSON.",
  not_an_object: "The request body must be a JSON object.",
  too_deep: "The request is nested too deeply.",
  too_many_items: "The request has too many items.",
  empty_body: "The request body is empty.",
  invalid_input: "The request is not valid.",
};

export function failure(code: InputFailureCode, opts: Pick<InputOptions, "headers" | "errorBody"> = {}, message = MESSAGES[code]): InputFailure {
  const status = code === "body_too_large" ? 413 : 400;
  const body = opts.errorBody ? opts.errorBody({ code, message }) : { error: message };
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  return { ok: false, status, code, message, response: new Response(JSON.stringify(body), { status, headers }) };
}

/** Reads at most `max` bytes of the body. null = over the cap. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) { await req.body?.cancel().catch(() => undefined); return null; }
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** Nesting depth of JSON text, counted without parsing it (so a hostile document is refused before the parser sees it). */
export function jsonDepth(text: string, limit: number): number {
  let depth = 0, max = 0, inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) { depth++; if (depth > max) { max = depth; if (max > limit) return max; } }
    else if (c === 125 || c === 93) depth--;
  }
  return max;
}

/** Cleans every string, drops "__proto__", and enforces the size limits while walking. Returns null when a limit is broken. */
export function walk(value: unknown, lim: Required<InputLimits>, state: { values: number }, depth = 0): { v: unknown } | { tooMany: true } {
  if (++state.values > lim.maxValues) return { tooMany: true };
  if (typeof value === "string") return { v: scrubString(value) };
  if (value === null || typeof value !== "object") return { v: value };
  if (Array.isArray(value)) {
    if (value.length > lim.maxArray) return { tooMany: true };
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) { const r = walk(value[i], lim, state, depth + 1); if ("tooMany" in r) return r; out[i] = r.v; }
    return { v: out };
  }
  const keys = Object.keys(value as object);
  if (keys.length > lim.maxKeys) return { tooMany: true };
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === "__proto__") continue;
    const r = walk((value as Record<string, unknown>)[k], lim, state, depth + 1);
    if ("tooMany" in r) return r;
    out[scrubString(k)] = r.v;
  }
  return { v: out };
}

// deno-lint-ignore no-explicit-any
export const DEFAULT_LIMITS: Required<InputLimits> = { maxBytes: DEFAULT_MAX_BYTES, maxDepth: 12, maxArray: 2000, maxKeys: 500, maxValues: 20000 };

/** Strings cleaned, "__proto__" dropped, sizes bounded: for JSON that did not come in as a request body (a model's reply, a fetched page). null = a limit was broken. */
export function sanitizeJson(value: unknown, limits: InputLimits = {}): { value: unknown } | null {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const r = walk(value, lim, { values: 0 });
  return "tooMany" in r ? null : { value: r.v };
}

export async function readJson<T = Record<string, any>>(req: Request, opts: InputOptions = {}): Promise<JsonRead<T>> {
  const lim: Required<InputLimits> = {
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES, maxDepth: opts.maxDepth ?? 12, maxArray: opts.maxArray ?? 2000,
    maxKeys: opts.maxKeys ?? 500, maxValues: opts.maxValues ?? 20000,
  };
  const bytes = await readCapped(req, lim.maxBytes).catch(() => undefined);
  if (bytes === undefined) return failure("invalid_json", opts); // the connection broke mid-body
  if (bytes === null) return failure("body_too_large", opts, `The request is too large (limit ${Math.round(lim.maxBytes / 1024)} KB).`);
  const textBody = new TextDecoder().decode(bytes);
  if (!textBody.trim()) return opts.requireBody ? failure("empty_body", opts) : { ok: true, value: {} as T, body: {} as T };
  if (jsonDepth(textBody, lim.maxDepth) > lim.maxDepth) return failure("too_deep", opts);
  let parsed: unknown;
  try { parsed = JSON.parse(textBody); } catch { return failure("invalid_json", opts); }
  if (!opts.allowArray && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) return failure("not_an_object", opts);
  const walked = walk(parsed, lim, { values: 0 });
  if ("tooMany" in walked) return failure("too_many_items", opts);
  return { ok: true, value: walked.v as T, body: walked.v as T };
}

/** readJson + a schema. A failed check answers 400 { error: "<field>: <what is wrong>" }. */
export async function parseBody<T>(req: Request, check: Check<T>, opts: InputOptions = {}): Promise<JsonRead<T>> {
  const read = await readJson<unknown>(req, opts);
  if (!read.ok) return read;
  const r = check(read.value, "");
  if (!r.ok) return failure("invalid_input", opts, r.error);
  return { ok: true, value: r.value, body: r.value };
}

/** The ?a=b parameters of a request, each through its check; a missing optional one is left out. */
export function readQuery<S extends Record<string, Check<unknown>>>(
  req: Request,
  shape: S,
  opts: Pick<InputOptions, "headers" | "errorBody"> = {},
): { ok: true; value: { [K in keyof S]: S[K] extends Check<infer T> ? T : never } } | InputFailure {
  const params = new URL(req.url).searchParams;
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(shape)) {
    const raw = params.get(k);
    const r = c(raw === null ? undefined : raw, k);
    if (!r.ok) return failure("invalid_input", opts, r.error);
    if (r.value !== undefined) out[k] = r.value;
  }
  return { ok: true, value: out as never };
}
