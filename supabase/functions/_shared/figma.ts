// Shared Figma OAuth2 helpers. Mirrors the Gmail helper: HMAC-signed state,
// authorization URL builder, code exchange, token refresh, and an authed fetch
// wrapper that refreshes on 401. Credentials are stored in Supabase Vault.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret, updateSecret } from "./integration-secrets.ts";

// Full granular scope set — request what the agent actually needs on Figma
// files. Space-separated per Figma's OAuth spec.
export const FIGMA_SCOPES = [
  "files:read",
  "file_variables:read",
  "file_variables:write",
  "file_comments:write",
  "file_dev_resources:read",
  "file_dev_resources:write",
  "library_analytics:read",
  "current_user:read",
  "webhooks:write",
];

export const FIGMA_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/figma-oauth-callback`;

const enc = new TextEncoder();
const b64urlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlEncodeStr = (s: string) => b64urlEncode(enc.encode(s));
const b64urlDecode = (s: string) => {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad));
};

async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "fallback";
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64urlEncodeStr(JSON.stringify({ ...payload, iat: Date.now() }));
  const key = await hmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifyState(token: string): Promise<Record<string, unknown> | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const key = await hmacKey();
  const sigBytes = Uint8Array.from(b64urlDecode(sig), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(body));
  if (!ok) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(body));
    if (typeof parsed.iat === "number" && Date.now() - parsed.iat > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  const clientId = Deno.env.get("FIGMA_CLIENT_ID") || "";
  const url = new URL("https://www.figma.com/oauth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", FIGMA_REDIRECT_URI);
  url.searchParams.set("scope", FIGMA_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

type FigmaTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user_id?: string;
  token_type?: string;
};

export async function exchangeCode(code: string): Promise<FigmaTokenResponse> {
  const clientId = Deno.env.get("FIGMA_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("FIGMA_CLIENT_SECRET") || "";
  const r = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      redirect_uri: FIGMA_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.message || data?.error_description || data?.error || `Figma token exchange failed (${r.status})`);
  }
  return data as FigmaTokenResponse;
}

export async function refreshToken(refresh_token: string): Promise<FigmaTokenResponse> {
  const clientId = Deno.env.get("FIGMA_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("FIGMA_CLIENT_SECRET") || "";
  const r = await fetch("https://api.figma.com/v1/oauth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({ refresh_token }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data?.message || data?.error || `Figma refresh failed (${r.status})`);
    if (r.status === 400 || r.status === 401) (e as unknown as { code?: string }).code = "invalid_grant";
    throw e;
  }
  return data as FigmaTokenResponse;
}

export async function fetchUserInfo(access_token: string) {
  const r = await fetch("https://api.figma.com/v1/me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!r.ok) return null;
  return await r.json() as { id?: string; email?: string; handle?: string; img_url?: string };
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
    }).eq("id", row.id);
    return tok.access_token;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("agent_integrations").update({
      status: code === "invalid_grant" ? "error" : "connected",
      last_error: code === "invalid_grant"
        ? "Figma refresh token expired — reconnect required."
        : `Figma token refresh transient failure: ${msg}`.slice(0, 500),
    }).eq("id", row.id);
    return null;
  }
}

export async function figmaAuthedFetch(
  admin: SupabaseClient,
  row: { id: string; credentials_secret_id: string | null; credentials?: Record<string, unknown> },
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let access = await ensureAccessToken(admin, row);
  if (!access) return new Response(JSON.stringify({ error: "no_access_token" }), { status: 401 });
  const doFetch = (tok: string) => fetch(url, {
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
