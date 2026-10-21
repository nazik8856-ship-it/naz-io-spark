// Outer Control: which connected tools a person names in a request ("ask ChatGPT and Claude …").
// One copy is shared by the page and the edge functions so they can not disagree:
// src/lib/outer-control-mentions.ts and supabase/functions/_shared/outer-control-mentions.ts. A test fails when they differ.
// Matching is whole-word and case-insensitive. A tool is found by its own name (without a bracketed part, e.g. "ChatGPT" for
// "ChatGPT (OpenAI)") or by a well-known product word that belongs to it (its name, model or endpoint says which product it is).

export type MentionTool = { id: string; name: string; model?: string | null; endpoint_url?: string | null };
export type Mention = { tool: MentionTool; word: string; index: number };
export type Ambiguous = { word: string; index: number; tools: MentionTool[] };
export type NotConnected = { brand: string; word: string; index: number };
export type Mentions = { mentions: Mention[]; ambiguous: Ambiguous[]; notConnected: NotConnected[] };

/** Well-known AI products and the words people use for them. */
export const BRANDS: { brand: string; words: string[]; marks: string[] }[] = [
  { brand: "ChatGPT", words: ["chatgpt", "chat gpt", "gpt", "openai"], marks: ["chatgpt", "gpt", "openai"] },
  { brand: "Claude", words: ["claude", "anthropic"], marks: ["claude", "anthropic"] },
  { brand: "Gemini", words: ["gemini"], marks: ["gemini", "generativelanguage", "googleapis"] },
  { brand: "Grok", words: ["grok", "xai"], marks: ["grok", "xai", "x.ai"] },
  { brand: "Mistral", words: ["mistral"], marks: ["mistral"] },
  { brand: "Llama", words: ["llama"], marks: ["llama"] },
  { brand: "DeepSeek", words: ["deepseek"], marks: ["deepseek"] },
  { brand: "Perplexity", words: ["perplexity"], marks: ["perplexity", "pplx"] },
  { brand: "Copilot", words: ["copilot"], marks: ["copilot"] },
];

const INTERNAL = "nazai-internal://";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

/** Every place a whole word or phrase appears in the text (lower-cased). */
function findAll(text: string, phrase: string): number[] {
  const out: number[] = [];
  if (!phrase) return out;
  const re = new RegExp(`(^|[^a-z0-9])(${esc(phrase).replace(/ /g, "\\s+")})(?![a-z0-9])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index + m[1].length);
    re.lastIndex = m.index + m[1].length + m[2].length;
  }
  return out;
}

/** The products a tool belongs to, read from its name, model and endpoint. */
export function brandsOf(t: MentionTool): Set<string> {
  const hay = `${t.name} ${t.model ?? ""} ${t.endpoint_url ?? ""}`.toLowerCase();
  const out = new Set<string>();
  for (const b of BRANDS) if (b.marks.some((m) => hay.includes(m))) out.add(b.brand);
  return out;
}

type Hit = { index: number; end: number; word: string; tools: MentionTool[]; brand: string | null; literal: boolean };

/**
 * The connected tools named in the text, in the order they are first named; words that fit more than one tool; and
 * well-known products that are named but not connected. Internal tools (the report writer) are never matched.
 */
export function detectMentions(text: string, tools: MentionTool[]): Mentions {
  const lower = (text ?? "").toLowerCase();
  const usable = tools.filter((t) => !(t.endpoint_url ?? "").startsWith(INTERNAL));
  const hits: Hit[] = [];
  // 1. A tool's own name.
  const byName = new Map<string, MentionTool[]>();
  for (const t of usable) {
    const n = clean(t.name);
    if (n.length < 3) continue;
    byName.set(n, [...(byName.get(n) ?? []), t]);
  }
  for (const [n, ts] of byName) for (const i of findAll(lower, n)) hits.push({ index: i, end: i + n.length, word: n, tools: ts, brand: null, literal: true });
  // 2. A product word.
  const brands = new Map(usable.map((t) => [t.id, brandsOf(t)]));
  for (const b of BRANDS) {
    const ts = usable.filter((t) => brands.get(t.id)?.has(b.brand));
    for (const w of b.words) for (const i of findAll(lower, w)) hits.push({ index: i, end: i + w.length, word: w, tools: ts, brand: b.brand, literal: false });
  }
  // A name wins over a product word at the same place; a longer word wins over a shorter one inside it.
  hits.sort((a, b) => a.index - b.index || Number(b.literal) - Number(a.literal) || (b.end - b.index) - (a.end - a.index));
  const kept: Hit[] = [];
  for (const h of hits) if (!kept.some((k) => h.index < k.end && k.index < h.end)) kept.push(h);

  const mentions: Mention[] = [];
  const named = new Set<string>();
  const ambiguous: Ambiguous[] = [];
  const notConnected: NotConnected[] = [];
  for (const h of kept) {
    if (h.tools.length === 1) {
      if (!named.has(h.tools[0].id)) { named.add(h.tools[0].id); mentions.push({ tool: h.tools[0], word: h.word, index: h.index }); }
    } else if (h.tools.length > 1) {
      ambiguous.push({ word: h.word, index: h.index, tools: h.tools });
    } else if (h.brand && !notConnected.some((n) => n.brand === h.brand)) {
      notConnected.push({ brand: h.brand, word: h.word, index: h.index });
    }
  }
  // A word that fits several tools is settled when one of them is named elsewhere.
  return { mentions, ambiguous: ambiguous.filter((a) => !a.tools.some((t) => named.has(t.id))), notConnected };
}

/**
 * The named tools that are not among the chosen ones (in the order named), and the unsettled words, for the guard before a
 * session or Task starts. Empty when what was chosen covers what was named.
 */
export function namedButNotChosen(found: Mentions, chosenIds: string[]): { missing: MentionTool[]; ambiguous: Ambiguous[] } {
  const chosen = new Set(chosenIds);
  return {
    missing: found.mentions.map((m) => m.tool).filter((t) => !chosen.has(t.id)),
    ambiguous: found.ambiguous.filter((a) => !a.tools.some((t) => chosen.has(t.id))),
  };
}
