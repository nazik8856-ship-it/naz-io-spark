// Connecting an AI tool, in the browser: the same address rules as the server (supabase/functions/_shared/outer-control-tool-url.ts,
// held to it by src/test/connector-models.test.ts) and the choice of model. NazAI stores the provider's base address
// (https://api.groq.com/openai/v1) and adds /chat/completions (Anthropic-style: /messages) when it calls the tool. Pure.

const CALL_PATH: Record<string, string> = { openai_chat: "/chat/completions", anthropic_messages: "/messages" };
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

/** Whether two stored addresses are the same tool (an old full address and the new base count as one). */
export const sameToolAddress = (a: string, b: string, format: string) => toolBaseUrl(a, format) === toolBaseUrl(b, format);

// ---- The model list -------------------------------------------------------------------------------------------------------

/** The models offered: NazAI's suggestions the key can use first, then the rest of what the provider listed; just the suggestions
 *  while no list was read. */
export function modelOptions(suggested: string[], live: string[] | null): string[] {
  if (!live || live.length === 0) return [...suggested];
  const have = new Set(live);
  return [...suggested.filter((m) => have.has(m)), ...live.filter((m) => !suggested.includes(m))];
}

/** The model to select: the current choice while the key can use it, else the first suggestion it can use, else the first listed. */
export function pickModel(current: string, suggested: string[], live: string[] | null): string {
  if (!live || live.length === 0) return current || suggested[0] || "";
  if (current && live.includes(current)) return current;
  return suggested.find((m) => live.includes(m)) ?? live[0];
}
