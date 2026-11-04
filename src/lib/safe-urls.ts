// Safe input & output handling, front 4: what the browser may load because a model or a customer wrote an address.
//
//   - embeds (the website "embed" section): https, and only from places made to be embedded. The same list is enforced when a site is
//     generated (supabase/functions/_shared/site-content-guard.ts) and in the page's content security policy (frame-src); a test keeps
//     the three identical. Sites saved before that check still pass through this one when they are shown.
//   - pictures inside markdown (chat answers, run summaries): only from hosts we serve pictures from. A picture loads by itself, with no
//     click, so an address like https://stranger.example/x.png?q=<the conversation> would carry data away the moment the text is shown.

export const EMBED_HOSTS: readonly string[] = [
  "youtube.com", "www.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "player.vimeo.com", "vimeo.com", "calendly.com",
  ".typeform.com", "typeform.com", "docs.google.com", "calendar.google.com", "www.google.com", "maps.google.com", "www.loom.com", "loom.com",
  "open.spotify.com", "w.soundcloud.com", "airtable.com", "tally.so", "cal.com", ".figma.com", "figma.com",
];

export const IMAGE_HOSTS: readonly string[] = [".supabase.co", ".supabase.in", "nazai.net", ".nazai.net", "images.unsplash.com", "oaidalleapiprodscus.blob.core.windows.net"];

const hostIn = (host: string, list: readonly string[]) => list.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));

function parse(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return null;
  try { return new URL(raw.trim()); } catch { return null; }
}

/** An embed address that may be framed: https, no login inside the address, a host from EMBED_HOSTS, never this app's own origin. */
export function isAllowedEmbedUrl(raw: unknown, selfOrigin = typeof location !== "undefined" ? location.origin : ""): boolean {
  const u = parse(raw);
  if (!u || u.protocol !== "https:" || u.username || u.password) return false;
  if (selfOrigin && u.origin === selfOrigin) return false; // same origin + allow-scripts + allow-same-origin would escape the sandbox
  return hostIn(u.hostname.toLowerCase(), EMBED_HOSTS);
}

/** A picture address that may load inside rendered markdown: our own origin, a relative path, or https from IMAGE_HOSTS. */
export function isAllowedImageUrl(raw: unknown, selfOrigin = typeof location !== "undefined" ? location.origin : ""): boolean {
  if (typeof raw === "string" && /^\/(?!\/)/.test(raw.trim())) return true;
  const u = parse(raw);
  if (!u) return false;
  if (selfOrigin && u.origin === selfOrigin) return true;
  return u.protocol === "https:" && !u.username && !u.password && hostIn(u.hostname.toLowerCase(), IMAGE_HOSTS);
}

/** The frame-src hosts for the content security policy, in CSP syntax. */
export function embedFrameSources(): string[] {
  return [...new Set(EMBED_HOSTS.map((h) => (h.startsWith(".") ? `https://*${h}` : `https://${h}`)))];
}
