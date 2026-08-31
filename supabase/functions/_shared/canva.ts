// Shared Canva Connect OAuth2 helpers: PKCE generation, authorization URL
// building, code exchange, token refresh, and an authed fetch wrapper that
// refreshes on 401. OAuth transactions are stored server-side and credentials
// are stored encrypted at rest via integration-secrets helpers.
//
// Canva uses PKCE + Basic-auth on the token endpoint per its Connect API docs
// (https://www.canva.dev/docs/connect/authentication/).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret, updateSecret } from "./integration-secrets.ts";
import { fetchWithRetry } from "./fetch-retry.ts";
import { getRotatableClientSecret, withClientSecretRotation } from "./oauth-secret-rotation.ts";

// Grouped scope catalogue shown in the NazAI pre-consent screen. Only the
// groups the user checks are actually included in the authorization URL sent
// to Canva.
export const CANVA_SCOPE_GROUPS: Record<string, string[]> = {
  designs: ["design:content:read", "design:content:write", "design:meta:read"],
  folders: ["folder:read", "folder:write"],
  brands:  ["brandtemplate:content:read", "brandtemplate:meta:read"],
  assets:  ["asset:read", "asset:write"],
  profile: ["profile:read"],
  comments:["comment:read", "comment:write"],
};

export function resolveCanvaScopes(groups: string[]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    const scopes = CANVA_SCOPE_GROUPS[g];
    if (scopes) for (const s of scopes) set.add(s);
  }
  // profile:read is always safe/useful — but only include it if the user
  // actually checked it. Do NOT quietly widen scope beyond what they picked.
  return Array.from(set);
}

export const CANVA_REDIRECT_URI = "https://nazai.net/api/auth/canva/callback";

const enc = new TextEncoder();
export const b64urlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function generateRandomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

// A 96-byte random verifier base64url-encodes to exactly 128 characters,
// within RFC 7636's required 43–128 character range.
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomBase64Url(96);
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return { verifier, challenge: b64urlEncode(new Uint8Array(digest)) };
}

export function buildAuthUrl(state: string, scopes: string[], codeChallenge: string): string {
  const clientId = Deno.env.get("CANVA_CLIENT_ID") || "";
  // Build manually so `scope` is space-separated with %20 (not `+`). Canva's
  // authorization server rejects `+` between scopes as invalid_scope.
  const params = [
    ["code_challenge", codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", scopes.join(" ")],
    ["response_type", "code"],
    ["client_id", clientId],
    ["state", state],
    ["redirect_uri", CANVA_REDIRECT_URI],
  ].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%20/g, "%20")}`).join("&");
  return `https://www.canva.com/api/oauth/authorize?${params}`;
}

type CanvaTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

function basicAuthHeader(clientSecret: string): string {
  const clientId = Deno.env.get("CANVA_CLIENT_ID") || "";
  return "Basic " + btoa(`${clientId}:${clientSecret}`);
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<CanvaTokenResponse> {
  const secrets = getRotatableClientSecret("CANVA_CLIENT_SECRET");
  const { r, data } = await withClientSecretRotation(
    secrets,
    async (clientSecret) => {
      const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: basicAuthHeader(clientSecret),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CANVA_REDIRECT_URI,
          code_verifier: codeVerifier,
        }),
      });
      return { r: res, data: await res.json().catch(() => ({})) };
    },
    // Canva doesn't document a distinct machine-readable code for a bad
    // client secret vs. a bad authorization code -- 401 (Basic-auth
    // rejection) is the closest available signal, same caveat as Notion/Figma.
    ({ r }) => r.status === 401,
  );
  if (!r.ok) {
    throw new Error(data?.message || data?.error_description || data?.error || `Canva token exchange failed (${r.status})`);
  }
  return data as CanvaTokenResponse;
}

export async function refreshToken(refresh_token: string): Promise<CanvaTokenResponse> {
  const secrets = getRotatableClientSecret("CANVA_CLIENT_SECRET");
  const { r, data } = await withClientSecretRotation(
    secrets,
    async (clientSecret) => {
      const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: basicAuthHeader(clientSecret),
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token }),
      });
      return { r: res, data: await res.json().catch(() => ({})) };
    },
    // Same collapsed 400/401 range as Figma's own refresh -- still safe to
    // retry even if the real cause is a revoked refresh token, since both
    // secrets would then fail identically and the classification below is
    // unaffected either way.
    ({ r }) => r.status === 400 || r.status === 401,
  );
  if (!r.ok) {
    const e = new Error(data?.message || data?.error || `Canva refresh failed (${r.status})`);
    if (r.status === 400 || r.status === 401) (e as unknown as { code?: string }).code = "invalid_grant";
    throw e;
  }
  return data as CanvaTokenResponse;
}

export async function fetchUserInfo(access_token: string) {
  const r = await fetch("https://api.canva.com/rest/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({}));
  const profile = (data?.profile ?? data) as Record<string, unknown>;
  return {
    id: profile?.user_id as string | undefined,
    email: profile?.email as string | undefined,
    display_name: profile?.display_name as string | undefined,
    avatar: profile?.avatar_url as string | undefined,
  };
}

export function isConfigured(): boolean {
  return !!(Deno.env.get("CANVA_CLIENT_ID") && Deno.env.get("CANVA_CLIENT_SECRET"));
}

export async function ensureAccessToken(
  admin: SupabaseClient,
  row: { id: string; credentials_secret_id: string | null; credentials?: Record<string, unknown> },
  opts?: { force?: boolean },
): Promise<string | null> {
  const creds = row.credentials ?? await readSecret(admin, row.credentials_secret_id);
  const access = creds.access_token as string | undefined;
  const refresh = creds.refresh_token as string | undefined;
  const expiresAt = Number(creds.expires_at || 0);
  if (!opts?.force && access && expiresAt > Date.now() + 5 * 60_000) return access;
  if (!refresh) return access || null;
  try {
    const tok = await refreshToken(refresh);
    const newCreds = {
      ...creds,
      access_token: tok.access_token,
      expires_at: Date.now() + tok.expires_in * 1000,
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    };
    if (row.credentials_secret_id) await updateSecret(admin, row.credentials_secret_id, newCreds);
    await admin.from("agent_integrations").update({
      status: "connected",
      last_error: null,
      last_verified_at: new Date().toISOString(),
      revoked_alerted_at: null,
    }).eq("id", row.id);
    return tok.access_token;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("agent_integrations").update({
      status: code === "invalid_grant" ? "error" : "connected",
      last_error: code === "invalid_grant"
        ? "Canva refresh token expired — reconnect required."
        : `Canva token refresh transient failure: ${msg}`.slice(0, 500),
      ...(code === "invalid_grant" ? {} : { revoked_alerted_at: null }),
    }).eq("id", row.id);
    return null;
  }
}

export async function canvaAuthedFetch(
  admin: SupabaseClient,
  row: { id: string; credentials_secret_id: string | null; credentials?: Record<string, unknown> },
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let access = await ensureAccessToken(admin, row);
  if (!access) return new Response(JSON.stringify({ error: "no_access_token" }), { status: 401 });
  const doFetch = (tok: string) => fetchWithRetry(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` },
  });
  let r = await doFetch(access);
  if (r.status === 401) {
    access = await ensureAccessToken(admin, row, { force: true });
    if (!access) return r;
    r = await doFetch(access);
  }
  return r;
}
