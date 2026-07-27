// Shared Canva OAuth2 helpers. Mirrors the Figma helper: HMAC-signed state,
// authorization URL builder, code exchange, token refresh, user info fetch.
// Credentials will be stored encrypted in Supabase Vault via
// agent_integrations.credentials_secret_id (same pattern as Google/Figma).
//
// NOTE: Client credentials (CANVA_CLIENT_ID / CANVA_CLIENT_SECRET) are not
// wired yet — this scaffolding lets the UI be built now. `isConfigured()`
// tells callers when the flow can actually run.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret, updateSecret } from "./integration-secrets.ts";

// Canva Connect API scopes. Grouped in the UI as human-readable capabilities;
// each capability maps to one or more of these raw scopes.
export const CANVA_SCOPE_GROUPS: Record<string, { label: string; scopes: string[] }> = {
  design_read_write: { label: "Designs — view & edit", scopes: ["design:content:read", "design:content:write", "design:meta:read"] },
  folder_read: { label: "Folders — read", scopes: ["folder:read"] },
  brand_templates_read: { label: "Brand templates — read", scopes: ["brandtemplate:content:read", "brandtemplate:meta:read"] },
  asset_read_write: { label: "Assets — view & upload", scopes: ["asset:read", "asset:write"] },
  profile_read: { label: "Profile — read", scopes: ["profile:read"] },
  comment_read_write: { label: "Comments — view & post", scopes: ["comment:read", "comment:write"] },
};

export function scopesForGroups(groupIds: string[]): string[] {
  const out = new Set<string>();
  groupIds.forEach((g) => {
    (CANVA_SCOPE_GROUPS[g]?.scopes || []).forEach((s) => out.add(s));
  });
  return Array.from(out);
}

export const CANVA_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/canva-oauth-callback`;

export function isConfigured(): boolean {
  return Boolean(Deno.env.get("CANVA_CLIENT_ID") && Deno.env.get("CANVA_CLIENT_SECRET"));
}

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

export function buildAuthUrl(state: string, scopes: string[]): string {
  const clientId = Deno.env.get("CANVA_CLIENT_ID") || "";
  const url = new URL("https://www.canva.com/api/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", CANVA_REDIRECT_URI);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  // Canva Connect requires PKCE (code_challenge). Wire that in when
  // real client credentials are added; for now the flow is scaffolding.
  return url.toString();
}

type CanvaTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeCode(code: string): Promise<CanvaTokenResponse> {
  const clientId = Deno.env.get("CANVA_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET") || "";
  const r = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CANVA_REDIRECT_URI,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.message || data?.error_description || data?.error || `Canva token exchange failed (${r.status})`);
  }
  return data as CanvaTokenResponse;
}

export async function refreshToken(refresh_token: string): Promise<CanvaTokenResponse> {
  const clientId = Deno.env.get("CANVA_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET") || "";
  const r = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token }),
  });
  const data = await r.json().catch(() => ({}));
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
  const profile = data?.profile || data;
  return {
    id: profile?.user_id || profile?.id || null,
    display_name: profile?.display_name || profile?.name || null,
    email: profile?.email || null,
  } as { id: string | null; display_name: string | null; email: string | null };
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
        ? "Canva refresh token expired — reconnect required."
        : `Canva token refresh transient failure: ${msg}`.slice(0, 500),
    }).eq("id", row.id);
    return null;
  }
}
