// Safe input & output handling, front 3: a fetch for addresses somebody typed in (a web page to import, a shop address, a tool's
// endpoint). url-safety.ts decides WHERE we may go (https, public addresses, every redirect re-checked); this decides WHAT we accept back:
//   - a time limit (10 s) for the whole exchange, headers and body
//   - a size limit (2 MB), counted as the body streams in: a server that never stops sending costs 2 MB, not the machine
//   - a kind of content: JSON and text by default; images, archives, binaries and anything unlabeled are refused unless asked for
//   - for JSON: depth and size limits, control characters taken out of every string, and an optional schema
// It never throws. { ok: false } says why; { ok: true } carries the status (an HTTP error is a successful exchange, so the caller can still read it).

import { fetchPublicHttps, type UrlSafetyResult } from "./url-safety.ts";
import { jsonDepth, sanitizeJson, type InputLimits } from "./input.ts";
import { scrubString } from "./clean-text.ts";
import type { Check } from "./schema.ts";

export const SAFE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const SAFE_FETCH_TIMEOUT_MS = 10_000;

export type FetchKind = "json" | "text" | "html";
export type SafeFetchOptions = Omit<RequestInit, "signal"> & {
  maxBytes?: number;
  timeoutMs?: number;
  /** What the response may be. Default: json and text (text/plain, markdown, csv, xml); "html" must be asked for. */
  types?: FetchKind[];
  /** Too big: refuse (default) or keep the first maxBytes. */
  onTooLarge?: "fail" | "truncate";
  fetchImpl?: typeof fetch;
  validate?: (url: string) => Promise<UrlSafetyResult>;
  maxRedirects?: number;
};
export type SafeFetchFailure = { ok: false; reason: "blocked_address" | "timeout" | "too_large" | "bad_type" | "network" | "bad_json" | "schema"; message: string; status?: number };
export type SafeText = { ok: true; status: number; httpOk: boolean; contentType: string; text: string; truncated: boolean };

function kindOf(contentType: string): FetchKind | "other" | "none" {
  const t = contentType.toLowerCase().split(";")[0].trim();
  if (!t) return "none";
  if (t === "application/json" || t.endsWith("+json") || t === "text/json") return "json";
  if (t === "text/html" || t === "application/xhtml+xml") return "html";
  if (t.startsWith("text/") || t === "application/xml" || t.endsWith("+xml") || t === "application/x-ndjson") return "text";
  return "other";
}

export async function safeFetchText(url: string, opts: SafeFetchOptions = {}): Promise<SafeText | SafeFetchFailure> {
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const types = opts.types ?? ["json", "text"];
  const { maxBytes: _a, timeoutMs, types: _b, onTooLarge, fetchImpl, validate, maxRedirects, ...init } = opts;
  const signal = AbortSignal.timeout(timeoutMs ?? SAFE_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchPublicHttps(url, { ...init, signal }, { fetchImpl, validate, maxRedirects });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (signal.aborted || (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"))) return { ok: false, reason: "timeout", message: "The address took too long to answer." };
    if (/address not allowed|too many redirects/.test(msg)) return { ok: false, reason: "blocked_address", message: msg };
    return { ok: false, reason: "network", message: "The address could not be reached." };
  }
  const contentType = res.headers.get("content-type") ?? "";
  const kind = kindOf(contentType);
  // an unlabeled body is accepted as text only when text was asked for (many plain files carry no type)
  const allowed = kind === "none" ? types.includes("text")
    : kind === "other" ? false
    : kind === "json" ? types.includes("json") || types.includes("text")
    : types.includes(kind);
  if (!allowed) { await res.body?.cancel().catch(() => undefined); return { ok: false, reason: "bad_type", message: `That address returned ${contentType || "an unlabeled file"}, which is not accepted here.`, status: res.status }; }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes && onTooLarge !== "truncate") { await res.body?.cancel().catch(() => undefined); return { ok: false, reason: "too_large", message: "That address returned too much data.", status: res.status }; }
  const chunks: Uint8Array[] = [];
  let total = 0, truncated = false;
  try {
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.byteLength > maxBytes) {
          if (onTooLarge === "truncate") { chunks.push(value.subarray(0, maxBytes - total)); total = maxBytes; truncated = true; await reader.cancel().catch(() => undefined); break; }
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "too_large", message: "That address returned too much data.", status: res.status };
        }
        chunks.push(value); total += value.byteLength;
      }
    }
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"))) return { ok: false, reason: "timeout", message: "The address took too long to answer." };
    return { ok: false, reason: "network", message: "The address could not be read." };
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return { ok: true, status: res.status, httpOk: res.ok, contentType, text: scrubString(new TextDecoder().decode(all)), truncated };
}

export async function safeFetchJson<T = unknown>(
  url: string,
  opts: SafeFetchOptions & { check?: Check<T>; limits?: InputLimits } = {},
): Promise<{ ok: true; status: number; httpOk: boolean; value: T } | SafeFetchFailure> {
  const { check, limits, ...rest } = opts;
  const r = await safeFetchText(url, { ...rest, types: rest.types ?? ["json", "text"], onTooLarge: "fail" });
  if (!r.ok) return r;
  if (jsonDepth(r.text, limits?.maxDepth ?? 16) > (limits?.maxDepth ?? 16)) return { ok: false, reason: "bad_json", message: "The answer was nested too deeply.", status: r.status };
  let parsed: unknown;
  try { parsed = JSON.parse(r.text); } catch { return { ok: false, reason: "bad_json", message: "The address did not return valid JSON.", status: r.status }; }
  const clean = sanitizeJson(parsed, { maxArray: 20_000, maxKeys: 1000, maxValues: 200_000, maxDepth: 16, ...limits });
  if (!clean) return { ok: false, reason: "bad_json", message: "The answer had too many items.", status: r.status };
  if (!check) return { ok: true, status: r.status, httpOk: r.httpOk, value: clean.value as T };
  const checked = check(clean.value, "");
  if (!checked.ok) return { ok: false, reason: "schema", message: `The answer was not in the expected shape (${checked.error}).`, status: r.status };
  return { ok: true, status: r.status, httpOk: r.httpOk, value: checked.value };
}

/**
 * The JSON body of a response the caller already fetched itself (when it must not follow redirects because it sent a credential):
 * read with a size cap, depth and item limits, strings cleaned. Anything unusable is `fallback`; never throws.
 */
export async function readResponseJson<T = unknown>(res: Response, fallback: T, o: { maxBytes?: number; limits?: InputLimits } = {}): Promise<T> {
  const max = o.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  try {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > max) { await res.body?.cancel().catch(() => undefined); return fallback; }
    const reader = res.body?.getReader();
    if (!reader) return fallback;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel().catch(() => undefined); return fallback; }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    const text = new TextDecoder().decode(all);
    if (jsonDepth(text, o.limits?.maxDepth ?? 16) > (o.limits?.maxDepth ?? 16)) return fallback;
    const clean = sanitizeJson(JSON.parse(text), { maxArray: 20_000, maxKeys: 1000, maxValues: 200_000, maxDepth: 16, ...o.limits });
    return clean ? (clean.value as T) : fallback;
  } catch { return fallback; }
}
