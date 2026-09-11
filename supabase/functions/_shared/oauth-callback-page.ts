// Shared success/error page for every OAuth callback (Figma, Gmail, Canva,
// Shopify, Slack, Notion). A real user always reaches this page inside a
// popup opened by IntegrationConnectModal.tsx, so window.opener +
// postMessage + window.close() is the normal path -- and it worked exactly
// as designed. But anyone who hits this URL directly instead of through our
// popup -- confirmed for Figma's own app review, which quoted this exact
// page back verbatim as a rejection reason -- has no window.opener, so the
// postMessage goes nowhere and window.close() silently no-ops (a script can
// only close a window it itself opened). That left them stranded on a
// static "you can close this window" page with no way back into the
// product. The redirect fallback below sends them back into the real app
// instead of dead-ending there.
//
// Never trust a caller-supplied redirect origin blindly -- always run it
// through safeRedirectOrigin() first. An unvalidated redirect target here
// would be a textbook open-redirect vector (the origin is client-supplied
// at OAuth-start time and nothing upstream of this file validates it).

const KNOWN_APP_ORIGINS = ["https://nazai.net", "https://www.nazai.net"];

/** Pure -- is this a real, known origin of ours (or localhost, for local dev)? */
export function isAllowedRedirectOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (KNOWN_APP_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

/** Pure -- the origin to redirect back to when there's no window.opener, falling back to production if the caller-supplied one isn't recognized. */
export function safeRedirectOrigin(origin: string | null | undefined): string {
  return isAllowedRedirectOrigin(origin) ? (origin as string) : KNOWN_APP_ORIGINS[0];
}

export type OAuthCallbackPageOptions = {
  title: string;
  message: string;
  ok: boolean;
  /** postMessage "source" the frontend's IntegrationOAuthMessageBridge matches on, e.g. "nazai-figma-oauth". */
  source: string;
  /** The origin captured at OAuth-start time -- run through safeRedirectOrigin() internally, never trusted raw. */
  redirectOrigin?: string | null;
  /** Provider-specific extra postMessage fields (service/shop/team/workspace). */
  extra?: Record<string, unknown>;
};

/**
 * Renders the OAuth callback's HTML page. `message` should NOT include a
 * "you can close this window" instruction of its own -- the script below
 * appends the correct status text itself, since only client-side JS can
 * actually tell whether window.opener exists.
 */
export function oauthCallbackPage(opts: OAuthCallbackPageOptions): string {
  const redirectOrigin = safeRedirectOrigin(opts.redirectOrigin);
  const payload = JSON.stringify({ source: opts.source, ok: opts.ok, message: opts.message, ...(opts.extra || {}) });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${opts.title}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;color:#e5e5e5;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
  .card{max-width:420px;background:#111;border:1px solid #222;border-radius:12px;padding:28px}
  h1{margin:0 0 8px;font-size:18px;color:${opts.ok ? "#34d399" : "#f87171"}}
  p{margin:0;font-size:14px;line-height:1.5;color:#a3a3a3}
  p.status{margin-top:8px;font-size:12px;color:#71717a}
</style></head>
<body><div class="card"><h1>${opts.title}</h1><p>${opts.message}</p><p class="status" id="oauth-callback-status"></p></div>
<script>
var statusEl = document.getElementById("oauth-callback-status");
try {
  if (window.opener) {
    window.opener.postMessage(${payload}, "*");
    if (statusEl) statusEl.textContent = "You can close this window.";
    setTimeout(function(){ window.close(); }, 120);
  } else {
    if (statusEl) statusEl.textContent = "Redirecting you back to NazAI…";
    setTimeout(function(){ window.location.href = ${JSON.stringify(redirectOrigin)}; }, 500);
  }
} catch(e){}
</script></body></html>`;
}
