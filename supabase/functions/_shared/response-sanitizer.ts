// "White-labeled 'brain' endpoint" plan, item 6: the single most important
// requirement of this feature, stated explicitly by the account that asked
// for it -- the generated answer must never reveal it came from NazAI,
// mention being an AI, or otherwise break the white-label illusion for the
// integrating company's own end user. Paired with the system prompt itself
// instructing the model never to self-disclose in the first place
// (response-generation.ts) -- defense in depth, the same "prompt it
// correctly AND verify the output" pattern this codebase already uses for
// decision-signing + signature verification.
const SELF_DISCLOSURE_PATTERNS: RegExp[] = [
  /\bnaz[\s-]?ai\b/i,
  /\bas an ai\b/i,
  /\bas an ai language model\b/i,
  /\bas a language model\b/i,
  /\bi(?:'m| am) an ai\b/i,
  /\bi(?:'m| am) (?:a large language model|an llm)\b/i,
  /\b(?:i was|i'm|i am) (?:built|trained|developed|created) by\b/i,
  /\bmy (?:creators|developers|training data)\b/i,
  /\bgoogle('s)? gemini\b/i,
  /\bopenai\b/i,
  /\bchatgpt\b/i,
];

export type SanitizeResult = {
  text: string;
  intervened: boolean;
};

const FALLBACK_ANSWER = "I don't have enough information to answer that.";

/**
 * Pure -- scrubs self-disclosure phrases (case-insensitive, word-boundary
 * matched to avoid false positives) from a final answer. A whole sentence
 * containing a match is dropped rather than left as a grammatically
 * broken fragment; if every sentence gets dropped, falls back to the same
 * honest "don't know" wording the grounding check itself uses.
 */
export function scrubSelfDisclosure(text: string): SanitizeResult {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  let intervened = false;
  const kept = sentences.filter((sentence) => {
    const hit = SELF_DISCLOSURE_PATTERNS.some((re) => re.test(sentence));
    if (hit) intervened = true;
    return !hit;
  });
  const result = kept.join(" ").trim();
  return { text: result || FALLBACK_ANSWER, intervened };
}

/**
 * Pure, JSON-safe -- unlike scrubSelfDisclosure (which edits text
 * sentence-by-sentence, splitting on ".!?", which would silently corrupt
 * a structured JSON answer's syntax), this only ever reports true/false
 * so item 175's structured JSON response mode can discard the WHOLE
 * answer atomically rather than surgically editing a JSON string.
 */
export function containsSelfDisclosure(text: string): boolean {
  return SELF_DISCLOSURE_PATTERNS.some((re) => re.test(text));
}

/**
 * Pure -- balances Markdown code fences and brackets a model can leave
 * unbalanced (e.g. a truncated response), so the integrating company's own
 * UI never renders broken formatting. Never rewrites well-formed Markdown
 * or removes anything -- only appends what's missing, so it can never
 * make an already-valid answer worse.
 */
export function repairMarkdown(text: string): string {
  let result = text;

  const fenceCount = (result.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    result += "\n```";
  }

  const bracketPairs: [RegExp, RegExp, string][] = [
    [/\(/g, /\)/g, ")"],
    [/\[/g, /\]/g, "]"],
    [/\{/g, /\}/g, "}"],
  ];
  for (const [openRe, closeRe, closeChar] of bracketPairs) {
    const openCount = (result.match(openRe) ?? []).length;
    const closeCount = (result.match(closeRe) ?? []).length;
    if (openCount > closeCount) {
      result += closeChar.repeat(openCount - closeCount);
    }
  }

  return result;
}

/** Combines the self-disclosure scrub and the Markdown repair -- the last step before a generated answer leaves the endpoint. */
export function sanitizeResponse(text: string): SanitizeResult {
  const scrubbed = scrubSelfDisclosure(text);
  return { text: repairMarkdown(scrubbed.text), intervened: scrubbed.intervened };
}
