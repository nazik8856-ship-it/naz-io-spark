// Relevance Guard, image side (2026-10-12). A generated image can still be the
// wrong picture: the model's own image_prompt may describe an unrelated scene
// (the "aesthetic cafe in Vienna -> desert and beach photos" failure), or the
// image model may ignore the subject. Two layers, both visible to the owner:
//   1. a deterministic pre-check: an image_prompt that shares no meaningful
//      word with the business (name, tagline, brief) is rewritten BEFORE any
//      image is paid for;
//   2. a vision check after generation: a cheap model is shown the finished
//      image and asked whether it matches the subject; a mismatch is
//      regenerated once with the reason fed back, and if it still does not
//      match the image is dropped (the decorative illustration stays).
// Everything here is pure; the model calls live in generate-site-images.

import { GUARD_PREFIX } from "./generation-quality.ts";

export const IMAGE_NOTE_PREFIX = `${GUARD_PREFIX}Image — `;

// Words that describe photography rather than a business; ignored when judging
// whether a prompt is "about" the business.
const STOP = new Set([
  "photo", "photograph", "photography", "image", "picture", "scene", "shot", "view", "aerial", "close", "closeup", "wide",
  "natural", "lighting", "light", "golden", "hour", "warm", "soft", "modern", "clean", "bright", "background", "professional",
  "people", "person", "team", "space", "with", "from", "that", "this", "their", "your", "have", "been", "into", "over", "under",
  "high", "quality", "realistic", "detailed", "style", "mood", "palette", "tones", "muted", "dark", "highlights", "shadows",
  "interior", "exterior", "table", "wooden", "inside", "outside", "front", "behind", "against", "through", "around",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    let w = m[0];
    if (w.length < 4 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

export type BusinessContext = { siteName: string; tagline?: string; brief?: string };

/**
 * True when the subject shares at least one meaningful word with the business,
 * or has no meaningful words at all (nothing to judge). Derived subjects always
 * start with the site name, so only an explicit, unrelated image_prompt fails.
 */
export function subjectMatchesBusiness(subject: string, ctx: BusinessContext): boolean {
  const subj = tokens(subject);
  if (!subj.size) return true;
  const biz = tokens(`${ctx.siteName} ${ctx.tagline ?? ""} ${ctx.brief ?? ""}`);
  if (!biz.size) return true;
  for (const t of subj) if (biz.has(t)) return true;
  return false;
}

const clean = (s: string) => s.replace(/~/g, "").replace(/\s+/g, " ").trim();

/** A subject that is certainly about this business: its name plus what the owner said it does. */
export function businessSubject(ctx: BusinessContext, kindLabel: string): string {
  const what = clean(ctx.tagline ?? "") || clean((ctx.brief ?? "").split(/[.\n]/)[0] ?? "").slice(0, 140);
  return [clean(ctx.siteName), kindLabel, what].filter(Boolean).join(" -- ");
}

export function buildVerifyPrompt(subject: string, ctx: BusinessContext): string {
  const brief = clean((ctx.brief ?? "").slice(0, 400));
  return [
    `You are checking a generated photo for the website of "${clean(ctx.siteName)}"${ctx.tagline ? ` (${clean(ctx.tagline)})` : ""}.`,
    brief ? `The owner described the business as: ${brief}` : "",
    `The image is meant to show: ${clean(subject)}.`,
    `Does the image plausibly show that subject, in a way that fits this business and would not look wrong on its website? Visible text, logos, collages, or a clearly different kind of scene (for example a beach or desert for a café) mean NO.`,
    `Answer with JSON only: {"match": true|false, "reason": "<one short sentence naming what the image actually shows>"}`,
  ].filter(Boolean).join(" ");
}

export type VerifyResult = { match: boolean | null; reason: string };

/** Parses the vision model's reply. null = could not tell (the caller fails open). */
export function parseVerifyResponse(json: unknown): VerifyResult {
  // deno-lint-ignore no-explicit-any
  const content = (json as any)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { match: null, reason: "" };
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return { match: null, reason: "" };
  try {
    const o = JSON.parse(m[0]) as { match?: unknown; reason?: unknown };
    const reason = typeof o.reason === "string" ? o.reason.replace(/\s+/g, " ").trim().slice(0, 140) : "";
    if (o.match === true) return { match: true, reason };
    if (o.match === false) return { match: false, reason };
    return { match: null, reason };
  } catch {
    return { match: null, reason: "" };
  }
}

/** The retry prompt: the original, plus what was wrong with the first attempt. */
export function reinforcePrompt(prompt: string, subject: string, reason: string): string {
  return `${prompt} The previous attempt was rejected${reason ? ` because it showed: ${reason}` : ""}. This time the image must clearly and literally show: ${clean(subject)}. Do not show anything unrelated to it.`;
}

// ---- Owner-facing notes -----------------------------------------------------------

export type GuardTally = {
  promptsRewritten: number;
  replaced: number;
  dropped: number;
  /** A few concrete examples ("hero: showed a beach") so the note is specific. */
  examples: string[];
};

export const emptyTally = (): GuardTally => ({ promptsRewritten: 0, replaced: 0, dropped: 0, examples: [] });

const KIND_LABEL: Record<string, string> = { hero: "hero", about: "about", "feature-split": "feature", "gallery-item": "gallery", "services-item": "service" };
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

export function describeGuardTally(t: GuardTally, siteName: string): string[] {
  const notes: string[] = [];
  const eg = t.examples.slice(0, 3).join("; ");
  if (t.promptsRewritten) {
    notes.push(`${IMAGE_NOTE_PREFIX}Rewrote ${t.promptsRewritten} image description${t.promptsRewritten === 1 ? "" : "s"} that had nothing to do with ${siteName} before generating pictures from ${t.promptsRewritten === 1 ? "it" : "them"}.`);
  }
  if (t.replaced) {
    notes.push(`${IMAGE_NOTE_PREFIX}Replaced ${t.replaced} generated image${t.replaced === 1 ? "" : "s"} that didn't match ${siteName} with a matching one${eg ? ` (${eg})` : ""}.`);
  }
  if (t.dropped) {
    notes.push(`${IMAGE_NOTE_PREFIX}${t.dropped} image${t.dropped === 1 ? "" : "s"} still didn't match ${siteName} after a retry, so the decorative illustration is kept there${!t.replaced && eg ? ` (${eg})` : ""}.`);
  }
  return notes;
}

/** Image-guard notes from a previous run are replaced, not accumulated. */
export function withoutImageGuardNotes(notes: unknown[]): unknown[] {
  return notes.filter((n) => !(typeof n === "string" && n.startsWith(IMAGE_NOTE_PREFIX)));
}
