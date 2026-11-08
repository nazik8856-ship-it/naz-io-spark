// Data in transit (security task 2): where a NazAI server function may send a request. Enforced by the outbound guard
// (outbound-guard.ts), which every edge function imports second, so it covers every fetch: NazAI's code, its libraries, and the
// fetch implementations handed to them. There is no warning-only mode; a request that fails a rule is not sent.
//
// A request may go to exactly one of:
//   1. NazAI's own Supabase project (SUPABASE_URL): the database, storage and NazAI's other functions;
//   2. a host on NAZAI_EGRESS_HOSTS below (or a subdomain of one): the services NazAI itself uses, each with the reason;
//   3. a customer's own address (a connected tool, a webhook, a callback, a page to import), and only after the address passed
//      validateOutboundUrl (url-safety.ts: https, every DNS answer public, no credential in it). Passing the check approves that
//      origin for CUSTOMER_APPROVAL_MS; a customer address nobody checked is refused. Customer requests never follow a redirect
//      by themselves (the guard sets redirect "manual"); customerFetch (url-safety.ts) follows them by hand, checking every hop.
// Plain http is refused everywhere, except to NazAI's own project when SUPABASE_URL itself is http (local development only).
// data: and blob: addresses are not network requests and pass.

/** The services NazAI's own code talks to. A host matches itself and its subdomains. Adding one is a reviewed change. */
export const NAZAI_EGRESS_HOSTS: Record<string, string> = {
  "openai.com": "model provider (chat, images, embeddings)",
  "anthropic.com": "model provider",
  "openrouter.ai": "model provider (swift-service)",
  "lovable.dev": "AI gateway (ai.gateway.lovable.dev)",
  "resend.com": "email delivery",
  "sentry.io": "error reports (already scrubbed of secrets)",
  "slack.com": "Slack connector and OAuth",
  "googleapis.com": "Google connectors (Gmail, Docs, Sheets, Drive, Calendar, Analytics) and OAuth",
  "google.com": "Google OAuth and Docs export links (docs.google.com)",
  "notion.com": "Notion connector and OAuth (api.notion.com)",
  "canva.com": "Canva connector and OAuth",
  "figma.com": "Figma connector and OAuth",
  "myshopify.com": "a customer's Shopify store (Shopify's own domain)",
  "shopify.com": "Shopify OAuth",
  "stripe.com": "Stripe connector",
  "hubapi.com": "HubSpot connector",
  "github.com": "GitHub imports and account search (api.github.com)",
  "githubusercontent.com": "GitHub imports (a repository's README, raw.githubusercontent.com)",
  "instagram.com": "public account search (integration-account-search)",
  "tiktok.com": "public account search (integration-account-search)",
  "youtube.com": "public account search (integration-account-search)",
  "x.com": "public account search (integration-account-search)",
  "twitter.com": "public account search (publish.twitter.com oEmbed)",
};

/** How long a customer origin stays approved after it passed validateOutboundUrl. */
export const CUSTOMER_APPROVAL_MS = 5 * 60_000;

/** Query parameters that carry a credential (a key, token, secret, password or signature). The same list as url_carries_credentials(). */
export const CREDENTIAL_PARAMS = /^(access[_-]?token|api[_-]?key|apikey|auth|authorization|client[_-]?secret|key|passwd|password|pwd|secret|sig|signature|token|x-api-key)$/i;

/**
 * Data at rest (security task 1): an address NazAI stores and calls never carries a credential, because addresses are kept readable
 * (they are looked up and shown) and travel in logs and evidence. A user name or password in the address, or a credential-like
 * query parameter, is refused; the key belongs in the tool's authentication field (kept in the vault). Null when the address is clean.
 */
export function urlCredentialProblem(rawUrl: string): string | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.username || u.password) return "the address contains a user name or password; put the credential in the authentication field instead";
  const names = [...u.searchParams.keys(), ...new URLSearchParams(u.hash.replace(/^#/, "")).keys()];
  const hit = names.find((n) => CREDENTIAL_PARAMS.test(n));
  return hit ? `the address carries a credential, the "${hit}" parameter; put it in the authentication field instead` : null;
}

export function isNazaiHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return Object.keys(NAZAI_EGRESS_HOSTS).some((s) => h === s || h.endsWith(`.${s}`));
}

const approved = new Map<string, number>();

/** Marks a customer origin as checked (called by validateOutboundUrl when an address passes). */
export function approveCustomerOrigin(rawUrl: string, now = Date.now()): void {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return;
    approved.set(u.origin, now + CUSTOMER_APPROVAL_MS);
    if (approved.size > 5_000) for (const [k, until] of approved) if (until < now) approved.delete(k);
  } catch { /* not an address: nothing to approve */ }
}

export function customerOriginApproved(origin: string, now = Date.now()): boolean {
  const until = approved.get(origin);
  if (until === undefined) return false;
  if (until < now) { approved.delete(origin); return false; }
  return true;
}

/** For tests. */
export function forgetCustomerApprovals(): void { approved.clear(); }

export type EgressDecision =
  | { ok: true; kind: "own" | "nazai" | "customer" | "local" }
  | { ok: false; reason: string; host: string };

/** Whether a request to this address may be sent, and as what. ownHost is the host of SUPABASE_URL; ownHttp whether SUPABASE_URL is http. */
export function egressDecision(rawUrl: string, ownHost: string | null, ownHttp = false, now = Date.now()): EgressDecision {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "not a valid address", host: "" }; }
  if (u.protocol === "data:" || u.protocol === "blob:") return { ok: true, kind: "local" };
  const host = u.hostname.toLowerCase();
  if (ownHost && host === ownHost && (u.protocol === "https:" || (ownHttp && u.protocol === "http:"))) return { ok: true, kind: "own" };
  if (u.protocol !== "https:") return { ok: false, reason: `only https is allowed, not ${u.protocol.replace(":", "")}`, host };
  if (u.username || u.password) return { ok: false, reason: "the address contains a user name or password", host };
  if (isNazaiHost(host)) return { ok: true, kind: "nazai" };
  if (!customerOriginApproved(u.origin, now)) return { ok: false, reason: "not a NazAI service and not a customer address checked by validateOutboundUrl", host };
  const credential = urlCredentialProblem(u.href);
  if (credential) return { ok: false, reason: credential, host };
  return { ok: true, kind: "customer" };
}
