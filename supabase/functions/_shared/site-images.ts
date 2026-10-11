// Custom image generation for generated websites (2026-10-11). The renderer
// had no source of real pictures: an earlier fix (image-relevance.ts) removed
// irrelevant random stock photos by forcing every "photo" to an abstract
// gradient, which is why generated sites showed coloured blobs or nothing.
// This module is the pure half of the replacement: decide WHICH slots of a
// manifest should get a generated image, build the prompt for each, write a
// finished image back into a page's sections safely, and parse the two
// providers' image responses. All I/O (model call, storage upload, DB writes)
// lives in the generate-site-images edge function.
//
// Slots that already carry an asset_url are never touched: that URL is either
// an image the user attached (verified by compile-website-manifest) or one we
// generated earlier, and user-supplied images always win.

type SectionLike = { type: string; variant?: string; content?: Record<string, unknown> | null };
type PageLike = { slug: string; sections: SectionLike[] };

export const MAX_IMAGES_PER_SITE = 8;

// Pages that must never get generated pictures: the auto-injected legal pages
// carry an "about" section, which a live run happily illustrated with two
// pointless photos.
const NO_IMAGE_PAGE_SLUGS = new Set([
  "contact", "privacy-policy", "privacy", "privacy-notice",
  "terms", "terms-of-service", "terms-conditions", "terms-and-conditions", "tos",
]);

