// Quality gate for CHAT EDITS to an existing generated website.
//
// A first generation runs the whole professional floor; a chat edit used to
// run none of it, so quality eroded with every edit. This module is the pure
// half of the fix. Its guiding rule: an edit is the user's explicit decision,
// so the gate may only
//   (a) mechanically repair what is objectively broken (colour contrast,
//       invalid colours, unsupported variants) and strip testimonials /
//       statistics that THIS edit invented, and
//   (b) report problems the edit INTRODUCED -- never problems the site already
//       had, and never by forcing the site back to a template the user just
//       changed on purpose.
// Everything is deterministic and side-effect free; the model-backed revision
// for Strict Mode lives in compile-website-manifest, which decides whether to
// accept it.
import { findStrictIssues, repairVisual, VISUAL_FIX_PREFIX, GUARD_PREFIX } from "./generation-quality.ts";
import { findStructuralIssues, repairUngroundedClaims, type ManifestLike } from "./generation-floor.ts";
import type { StructureId } from "./generation-templates.ts";
import { collectImageSlots, type ImageSlot } from "./site-images.ts";

/** Digits are stripped so "currently has 2" vs "currently has 3" is the same issue. */
export function issueKey(issue: string): string {
  return issue.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Issues present in `after` that were not already present in `before`. */
export function introducedIssues(before: string[], after: string[]): string[] {
  const had = new Set(before.map(issueKey));
  return after.filter((i) => !had.has(issueKey(i)));
}

const slotKey = (s: ImageSlot) => `${s.pageSlug}#${s.sectionIndex}#${s.itemIndex ?? "-"}#${s.kind}`;

/**
 * How many image slots exist after the edit that did not exist (as unfilled
 * slots) before it -- i.e. what this edit added that needs a picture. Existing
 * unfilled slots do not count: an edit that touches only copy must not start
 * (and pay for) an image run.
 */
export function newImageSlotCount(
  before: ManifestLike["pages"],
  after: ManifestLike["pages"],
  ctx: { siteName: string; layout?: string },
): number {
  const had = new Set(collectImageSlots(before, ctx).map(slotKey));
  return collectImageSlots(after, ctx).filter((s) => !had.has(slotKey(s))).length;
}

export type EditGateInput<M extends ManifestLike> = {
  before: M;
  after: M;
  /** The site's original brief plus the edit request: facts in either are grounded. */
  brief: string;
  prompt: string;
  strict: boolean;
  template?: StructureId | null;
};

export type EditGateResult<M extends ManifestLike> = {
  manifest: M;
  /** Notes to show the owner (already prefixed). */
  notes: string[];
  /** Strict-mode problems this edit introduced; the caller may try one model revision. */
  strictIssues: string[];
  /** Structure problems this edit introduced; advisory only. */
  structureIssues: string[];
  visualFixes: number;
  claimsRemoved: number;
};

export function gateEdit<M extends ManifestLike>(input: EditGateInput<M>): EditGateResult<M> {
  const { before, brief, prompt, strict } = input;
  const template = input.template ?? undefined;
  const notes: string[] = [];

  const visual = repairVisual(input.after as never) as { manifest: M; notes: string[] };
  let manifest = visual.manifest;
  visual.notes.forEach((n) => notes.push(VISUAL_FIX_PREFIX + n));

  // Everything already on the site counts as grounded: only claims this edit
  // introduced and nobody supplied are removed.
  const grounding = `${brief}\n${prompt}\n${JSON.stringify(before.pages)}`;
  const claims = repairUngroundedClaims(manifest, grounding);
  manifest = claims.manifest;
  claims.notes.forEach((n) => notes.push(GUARD_PREFIX + n));

  const strictIssues = strict
    ? introducedIssues(findStrictIssues(before as never, brief), findStrictIssues(manifest as never, `${brief}\n${prompt}`))
    : [];
  const structureIssues = introducedIssues(findStructuralIssues(before, template), findStructuralIssues(manifest, template));

  return { manifest, notes, strictIssues, structureIssues, visualFixes: visual.notes.length, claimsRemoved: claims.removed.length };
}
