// Safe input & output handling, front 1: one way to clean text that comes from outside (a person, a model, another service).
//
// What it removes, and why:
//   - NUL and other control characters: a NUL byte in a string makes the database refuse the row (a 500 for what is just bad input),
//     and the rest only ever show up as garbage or as a way to hide text.
//   - lone surrogate halves: they are not valid text and break JSON encoding further down the line.
//   - bidirectional override characters (U+202A-202E, U+2066-2069): they let text that reads one way in an editor or a log read another
//     way on screen ("invoice_\u202Efdp.exe"), and have no use in ordinary prompts, names, rules or directives.
//   - the byte-order mark and the Unicode "tag" characters, which are invisible and used to smuggle instructions past a reader.
// It also normalizes to NFC (so the same name typed two ways is one name) and caps the length by characters, never in the middle of a pair.
// Line breaks and tabs are kept (a prompt is allowed to have paragraphs); "\r\n" and a lone "\r" become "\n".

export type CleanOptions = {
  /** Longest result, in characters (code points). Default: no cap. */
  max?: number;
  /** Keep line breaks and tabs. Default true; a name or a title is single-line. */
  multiline?: boolean;
  /** Trim the ends. Default true. */
  trim?: boolean;
};

// C0 controls except \t \n \r, DEL, C1 controls, bidi overrides/isolates, BOM, zero-width no-break, Unicode tags, line/paragraph separators.
// deno-lint-ignore no-control-regex
const NEVER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF\u2028\u2029]|\uDB40[\uDC00-\uDC7F]/g;
// deno-lint-ignore no-control-regex
const NEVER_SINGLE_LINE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF\u2028\u2029]|\uDB40[\uDC00-\uDC7F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** True when the text has something cleanText would take out (cheap pre-check for hot paths). */
export function needsCleaning(s: string): boolean {
  NEVER.lastIndex = 0; LONE_SURROGATE.lastIndex = 0;
  return NEVER.test(s) || LONE_SURROGATE.test(s);
}

/** Cut a string to at most `max` characters without splitting a surrogate pair. */
export function clip(s: string, max: number): string {
  if (max < 0) return "";
  if (s.length <= max) return s; // fast path: UTF-16 length is an upper bound of the character count
  let n = 0, i = 0;
  while (i < s.length && n < max) { const c = s.codePointAt(i)!; i += c > 0xffff ? 2 : 1; n++; }
  return s.slice(0, i);
}

export function cleanText(input: unknown, opts: CleanOptions = {}): string {
  let s = typeof input === "string" ? input : input == null ? "" : String(input);
  const multiline = opts.multiline !== false;
  s = s.replace(LONE_SURROGATE, "");
  s = s.replace(/\r\n?/g, "\n");
  if (!multiline) s = s.replace(/[\t\n\u000B\u000C\u0085\u2028\u2029]+/g, " ");
  s = s.replace(multiline ? NEVER : NEVER_SINGLE_LINE, "");
  try { s = s.normalize("NFC"); } catch { /* ill-formed input already removed above */ }
  if (opts.trim !== false) s = s.trim();
  if (opts.max !== undefined) s = clip(s, opts.max);
  return opts.trim !== false ? s.trim() : s;
}

// deno-lint-ignore no-control-regex
const CONTROL_ONLY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * The light clean for text we only pass along (a file's content, a pasted document): NUL and other control characters and lone
 * surrogate halves go; nothing is normalized, trimmed or cut, so the text is otherwise exactly what was sent.
 */
export function scrubString(s: string): string {
  return s.replace(LONE_SURROGATE, "").replace(CONTROL_ONLY, "");
}

/** A file name that is safe to store and to put in an address: letters, digits, dot, dash, underscore; at most 80 characters. */
export function safeFileName(input: unknown, fallback = "file"): string {
  const base = String(input ?? "").split(/[\\/]/).pop() ?? "";
  let n = cleanText(base, { multiline: false }).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").replace(/_{2,}/g, "_");
  if (n.length > 80) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : "";
    n = n.slice(0, 80 - ext.length) + ext;
  }
  return n || fallback;
}
