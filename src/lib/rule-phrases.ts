// A text rule from plain words: "price, discount, €" becomes the pattern the scanner runs. The same builder the Inner chat uses
// (supabase/functions/_shared/inner-chat-rule.ts, held to this copy by src/test/add-rule-dialog.test.tsx): each word or phrase
// escaped, matched as a whole word where it starts or ends with a letter or digit, spaces matching any run of spaces, longest
// first. The scanner matches case-insensitively, so the words are lowercased. Pure.

const MAX_PHRASES = 12;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern for a list of words and phrases. Never empty, never matches empty text. */
export function phrasesPattern(phrases: string[]): string {
  const parts = [...phrases].sort((a, b) => b.length - a.length).map((p) => {
    const body = escape(p).replace(/\s+/g, "\\s+");
    const pre = /^[A-Za-z0-9]/.test(p) ? "(?<![A-Za-z0-9])" : "";
    const post = /[A-Za-z0-9]$/.test(p) ? "(?![A-Za-z0-9])" : "";
    return `${pre}${body}${post}`;
  });
  return `(?:${parts.join("|")})`;
}

/** The words and phrases typed, one per comma or line: cleaned, lowercased, without repeats, at most 12. */
export function phrasesFrom(typed: string): string[] {
  const list = String(typed ?? "").split(/[,\n]/)
    .map((p) => [...p].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase())
    .filter((p) => p.length >= 2 || /^[^A-Za-z0-9\s]$/.test(p));
  return [...new Set(list)].slice(0, MAX_PHRASES);
}
