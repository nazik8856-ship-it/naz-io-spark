// Shared Gmail OAuth + API helpers.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.metadata",
  "openid",
  "email",
  "profile",
];

export const GMAIL_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncode(enc.encode(s));
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return atob(b64);
}

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

export function buildAuthUrl(state: string, loginHint?: string): string {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", GMAIL_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export async function exchangeCode(code: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "",
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "",
      redirect_uri: GMAIL_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description || data?.error || `Token exchange failed (${r.status})`);
  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
    token_type: string;
  };
}

export async function refreshToken(refresh_token: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "",
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "",
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description || data?.error || `Refresh failed (${r.status})`);
  return data as { access_token: string; expires_in: number; scope: string; token_type: string };
}

export async function fetchUserInfo(access_token: string) {
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!r.ok) return null;
  return await r.json() as { email?: string; name?: string; picture?: string; sub?: string };
}

// Get a valid access token, refreshing if needed. Persists new token when refreshed.
export async function ensureAccessToken(
  admin: SupabaseClient,
  row: { id: string; credentials: Record<string, unknown> },
): Promise<string | null> {
  const creds = row.credentials || {};
  const access = creds.access_token as string | undefined;
  const refresh = creds.refresh_token as string | undefined;
  const expiresAt = Number(creds.expires_at || 0);
  if (access && expiresAt > Date.now() + 60_000) return access;
  if (!refresh) return access || null;
  try {
    const tok = await refreshToken(refresh);
    const newCreds = {
      ...creds,
      access_token: tok.access_token,
      expires_at: Date.now() + tok.expires_in * 1000,
    };
    await admin.from("agent_integrations").update({ credentials: newCreds }).eq("id", row.id);
    return tok.access_token;
  } catch (e) {
    console.error("Gmail token refresh failed:", e);
    return null;
  }
}

// Encode an RFC 2822 message to base64url for Gmail API.
export function encodeEmail(from: string, to: string, subject: string, body: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
  return b64urlEncodeStr(headers);
}

export async function gmailSend(
  access_token: string,
  from: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const raw = encodeEmail(from, to, subject, body);
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data?.error?.message || `Gmail ${r.status}` };
  return { ok: true, id: data.id };
}

export async function gmailList(access_token: string) {
  const [unreadR, awaitingR, allR] = await Promise.all([
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=100", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+category:primary&maxResults=50", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
  ]);
  const unread = await unreadR.json().catch(() => ({}));
  const awaiting = await awaitingR.json().catch(() => ({}));
  const labels = await allR.json().catch(() => ({}));
  if (!unreadR.ok) throw new Error(unread?.error?.message || `Gmail ${unreadR.status}`);
  return {
    unread: unread.resultSizeEstimate ?? (unread.messages?.length ?? 0),
    unread_primary: awaiting.resultSizeEstimate ?? (awaiting.messages?.length ?? 0),
    labels: (labels.labels || []).length,
  };
}
