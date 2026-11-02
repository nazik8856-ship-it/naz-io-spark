// Safe input & output handling, front 3: what a model wrote into a generated site is checked before it is stored and rendered.
//
// A section's content is free-form per section type, so the check goes by what a value IS, judged by its field name:
//   - a link (…href, cta_…): a page name, #anchor, /path, https address, mailto: or tel:. javascript:/data: and anything else is emptied.
//   - a picture or file address (asset_url, image_url, src, logo…): https or /path only.
//   - embed_url: https, and only from places that are made to be embedded (video, calendars, forms, maps).
//   - text: control and bidi characters out, raw HTML out (outside nothing: site text is plain text), cut to 4,000 characters.
//   - shape: lists of at most 60 items, objects of at most 80 keys, at most 6 levels deep; other value kinds are dropped.
// It never throws and never rejects a whole section for one bad field: the bad field is emptied, the rest renders as before.

import { guardOutputText } from "./output-guard.ts";
import { clip } from "./clean-text.ts";

export const EMBED_HOSTS: readonly string[] = [
  "youtube.com", "www.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "player.vimeo.com", "vimeo.com", "calendly.com",
  ".typeform.com", "typeform.com", "docs.google.com", "calendar.google.com", "www.google.com", "maps.google.com", "www.loom.com", "loom.com",
  "open.spotify.com", "w.soundcloud.com", "airtable.com", "tally.so", "cal.com", ".figma.com", "figma.com",
];

const LINK_KEY = /(^|_)(href|link|cta|url)$|^(href|link)$/i;
const MEDIA_KEY = /(^|_)(asset_url|image_url|img_url|photo_url|logo_url|avatar_url|poster_url|video_url|src|image|logo|avatar|photo|poster)$/i;
const SLUG = /^[a-z0-9][a-z0-9/_-]{0,80}$/i;

const hostIn = (host: string, list: readonly string[]) => list.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));

/** A link value, or "" when it is not one we allow. */
export function safeLink(v: string): string {
  const s = v.trim();
  if (!s) return "";
  if (s.startsWith("#") || (s.startsWith("/") && !s.startsWith("//") && !s.includes("\\"))) return s.length <= 2048 ? s : "";
  if (/^(mailto:|tel:)[^\s<>"']{1,200}$/i.test(s)) return s;
  if (/^https:\/\//i.test(s)) { try { const u = new URL(s); return u.username || u.password ? "" : u.toString().length <= 2048 ? u.toString() : ""; } catch { return ""; } }
  return SLUG.test(s) ? s : "";
}

/** A picture address, or "" (https or /path only). */
export function safeMedia(v: string): string {
  const s = v.trim();
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//") && !s.includes("\\")) return s.length <= 2048 ? s : "";
  if (/^https:\/\//i.test(s)) { try { const u = new URL(s); return u.username || u.password ? "" : s.length <= 2048 ? s : ""; } catch { return ""; } }
  return "";
}

export function safeEmbed(v: string, hosts: readonly string[] = EMBED_HOSTS): string {
  try { const u = new URL(v.trim()); return u.protocol === "https:" && !u.username && !u.password && hostIn(u.hostname.toLowerCase(), hosts) ? u.toString() : ""; } catch { return ""; }
}

function cleanValue(key: string, v: unknown, depth: number): unknown {
  if (typeof v === "string") {
    if (key === "embed_url" || /embed_url$/i.test(key)) return safeEmbed(v);
    if (MEDIA_KEY.test(key)) return safeMedia(v);
    if (LINK_KEY.test(key)) return safeLink(v);
    // text: plain text, no embedded HTML; the "~word~" emphasis marks the renderer reads are ordinary characters and survive
    return clip(guardOutputText(v, { imageHosts: [] }).text, 4000);
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (depth >= 6) return undefined;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const item of v.slice(0, 60)) { const c = cleanValue(key, item, depth + 1); if (c !== undefined) out.push(c); }
    return out;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 80)) {
      if (k === "__proto__" || k.length > 60) continue;
      const c = cleanValue(k, val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

/** A section's content with every value checked. Returns {} for anything that is not an object. */
export function sanitizeSectionContent(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== "object" || Array.isArray(content)) return {};
  return cleanValue("", content, 0) as Record<string, unknown>;
}

/** A short plain-text field (page title, site name, description). */
export function plainField(v: unknown, max: number): string {
  return typeof v === "string" ? clip(guardOutputText(v, { imageHosts: [] }).text.replace(/\s+/g, " ").trim(), max) : "";
}
