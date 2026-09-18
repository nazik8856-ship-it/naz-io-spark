// Vercel Edge Middleware. This app is a client-rendered SPA (no SSR), so the
// static index.html — with NazAI's own title/description/OG tags — is what
// every crawler and browser tab sees for every route, including a generated
// business's own public /website-preview/:id link. That means sharing a
// generated site to Slack, iMessage, or social always shows "NazAI — Launch
// Your AI Business in Minutes" instead of the business's own name and
// tagline. This middleware rewrites those tags for that one route before the
// SPA shell is served, using the site's name/tagline from Supabase (now
// publicly readable by id — see the public_read_shared_websites migration).
export const config = {
  matcher: ["/website-preview/:id"],
};

const SUPABASE_URL = "https://ekuodpaaiugzywfcmjeo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrdW9kcGFhaXVnenl3ZmNtamVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjIzNzgsImV4cCI6MjEwMzQzODM3OH0.o1nkPj83mwsRMU2Z_gomeLKHzYwNWxVtRZEysV6PTN4";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/website-preview\/([^/]+)\/?$/);
  const id = match?.[1];
  if (!id) return;

  let site: { name?: string; tagline?: string } | null = null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/websites?id=eq.${encodeURIComponent(id)}&select=name,tagline`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (resp.ok) {
      const rows = (await resp.json()) as { name?: string; tagline?: string }[];
      site = rows?.[0] || null;
    }
  } catch {
    // Network hiccup talking to Supabase from the edge — fall through and
    // let the default NazAI meta tags serve rather than fail the request.
  }
  if (!site?.name) return;

  const pageResp = await fetch(new URL("/index.html", url.origin));
  if (!pageResp.ok) return;
  let html = await pageResp.text();

  const title = escapeHtml(site.name);
  const description = escapeHtml(site.tagline || `${site.name} — a live business site.`);
  const shareUrl = escapeHtml(url.toString());

  html = html
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(/<meta name="description" content=".*?"\s*\/>/s, `<meta name="description" content="${description}" />`)
    .replace(/<meta name="author" content=".*?"\s*\/>/s, "")
    .replace(/<meta property="og:title" content=".*?"\s*\/>/s, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content=".*?"\s*\/>/s, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url" content=".*?"\s*\/>/s, `<meta property="og:url" content="${shareUrl}" />`)
    .replace(/<meta name="twitter:title" content=".*?"\s*\/>/s, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content=".*?"\s*\/>/s, `<meta name="twitter:description" content="${description}" />`)
    // The JSON-LD SoftwareApplication block describes the NazAI product
    // itself, not the generated business — it doesn't apply to this route.
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "");

  return new Response(html, {
    status: 200,
    // Vercel's config-level `headers` rules aren't guaranteed to apply to a
    // response middleware returns directly, so the same security headers
    // vercel.json sets for every other route are repeated here explicitly.
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "SAMEORIGIN",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      "content-security-policy":
        "default-src 'self'; script-src 'self' 'unsafe-eval' https://us-assets.i.posthog.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' https: data: blob:; font-src 'self' data: https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com; connect-src 'self' https://ekuodpaaiugzywfcmjeo.supabase.co wss://ekuodpaaiugzywfcmjeo.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://o4512076695666688.ingest.de.sentry.io; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
    },
  });
}
