// The OpenAI image model the Generator (generate-site-images) and the canary (generation-canary) ask for.
//
// gpt-image-1 was retired on the OpenAI API on 2026-10-23 (OpenAI's deprecations page names gpt-image-2 as the replacement), so a
// request for it is refused and every site image falls back to "none". The list is tried in order: a model the API rejects as unknown
// (400 or 404) falls through to the next one. OPENAI_IMAGE_MODEL, when set, goes first, so the next retirement is a setting, not a deploy.
// gpt-image-1.5 is a last fallback only; OpenAI removes it on 2026-12-01.
export const DEFAULT_OPENAI_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5"] as const;

/** The models to try, best first, without duplicates. `configured` is the OPENAI_IMAGE_MODEL setting (may be unset or blank). */
export function openaiImageModels(configured?: string | null): string[] {
  const first = (configured ?? "").trim();
  const all = first ? [first, ...DEFAULT_OPENAI_IMAGE_MODELS] : [...DEFAULT_OPENAI_IMAGE_MODELS];
  return all.filter((m, i) => /^[A-Za-z0-9._-]{1,64}$/.test(m) && all.indexOf(m) === i);
}