export type SlotKind = "hero" | "about" | "feature-split" | "gallery-item" | "services-item";
export type ImageSlot = {
  pageSlug: string;
  sectionIndex: number;
  /** null = the section itself; a number = items[itemIndex] */
  itemIndex: number | null;
  kind: SlotKind;
  /** Subject description; written back to content.image_prompt when it was missing. */
  subject: string;
  aspect: "wide" | "square";
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const clean = (s: string): string => s.replace(/~/g, "").replace(/\s+/g, " ").trim();

/**
 * Mirrors WebsitePreview.tsx's own Hero variant selection: only split-image
 * and full-bleed heroes draw an image at all. Duplicated (not imported)
 * because the renderer lives outside the edge-functions root -- the same
 * reasoning src/lib/agent-policy.ts documents.
 */
export function heroUsesImage(variant: string | undefined, layout: string | undefined): boolean {
  const v = variant || (layout === "split" ? "split-image" : layout === "editorial" ? "editorial-lede" : layout === "brutalist" ? "asymmetric-mark" : layout === "minimal-luxury" ? "minimal-luxury" : "centered");
  return v === "split-image" || v === "full-bleed";
}

function sectionSubject(section: SectionLike, siteName: string): string {
  const c = (section.content ?? {}) as Record<string, unknown>;
  const given = str(c.image_prompt);
  if (given) return clean(given);
  const text = clean(str(c.headline) || str(c.heading));
  const bullet = Array.isArray(c.bullets) && typeof c.bullets[0] === "string" ? clean(c.bullets[0] as string) : "";
  return [siteName, text, bullet].filter(Boolean).join(" -- ");
}

type Tiered = ImageSlot & { tier: number; order: number };

/**
 * Chooses up to `max` image slots, most visible first: home hero, home
 * about/feature-split, other pages' hero/about/feature-split, gallery items,
 * then zigzag services items. Skips any slot that already has an asset_url
 * and any hero variant that never draws an image.
 */
export function collectImageSlots(
  pages: PageLike[],
  ctx: { siteName: string; layout?: string },
  max: number = MAX_IMAGES_PER_SITE,
): ImageSlot[] {
  const found: Tiered[] = [];
  let order = 0;
  pages.forEach((page, pi) => {
    if (NO_IMAGE_PAGE_SLUGS.has(page.slug.toLowerCase())) return;
    page.sections.forEach((section, si) => {
      const c = (section.content ?? {}) as Record<string, unknown>;
      const isHome = pi === 0;
      if (section.type === "hero" || section.type === "about" || section.type === "feature-split") {
        if (str(c.asset_url)) return;
        if (section.type === "hero" && !heroUsesImage(section.variant, ctx.layout)) return;
        found.push({
          pageSlug: page.slug, sectionIndex: si, itemIndex: null, kind: section.type,
          subject: sectionSubject(section, ctx.siteName),
          aspect: section.type === "hero" ? "wide" : "square",
          tier: section.type === "hero" ? (isHome ? 0 : 2) : (isHome ? 1 : 2), order: order++,
        });
        return;
      }
      const items = Array.isArray(c.items) ? (c.items as Record<string, unknown>[]) : [];
      if (section.type === "gallery") {
        items.forEach((item, ii) => {
          if (!item || typeof item !== "object" || str(item.asset_url)) return;
          const subject = clean(str(item.image_prompt) || str(item.caption));
          if (!subject) return;
          found.push({ pageSlug: page.slug, sectionIndex: si, itemIndex: ii, kind: "gallery-item", subject: str(item.image_prompt) ? subject : `${ctx.siteName} -- ${subject}`, aspect: "square", tier: 3, order: order++ });
        });
      } else if (section.type === "services" && section.variant === "zigzag") {
        items.forEach((item, ii) => {
          if (!item || typeof item !== "object" || str(item.asset_url)) return;
          const subject = clean(str(item.image_prompt) || str(item.title));
          if (!subject) return;
          found.push({ pageSlug: page.slug, sectionIndex: si, itemIndex: ii, kind: "services-item", subject, aspect: "wide", tier: 4, order: order++ });
        });
      }
    });
  });
  return found
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
    .slice(0, Math.max(0, max))
    .map(({ tier: _t, order: _o, ...slot }) => slot);
}

/**
 * The prompt sent to the image model. `brief` is the owner's own description
 * of the business (websites.prompt): whatever context the user gave about how
 * things look is passed through so the picture stays faithful to it.
 */
export function buildImagePrompt(
  slot: ImageSlot,
  ctx: { siteName: string; tagline?: string; brief?: string },
): string {
  const brief = clean((ctx.brief ?? "").slice(0, 600));
  return [
    `Create one realistic, professional, well-composed photograph for the website of "${ctx.siteName}"${ctx.tagline ? ` (${clean(ctx.tagline)})` : ""}.`,
    `Subject: ${slot.subject}.`,
    brief ? `The owner described the business as follows -- stay faithful to it and do not contradict it: ${brief}` : "",
    `Requirements: natural lighting, believable real-world scene, ${slot.aspect === "wide" ? "wide landscape framing" : "square framing"}. Absolutely no text, letters, numbers, logos, signs with writing, watermarks, borders, or collages.`,
  ].filter(Boolean).join(" ");
}

/**
 * Writes a finished image into a page's sections WITHOUT trusting that the
 * sections are unchanged since the slot was collected (a chat edit may have
 * landed while the image was generating): returns null when the slot no
 * longer exists, no longer matches its kind, or has since gained its own
 * asset_url. Never mutates its input.
 */
export function applyImageToSections(
  sections: SectionLike[],
  slot: Pick<ImageSlot, "sectionIndex" | "itemIndex" | "kind" | "subject">,
  url: string,
): SectionLike[] | null {
  const section = sections[slot.sectionIndex];
  if (!section) return null;
  const expectedType = slot.kind === "gallery-item" ? "gallery" : slot.kind === "services-item" ? "services" : slot.kind;
  if (section.type !== expectedType) return null;
  const content = { ...((section.content ?? {}) as Record<string, unknown>) };

  if (slot.itemIndex === null) {
    if (str(content.asset_url)) return null;
    content.asset_url = url;
    // About renders its image only when image_prompt exists, so a derived
    // subject has to be stored alongside the URL.
    if (!str(content.image_prompt)) content.image_prompt = slot.subject;
    content.media_style = "photo";
  } else {
    const items = Array.isArray(content.items) ? [...(content.items as Record<string, unknown>[])] : [];
    const item = items[slot.itemIndex];
    if (!item || typeof item !== "object" || str(item.asset_url)) return null;
    items[slot.itemIndex] = { ...item, asset_url: url, ...(str(item.image_prompt) ? {} : { image_prompt: slot.subject }) };
    content.items = items;
  }
  return sections.map((s, i) => (i === slot.sectionIndex ? { ...s, content } : s));
}

// ---- provider responses -----------------------------------------------------

export type ParsedImage = { kind: "base64"; mime: string; base64: string } | { kind: "url"; url: string };

/**
 * Handles both shapes this project can be configured for: the Lovable AI
 * gateway (chat-completions with message.images[].image_url.url holding a
 * data: URL) and OpenAI's images API (data[0].b64_json or data[0].url).
 */
export function parseImageResponse(json: unknown): ParsedImage | null {
  const j = json as Record<string, any> | null;
  const dataUrl = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof dataUrl === "string") {
    const m = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (m) return { kind: "base64", mime: m[1].toLowerCase(), base64: m[2] };
    if (/^https:\/\//i.test(dataUrl)) return { kind: "url", url: dataUrl };
  }
  const first = j?.data?.[0];
  if (typeof first?.b64_json === "string" && first.b64_json) return { kind: "base64", mime: "image/png", base64: first.b64_json };
  if (typeof first?.url === "string" && /^https:\/\//i.test(first.url)) return { kind: "url", url: first.url };
  return null;
}

export function extensionForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

/**
 * Public URL for a stored image, routed through Supabase Storage's image
 * transformation endpoint. A browser asking for it gets a resized WebP (live
 * check: a 2.7 MB PNG became 118 KB) instead of the multi-megabyte original
 * PNG the image model returns. The raw object stays in storage untouched.
 */
export function optimizedImageUrl(supabaseUrl: string, bucket: string, path: string, aspect: "wide" | "square"): string {
  const width = aspect === "wide" ? 1600 : 1000;
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/render/image/public/${bucket}/${path}?width=${width}&quality=78`;
}
