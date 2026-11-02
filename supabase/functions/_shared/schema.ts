// Safe input & output handling, fronts 1 and 3: a very small schema language used for BOTH what people send us and what a model or a
// tool sends back. A schema is a function that takes an unknown value and answers { ok, value } or { ok: false, error }.
//
// Two stances, one vocabulary:
//   strict (default)  too long, wrong type, unknown choice -> a refusal naming the field. For requests from people and other services.
//   clip              too long -> cut; too many items -> the first ones; unknown keys -> dropped. For model output, where a retry is the
//                     only alternative and a long answer is not an attack.
// Strings are always cleaned (cleanText) on the way through, so a NUL byte or a bidi override never reaches the database or a screen.

import { cleanText, clip } from "./clean-text.ts";

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
export type Check<T> = (value: unknown, path?: string) => Checked<T>;
export type Infer<C> = C extends Check<infer T> ? T : never;

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (path: string, why: string): Checked<never> => ({ ok: false, error: path ? `${path}: ${why}` : why });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TextOptions = { min?: number; max: number; multiline?: boolean; clip?: boolean; pattern?: RegExp; trim?: boolean };
/** A string, cleaned. Numbers and booleans are not turned into strings: that hides a client bug. */
export function text(o: TextOptions): Check<string> {
  return (v, path = "") => {
    if (typeof v !== "string") return bad(path, "must be text");
    // anything longer than 4x the cap is refused before the work of cleaning it (the body cap bounds this too)
    if (!o.clip && v.length > o.max * 2 + 16) return bad(path, `must be at most ${o.max} characters`);
    const s = cleanText(v, { multiline: o.multiline, trim: o.trim });
    if (s.length > o.max && !o.clip && [...s].length > o.max) return bad(path, `must be at most ${o.max} characters`);
    const out = o.clip ? clip(s, o.max) : s;
    if ((o.min ?? 0) > 0 && out.length < (o.min ?? 0)) return bad(path, o.min === 1 ? "is required" : `must be at least ${o.min} characters`);
    if (o.pattern && !o.pattern.test(out)) return bad(path, "has an unexpected format");
    return ok(out);
  };
}

export const uuid: Check<string> = (v, path = "") =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? ok(v.trim().toLowerCase()) : bad(path, "must be an id");

export function oneOf<const T extends readonly string[]>(choices: T): Check<T[number]> {
  return (v, path = "") => (typeof v === "string" && (choices as readonly string[]).includes(v) ? ok(v as T[number]) : bad(path, `must be one of ${choices.join(", ")}`));
}

export function int(o: { min?: number; max?: number; clamp?: boolean } = {}): Check<number> {
  return (v, path = "") => {
    const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n)) return bad(path, "must be a whole number");
    const lo = o.min ?? Number.MIN_SAFE_INTEGER, hi = o.max ?? Number.MAX_SAFE_INTEGER;
    if (n < lo || n > hi) return o.clamp ? ok(Math.min(hi, Math.max(lo, n))) : bad(path, `must be between ${lo} and ${hi}`);
    return ok(n);
  };
}

export function num(o: { min?: number; max?: number; clamp?: boolean } = {}): Check<number> {
  return (v, path = "") => {
    const n = typeof v === "number" ? v : NaN;
    if (!Number.isFinite(n)) return bad(path, "must be a number");
    const lo = o.min ?? -Number.MAX_VALUE, hi = o.max ?? Number.MAX_VALUE;
    if (n < lo || n > hi) return o.clamp ? ok(Math.min(hi, Math.max(lo, n))) : bad(path, `must be between ${lo} and ${hi}`);
    return ok(n);
  };
}

export const bool: Check<boolean> = (v, path = "") => (typeof v === "boolean" ? ok(v) : bad(path, "must be true or false"));

