// Image-relevance quality loop (2026-10-09): closes the one failure mode
// named directly -- a request for an aesthetic cafe in Vienna produced
// space-sky/desert/beach imagery. Root cause: WebsitePreview.tsx's
// photoUrl() resolves any media_style:"photo" request via Lorem Picsum
// (https://picsum.photos/seed/<hash-of-prompt-text>/w/h) -- a fixed,
// uncategorized pool of ~1000 stock photos selected by a deterministic
// hash of the PROMPT STRING, with zero semantic relationship between that
// text and the photo it returns. SCHEMA_DOC's own Section D explicitly
// steers the Generator toward "photo" for exactly the businesses most
// likely to trigger this (food menus, portrait-led hospitality -- a cafe
// is both), and the deterministic fallback manifest does the same
// unconditionally (`media_style: isFood ? "photo" : "pattern"`).
//
// This is the one deterministic rule that closes the loop everywhere a
// "photo" request can originate, whether from the model, the fallback
// template, or a future bug: media_style:"photo" is permitted ONLY when
// asset_url is present AND (no verified set was given, OR that exact URL
// is in it). Anything else is force-rewritten to "illustration" -- the
// existing bespoke, palette-matched SVG signature every non-photo style
// already uses, which has no literal subject matter and therefore cannot
// be topically wrong. No new image source, no new component: this is the
// same "redact/repair, never just flag" posture repair-engine.ts and
// applySafetyGate already apply to safety-rule matches, extended to one
// more field.
export type ImageRelevanceNote = { kind: "forced_illustration" | "stripped_unverified_url"; path: string };

export type ImageRelevanceResult<P> = {
  pages: P[];
  notes: string[];
  repaired: boolean;
};

type SectionLike = { content?: Record<string, unknown> | null; [k: string]: unknown };
type PageLike = { slug?: string; sections?: SectionLike[]; [k: string]: unknown };

function isVerified(url: string, verifiedAssetUrls?: Set<string>): boolean {
  return !verifiedAssetUrls || verifiedAssetUrls.has(url);
}

/**
 * Every asset_url actually present across a pages tree (top-level content
 * and items[] alike). Used by the refine/chat-edit path to fold a
 * website's CURRENT, already-persisted (and therefore already-verified at
 * an earlier generation) images into this request's verified set --
 * REFINE_DOC explicitly tells the model to echo untouched sections back
 * verbatim ("do not regenerate untouched parts"), so an existing real
 * photo on a section the user isn't even editing must not be treated as a
 * fresh hallucination just because it wasn't re-attached to THIS request.
 */
export function collectAssetUrls(pages: PageLike[]): Set<string> {
  const urls = new Set<string>();
  for (const page of pages) {
    for (const section of Array.isArray(page.sections) ? page.sections : []) {
      const content = (section.content ?? {}) as Record<string, unknown>;
      if (typeof content.asset_url === "string" && content.asset_url) urls.add(content.asset_url);
      if (Array.isArray(content.items)) {
        for (const item of content.items as Record<string, unknown>[]) {
          if (item && typeof item.asset_url === "string" && item.asset_url) urls.add(item.asset_url);
        }
      }
    }
  }
  return urls;
}

/**
 * Enforces image relevance across one section's content object (mutates a
 * shallow copy, never the input). Returns the possibly-rewritten content
 * plus any notes raised.
 *
 * Two independent rules, applied in this order:
 * 1. A top-level asset_url that isn't backed by a verified attachment
 *    (when a verified set was supplied) is a hallucinated URL -- stripped
 *    unconditionally, regardless of media_style.
 * 2. media_style:"photo" with no asset_url LEFT after rule 1 falls through
 *    to Picsum's blind random selection -- forced to "illustration".
 *
 * items[] (gallery) entries have no media_style field of their own (see
 * SCHEMA_DOC) -- only rule 1 (URL provenance) applies to them. The
 * renderer itself (WebsitePreview.tsx) is what decides whether a missing
 * asset_url on a gallery item falls through to Picsum or to the bespoke
 * signature; this function's job ends at making sure asset_url is never a
 * hallucinated value.
 */
function enforceSectionContent(
  content: Record<string, unknown>,
  pathPrefix: string,
  verifiedAssetUrls: Set<string> | undefined,
  notes: ImageRelevanceNote[],
): { content: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const out: Record<string, unknown> = { ...content };

  const topUrl = typeof out.asset_url === "string" ? out.asset_url : "";
  if (topUrl && !isVerified(topUrl, verifiedAssetUrls)) {
    out.asset_url = undefined;
    changed = true;
    notes.push({ kind: "stripped_unverified_url", path: pathPrefix });
  }

  const remainingUrl = typeof out.asset_url === "string" ? out.asset_url : "";
  if (out.media_style === "photo" && !remainingUrl) {
    out.media_style = "illustration";
    changed = true;
    notes.push({ kind: "forced_illustration", path: pathPrefix });
  }

  if (Array.isArray(out.items)) {
    let itemsChanged = false;
    const items = (out.items as Record<string, unknown>[]).map((item, i) => {
      if (!item || typeof item !== "object") return item;
      const itemUrl = typeof item.asset_url === "string" ? item.asset_url : "";
      if (itemUrl && !isVerified(itemUrl, verifiedAssetUrls)) {
        itemsChanged = true;
        notes.push({ kind: "stripped_unverified_url", path: `${pathPrefix}.items[${i}]` });
        return { ...item, asset_url: undefined };
      }
      return item;
    });
    if (itemsChanged) {
      out.items = items;
      changed = true;
    }
  }

  return { content: out, changed };
}

/**
 * Applies enforceSectionContent across every section of every page.
 * `verifiedAssetUrls` should be the set of asset_url/url values from this
 * request's REAL attachments (compile-website-manifest's own
 * visualAttachments) -- omit it entirely for a context with no such list
 * (final-assembly-check.ts's recurring re-validation), which narrows
 * enforcement to "no dangling photo with nothing backing it at all"
 * without ever second-guessing an asset_url that was already verified and
 * persisted at generation time.
 */
export function enforceImageRelevance<P extends PageLike>(
  pages: P[],
  verifiedAssetUrls?: Set<string>,
): ImageRelevanceResult<P> {
  const rawNotes: ImageRelevanceNote[] = [];
  let repaired = false;

  const outPages = pages.map((page) => {
    const sections = Array.isArray(page.sections) ? page.sections : [];
    let pageChanged = false;
    const outSections = sections.map((section, i) => {
      const content = (section.content ?? {}) as Record<string, unknown>;
      const { content: nextContent, changed } = enforceSectionContent(
        content,
        `${page.slug ?? "page"}.sections[${i}]`,
        verifiedAssetUrls,
        rawNotes,
      );
      if (!changed) return section;
      pageChanged = true;
      return { ...section, content: nextContent };
    });
    if (!pageChanged) return page;
    repaired = true;
    return { ...page, sections: outSections };
  });

  const notes = rawNotes.map((n) =>
    n.kind === "forced_illustration"
      ? `Image relevance: "${n.path}" requested a photo with no verified real image backing it -- forced to the bespoke illustration style instead of an unrelated stock photo.`
      : `Image relevance: "${n.path}" referenced an image URL that wasn't among this request's real attachments -- removed as unverifiable.`,
  );

  return { pages: outPages, notes, repaired };
}
