// "Own decision-making machine" plan, item 176: deterministic retrieval +
// template synthesis -- the answer IS the matched context entry text,
// never a generative model's paraphrase of it. Nothing here can
// hallucinate: every word in the output traces back to an entry the
// account owner themselves wrote. Replaces generateGroundedAnswer +
// checkGrounding entirely (see control-api/index.ts's /respond handler).
import type { ResponseContextEntry } from "./response-context.ts";

const MAX_SYNTHESIS_ENTRIES = 3;

// A pair of matched entries this similar to EACH OTHER (not to the
// question -- that's response-context.ts's own MIN_CONTEXT_SIMILARITY)
// are treated as saying the same thing, so only the higher-ranked one
// survives. Word-overlap (Jaccard), not embeddings -- this is a cheap,
// pure, synchronous check over text NazAI already has in hand, not
// another vector comparison.
const DEDUPE_OVERLAP_THRESHOLD = 0.7;

/** Pure -- lowercase word-set Jaccard similarity. 1.0 for identical text, 0 for no shared words. */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const wordsB = new Set(b.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (!wordsA.size || !wordsB.size) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return shared / Math.max(wordsA.size, wordsB.size);
}

/** Pure -- decapitalizes only a genuine leading capital letter, so an acronym or a number stays untouched. */
function lowerFirst(text: string): string {
  if (!text.length) return text;
  const first = text[0];
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return text;
  return first.toLowerCase() + text.slice(1);
}

// Replaces both of the old two-fallback-constants scheme
// (GROUNDING_FALLBACK_ANSWER / LEAK_FALLBACK_ANSWER, response-generation.ts
// and response-injection-guard.ts respectively, both deleted with this
// item) -- there's only one "no match" case left now that a deterministic
// engine has replaced the model + fact-check + leak-guard pipeline those
// two constants used to distinguish between.
export const NO_MATCH_FALLBACK_ANSWER = "I don't have enough information to answer that.";

export type SynthesisResult = { text: string; usedEntries: ResponseContextEntry[] };

/**
 * Pure -- `entries` is expected already ranked nearest-first (see
 * findRelevantContext's own ORDER BY) and already above the similarity
 * floor. Returns null when there's nothing to build from -- the caller
 * falls back to the fallback message exactly as it did for an
 * ungrounded LLM answer before this item existed.
 *
 * A single match is returned verbatim. Multiple matches are deduped
 * (near-identical entries collapse to the highest-ranked one) and
 * stitched together with light connective phrasing, capped at
 * MAX_SYNTHESIS_ENTRIES -- covers a question that genuinely spans two
 * configured facts without requiring the account owner to author
 * templates or combined entries by hand.
 */
export function synthesizeAnswer(entries: ResponseContextEntry[]): SynthesisResult | null {
  if (!entries.length) return null;

  const deduped: ResponseContextEntry[] = [];
  for (const entry of entries) {
    const isDuplicate = deduped.some((d) => wordOverlap(d.entry_text, entry.entry_text) >= DEDUPE_OVERLAP_THRESHOLD);
    if (isDuplicate) continue;
    deduped.push(entry);
    if (deduped.length >= MAX_SYNTHESIS_ENTRIES) break;
  }

  const [first, ...rest] = deduped;
  if (!rest.length) return { text: first.entry_text, usedEntries: deduped };

  const text = [first.entry_text, ...rest.map((e) => `Additionally, ${lowerFirst(e.entry_text)}`)].join(" ");
  return { text, usedEntries: deduped };
}