export function array<T>(item: Check<T>, o: { max: number; min?: number; clip?: boolean; dropInvalid?: boolean; keep?: "first" | "last" }): Check<T[]> {
  return (v, path = "") => {
    if (!Array.isArray(v)) return bad(path, "must be a list");
    if (v.length > o.max && !o.clip) return bad(path, `must have at most ${o.max} items`);
    const out: T[] = [];
    const fromEnd = o.keep === "last"; // a chat history keeps its newest messages
    for (let n = 0; n < v.length && out.length < o.max; n++) {
      const i = fromEnd ? v.length - 1 - n : n;
      const r = item(v[i], `${path}[${i}]`);
      if (r.ok) { if (fromEnd) out.unshift(r.value); else out.push(r.value); } else if (!o.dropInvalid) return r;
    }
    if (out.length < (o.min ?? 0)) return bad(path, `must have at least ${o.min} items`);
    return ok(out);
  };
}

export function optional<T>(c: Check<T>): Check<T | undefined> {
  return (v, path) => (v === undefined || v === null ? ok(undefined) : c(v, path));
}

/** A value that falls back to a default when it is missing or wrong (for model output, where one bad field should not sink the answer). */
export function withDefault<T>(c: Check<T>, fallback: T): Check<T> {
  return (v, path) => { const r = c(v, path); return r.ok ? r : ok(fallback); };
}

/** An object with known fields. Unknown keys are dropped (default), refused ("reject") or kept as they are ("keep"). */
export function object<S extends Record<string, Check<unknown>>>(shape: S, o: { unknown?: "drop" | "reject" | "keep" } = {}): Check<{ [K in keyof S]: Infer<S[K]> }> {
  return (v, path = "") => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return bad(path, "must be an object");
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(shape)) {
      const r = c(Object.prototype.hasOwnProperty.call(src, k) ? src[k] : undefined, path ? `${path}.${k}` : k);
      if (!r.ok) return r;
      if (r.value !== undefined) out[k] = r.value;
    }
    if (o.unknown === "reject") {
      for (const k of Object.keys(src)) if (!(k in shape)) return bad(path ? `${path}.${k}` : k, "is not allowed");
    } else if (o.unknown === "keep") {
      for (const k of Object.keys(src)) if (!(k in shape) && k !== "__proto__") out[k] = src[k];
    }
    return ok(out as { [K in keyof S]: Infer<S[K]> });
  };
}

/** A map of free keys to one kind of value, with a cap on the number of keys. */
export function record<T>(value: Check<T>, o: { maxKeys: number; key?: TextOptions; clip?: boolean }): Check<Record<string, T>> {
  const keyCheck = text(o.key ?? { max: 80, min: 1, multiline: false });
  return (v, path = "") => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return bad(path, "must be an object");
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > o.maxKeys && !o.clip) return bad(path, `must have at most ${o.maxKeys} entries`);
    const out: Record<string, T> = {};
    for (const [k, raw] of entries.slice(0, o.maxKeys)) {
      if (k === "__proto__") continue;
      const kk = keyCheck(k, path); if (!kk.ok) { if (o.clip) continue; return kk; }
      const r = value(raw, `${path}.${k}`); if (!r.ok) { if (o.clip) continue; return r; }
      out[kk.value] = r.value;
    }
    return ok(out);
  };
}

/** An https address (or a relative one when allowed), no longer than max; anything else is refused. */
export function url(o: { max?: number; relative?: boolean; hosts?: (host: string) => boolean } = {}): Check<string> {
  return (v, path = "") => {
    const s = cleanText(v, { multiline: false, max: (o.max ?? 2048) + 1 });
    if (!s || s.length > (o.max ?? 2048)) return bad(path, "must be a web address");
    if (o.relative && /^\/(?!\/)/.test(s) && !/[\\\u0000-\u001F]/.test(s)) return ok(s);
    try {
      const u = new URL(s);
      if (u.protocol !== "https:" || u.username || u.password) return bad(path, "must be an https address");
      if (o.hosts && !o.hosts(u.hostname.toLowerCase())) return bad(path, "is not an allowed host");
      return ok(u.toString());
    } catch { return bad(path, "must be a web address"); }
  };
}

/** Anything JSON (already bounded in size and depth by the reader); strings inside are cleaned. */
export const anyJson: Check<unknown> = (v) => ok(v);

/** Run a check; on failure an {error} body for a 400. */
export function validate<T>(check: Check<T>, value: unknown): Checked<T> { return check(value, ""); }
