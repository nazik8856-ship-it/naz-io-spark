// "Own decision-making machine" plan, integration round: a response rule
// (item 177) and a context entry (item 154) can silently state different
// facts about the same thing -- a rule saying "refunds take 5 days" and a
// context entry saying "refunds take 2 weeks" can both exist for the same
// key with nothing telling the account owner they disagree. The rule
// always wins in /respond's own pipeline, so the drift stays invisible
// until a customer notices the two don't match.
//
// This deliberately does NOT try to verify the two actually state
// different facts -- that would mean judging whether "5 days" and "2
// weeks" conflict, which needs real language understanding, i.e. exactly
// the generative-model call item 176 removed from this feature entirely
// on purpose (see control-api/index.ts's own header comment: "no
// generative model anywhere in this path... nothing here can
// hallucinate"). Building a real contradiction-checker would reintroduce
// that dependency for one narrow feature. What this checks instead is
// honest about its own limits: whether a rule's trigger phrase appears
// verbatim inside a context entry's text (or vice versa) -- a cheap,
// deterministic, zero-cost signal that the two are clearly about the same
// specific topic, worth a human glance, not a verified conflict.
import { normalize } from "./response-rules.ts";

export type OverlapCandidate = { id: string; text: string };
export type OverlapWarning = { id: string; excerpt: string };

const MAX_OVERLAP_EXCERPT_CHARS = 200;

// Same floor ControlApiKeys.tsx's own UI hint already warns on for a
// "contains_phrase" rule trigger ("Short 'Contains' triggers can match
// unrelated messages"), applied here for the identical reason: a trigger
// phrase below this length (a single common word, "is", "ok") would
// verbatim-match huge swaths of unrelated text, turning this advisory
// into noise that buries the genuine overlaps it exists to surface.
// Below this floor, silently reporting no overlap is more honest than
// reporting dozens of meaningless ones.
export const MIN_OVERLAP_PHRASE_LENGTH = 4;

/** Pure -- exported so api-keys/index.ts can excerpt a rule's answer_text for display when reporting an overlap in the context-entry direction (see its own call site for why: the entry's own text isn't useful to echo back to whoever just typed it). */
export function excerptOf(text: string): string {
  return text.length > MAX_OVERLAP_EXCERPT_CHARS ? `${text.slice(0, MAX_OVERLAP_EXCERPT_CHARS)}…` : text;
}

/**
 * Pure -- every candidate whose own text contains `phrase` verbatim
 * (after normalizing case/whitespace on both sides). Used in both
 * directions by api-keys/index.ts: checking a new rule's trigger_phrase
 * against existing context entries' entry_text, and checking a new
 * context entry's entry_text against existing rules' trigger_phrase --
 * same building block either way, just which side is "phrase" and which
 * is "candidates" swaps.
 */
export function findOverlappingCandidates(phrase: string, candidates: OverlapCandidate[]): OverlapWarning[] {
  const normalizedPhrase = normalize(phrase);
  if (normalizedPhrase.length < MIN_OVERLAP_PHRASE_LENGTH) return [];
  const warnings: OverlapWarning[] = [];
  for (const candidate of candidates) {
    if (normalize(candidate.text).includes(normalizedPhrase)) {
      warnings.push({ id: candidate.id, excerpt: excerptOf(candidate.text) });
    }
  }
  return warnings;
}
