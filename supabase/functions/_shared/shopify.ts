// Shared Shopify OAuth helpers: shop domain validation, HMAC verification of
// the callback query, authorization URL building, and code→token exchange.
// Shopify's OAuth flow is documented at:
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant

export const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "write_orders",
  "read_customers",
  "write_customers",
  "read_inventory",
  "write_inventory",
];

export const SHOPIFY_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-oauth-callback`;

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/** Normalize + validate a `foo.myshopify.com` shop domain. Returns lowercase
 * canonical form, or null if invalid. */
export function normalizeShop(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  // Strip protocol / path if the user pasted a full URL.
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!SHOP_RE.test(s)) return null;
  return s;
}

export function isConfigured(): boolean {
  return !!(Deno.env.get("SHOPIFY_CLIENT_ID") && Deno.env.get("SHOPIFY_CLIENT_SECRET"));
}

export function buildAuthUrl(shop: string, state: string, scopes: string[] = SHOPIFY_SCOPES): string {
  const params = new URLSearchParams({
    client_id: Deno.env.get("SHOPIFY_CLIENT_ID") || "",
    scope: scopes.join(","),
    redirect_uri: SHOPIFY_REDIRECT_URI,
    state,
    "grant_options[]": "",
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Verify the HMAC signature Shopify attaches to callback query strings.
 * Per Shopify docs: remove the `hmac` (and legacy `signature`) params, sort
 * the remaining params alphabetically, join as `key=value&…`, and HMAC-SHA256
 * with the app's client secret. Compare hex-encoded, timing-safe.
 */
export async function verifyCallbackHmac(url: URL): Promise<boolean> {
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET") || "";
  if (!secret) return false;
  const providedHmac = url.searchParams.get("hmac");
  if (!providedHmac) return false;

  const entries: Array<[string, string]> = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "hmac" || k === "signature") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const computed = await hmacSha256Hex(secret, message);
  return timingSafeEqualHex(computed.toLowerCase(), providedHmac.toLowerCase());
}

export type ShopifyTokenResponse = {
  access_token: string;
  scope?: string;
};

export async function exchangeCode(shop: string, code: string): Promise<ShopifyTokenResponse> {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("SHOPIFY_CLIENT_ID") || "",
      client_secret: Deno.env.get("SHOPIFY_CLIENT_SECRET") || "",
      code,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Shopify token exchange failed (${r.status})`);
  }
  return data as ShopifyTokenResponse;
}

export async function fetchShopInfo(shop: string, access_token: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`https://${shop}/admin/api/2024-07/shop.json`, {
    headers: { "X-Shopify-Access-Token": access_token, Accept: "application/json" },
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return (data?.shop as Record<string, unknown>) || null;
}
