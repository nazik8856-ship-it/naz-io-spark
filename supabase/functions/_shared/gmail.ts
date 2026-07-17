// Shared Gmail OAuth + API helpers.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret, updateSecret } from "./integration-secrets.ts";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
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
  // Retry transient failures (network / 5xx) once with a short backoff so a
  // single flaky call doesn't invalidate a live agent run.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
      const data = await r.json().catch(() => ({}));
      if (r.ok) return data as { access_token: string; expires_in: number; scope: string; token_type: string; refresh_token?: string };
      const errCode = String(data?.error || "");
      // invalid_grant = refresh token revoked/expired — do NOT retry, propagate a
      // tagged error so callers can mark the integration as needing reconnect.
      if (errCode === "invalid_grant" || errCode === "unauthorized_client") {
        const e = new Error(`invalid_grant: ${data?.error_description || errCode}`);
        (e as unknown as { code?: string }).code = "invalid_grant";
        throw e;
      }
      lastErr = new Error(data?.error_description || errCode || `Refresh failed (${r.status})`);
      // Retry on 5xx / rate limit
      if (r.status >= 500 || r.status === 429) {
        await new Promise((res) => setTimeout(res, 400));
        continue;
      }
      throw lastErr;
    } catch (e) {
      lastErr = e;
      if ((e as { code?: string })?.code === "invalid_grant") throw e;
      if (attempt === 0) {
        await new Promise((res) => setTimeout(res, 400));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Refresh failed");
}

export async function fetchUserInfo(access_token: string) {
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!r.ok) return null;
  return await r.json() as { email?: string; name?: string; picture?: string; sub?: string };
}

// Get a valid access token, refreshing if needed. Persists new token when
// refreshed. On unrecoverable failure (invalid_grant), marks the integration
// row so the UI can prompt the user to reconnect instead of silently failing
// every subsequent run with a stale token.
//
// Credentials are stored encrypted in Supabase Vault; the caller passes the
// integration row containing `credentials_secret_id`. Optionally a `credentials`
// snapshot may be supplied to skip an extra Vault read.
export async function ensureAccessToken(
  admin: SupabaseClient,
  row: { id: string; credentials_secret_id: string | null; credentials?: Record<string, unknown> },
  opts?: { force?: boolean },
): Promise<string | null> {
  const creds = row.credentials ?? await readSecret(admin, row.credentials_secret_id);
  const access = creds.access_token as string | undefined;
  const refresh = creds.refresh_token as string | undefined;
  const expiresAt = Number(creds.expires_at || 0);
  // 5-minute safety buffer so long-running tool calls don't expire mid-flight.
  if (!opts?.force && access && expiresAt > Date.now() + 5 * 60_000) return access;
  if (!refresh) {
    if (!access) {
      await admin.from("agent_integrations").update({
        status: "error",
        last_error: "Missing refresh_token — please reconnect Google.",
      }).eq("id", row.id);
    }
    return access || null;
  }
  try {
    const tok = await refreshToken(refresh);
    const newCreds = {
      ...creds,
      access_token: tok.access_token,
      expires_at: Date.now() + tok.expires_in * 1000,
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    };
    if (row.credentials_secret_id) {
      await updateSecret(admin, row.credentials_secret_id, newCreds);
    }
    await admin.from("agent_integrations").update({
      status: "connected",
      last_error: null,
      last_verified_at: new Date().toISOString(),
    }).eq("id", row.id);
    return tok.access_token;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Google token refresh failed:", code || msg);
    if (code === "invalid_grant") {
      await admin.from("agent_integrations").update({
        status: "error",
        last_error: "Google refresh token revoked or expired — reconnect required.",
      }).eq("id", row.id);
    } else {
      await admin.from("agent_integrations").update({
        last_error: `Token refresh transient failure: ${msg}`.slice(0, 500),
      }).eq("id", row.id);
    }
    return null;
  }
}

// Fetch with automatic access-token refresh + single retry on 401.
export async function googleAuthedFetch(
  admin: SupabaseClient,
  row: { id: string; credentials_secret_id: string | null; credentials?: Record<string, unknown> },
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let access = await ensureAccessToken(admin, row);
  if (!access) return new Response(JSON.stringify({ error: { message: "no_access_token" } }), { status: 401 });
  const doFetch = (tok: string) => fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` },
  });
  let r = await doFetch(access);
  if (r.status === 401) {
    // Force a refresh and retry once. Re-read row from DB in case another
    // concurrent tool call already rotated the token.
    const { data: fresh } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id")
      .eq("id", row.id)
      .maybeSingle();
    const nextRow = fresh
      ? { id: fresh.id as string, credentials_secret_id: (fresh.credentials_secret_id as string | null) ?? null }
      : row;
    access = await ensureAccessToken(admin, nextRow, { force: true });
    if (!access) return r;
    r = await doFetch(access);
  }
  return r;
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
  // Use structural label endpoints instead of q= search — gmail.metadata scope
  // does not permit search queries, so is:unread / category:primary would 400.
  const [unreadLabelR, primaryR, allR] = await Promise.all([
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels/UNREAD", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=UNREAD&labelIds=CATEGORY_PERSONAL&maxResults=50", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
  ]);
  const unreadLabel = await unreadLabelR.json().catch(() => ({}));
  const primary = await primaryR.json().catch(() => ({}));
  const labels = await allR.json().catch(() => ({}));
  if (!unreadLabelR.ok) throw new Error(unreadLabel?.error?.message || `Gmail ${unreadLabelR.status}`);
  return {
    unread: unreadLabel.messagesUnread ?? 0,
    unread_primary: primary.resultSizeEstimate ?? (primary.messages?.length ?? 0),
    labels: (labels.labels || []).length,
  };
}
