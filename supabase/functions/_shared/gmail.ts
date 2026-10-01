// Shared Gmail OAuth + API helpers.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret, updateSecret } from "./integration-secrets.ts";
import { getRotatableClientSecret, withClientSecretRotation, isStandardInvalidClientError } from "./oauth-secret-rotation.ts";

// Per-service scope sets. Each Connect button in the catalogue requests only
// the scopes it needs — Google grants are cumulative on the account thanks to
// `include_granted_scopes=true`, so users can incrementally add surfaces.
export const GOOGLE_BASE_SCOPES = ["openid", "email", "profile"];
export const GOOGLE_SCOPE_SETS: Record<string, string[]> = {
  drive: ["https://www.googleapis.com/auth/drive.file"],
  calendar: ["https://www.googleapis.com/auth/calendar.events"],
  analytics: ["https://www.googleapis.com/auth/analytics.readonly"],
};
export function scopesForGoogleKind(kind: string): string[] {
  return [...(GOOGLE_SCOPE_SETS[kind] || GOOGLE_SCOPE_SETS.drive), ...GOOGLE_BASE_SCOPES];
}
// Legacy alias — Gmail/Docs/Sheets have been removed pending Google verification.
export const GMAIL_SCOPES = [
  ...GOOGLE_SCOPE_SETS.drive,
  ...GOOGLE_SCOPE_SETS.calendar,
  ...GOOGLE_SCOPE_SETS.analytics,
  ...GOOGLE_BASE_SCOPES,
];


export const GMAIL_REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  // Chunked, not `String.fromCharCode(...bytes)` -- spreading a large
  // Uint8Array as call arguments throws "Maximum call stack size exceeded"
  // well before 1MB. Previously harmless (OAuth state payloads are tiny),
  // but encodeEmail's `raw` can now carry base64-inflated file attachments
  // and routinely exceeds that limit.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const s = btoa(binary);
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
  return buildGoogleAuthUrl(state, GMAIL_SCOPES, GMAIL_REDIRECT_URI, loginHint);
}

export function buildGoogleAuthUrl(
  state: string,
  scopes: string[],
  redirectUri: string,
  loginHint?: string,
): string {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // include_granted_scopes=true: every Google connection (drive/calendar/
  // analytics) is stored as ONE row (provider="Gmail", agent_id null) with
  // ONE access token -- without this flag, connecting a second service
  // (e.g. Analytics after Drive) issues a token scoped to ONLY the new
  // request, silently overwriting the earlier one's credentials and
  // breaking it even though metadata.services still listed it as
  // connected. This used to be off because a since-removed YouTube scope
  // (youtube.readonly) couldn't be combined with drive.file in one grant;
  // that scope no longer exists in GOOGLE_SCOPE_SETS, so the combination
  // this flag now produces (drive.file + calendar.events + analytics.readonly)
  // is a standard, non-conflicting set.
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export async function exchangeCode(code: string) {
  return exchangeGoogleCode(code, GMAIL_REDIRECT_URI);
}

async function requestGoogleToken(body: Record<string, string>, clientSecret: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_secret: clientSecret }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const secrets = getRotatableClientSecret("GOOGLE_OAUTH_CLIENT_SECRET");
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
  const { ok, status, data } = await withClientSecretRotation(
    secrets,
    (secret) => requestGoogleToken({ code, client_id: clientId, redirect_uri: redirectUri, grant_type: "authorization_code" }, secret),
    (r) => !r.ok && isStandardInvalidClientError(r.data),
  );
  if (!ok) throw new Error(data?.error_description || data?.error || `Token exchange failed (${status})`);
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
  const secrets = getRotatableClientSecret("GOOGLE_OAUTH_CLIENT_SECRET");
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { ok, status, data } = await withClientSecretRotation(
        secrets,
        (secret) => requestGoogleToken({ refresh_token, grant_type: "refresh_token", client_id: clientId }, secret),
        (res) => !res.ok && isStandardInvalidClientError(res.data),
      );
      const r = { ok, status };
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
      revoked_alerted_at: null,
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

// Blueprint task #32: a generated report previously could only go out as
// inline text (or a link to something living elsewhere) -- there was no
// path for send_email/reply_email to actually attach a file. This adds
// real MIME-multipart attachment support, shared by both the plain
// encodeEmail() path below and reply_email's own header-threading build
// (encodeEmailWithHeaders), so neither duplicates the MIME construction.
export type EmailAttachment = { filename: string; content: string; mimeType?: string };

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_CHARS = 500_000;

// Shared validation for the `attachments` tool-call field on both
// send_email and reply_email. Schema-level validation (tool-schemas.ts)
// already enforces shape/size before this runs; this is a second,
// semantic-level check (count, filenames present) that returns a clear
// error string instead of silently truncating or dropping attachments.
export function parseEmailAttachments(raw: unknown): { attachments: EmailAttachment[]; error?: string } {
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) return { attachments: [], error: "attachments must be a list of {filename, content}" };
  if (raw.length > MAX_ATTACHMENTS) return { attachments: [], error: `at most ${MAX_ATTACHMENTS} attachments per email` };
  const attachments: EmailAttachment[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const filename = String(item?.filename ?? "").trim();
    const content = String(item?.content ?? "");
    if (!filename || !content) return { attachments: [], error: "each attachment needs a non-empty filename and content" };
    if (content.length > MAX_ATTACHMENT_CHARS) {
      return { attachments: [], error: `attachment "${filename}" exceeds the ${MAX_ATTACHMENT_CHARS.toLocaleString()}-character limit` };
    }
    const mimeType = item?.mime_type ? String(item.mime_type) : undefined;
    attachments.push({ filename, content, mimeType });
  }
  return { attachments };
}

const ATTACHMENT_MIME_BY_EXT: Record<string, string> = {
  csv: "text/csv", txt: "text/plain", md: "text/markdown",
  json: "application/json", html: "text/html", xml: "application/xml",
};
function guessAttachmentMimeType(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return ATTACHMENT_MIME_BY_EXT[ext] || "application/octet-stream";
}

// RFC 2045 recommends wrapping base64 body content at 76 chars per line --
// most mail clients tolerate unwrapped lines, but some strict MIME parsers
// don't, so this costs nothing and avoids a class of "attachment looks
// corrupted in client X" reports.
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

// Attachment content comes from the model as plain text (a generated
// report, CSV, markdown, JSON -- same "content" convention slack_upload_file
// already uses). Standard (non-URL-safe) base64 is required HERE because
// this is the Content-Transfer-Encoding of an inner MIME part, not the
// outer Gmail API `raw` envelope (which is base64url and encoded separately
// by b64urlEncodeStr once the whole message is assembled).
function standardBase64Utf8(s: string): string {
  return wrapBase64(btoa(unescape(encodeURIComponent(s))));
}

function buildMimeMessage(
  from: string, to: string, subject: string, body: string,
  attachments: EmailAttachment[], extraHeaders: string[] = [],
): string {
  const baseHeaders = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, ...extraHeaders];
  if (attachments.length === 0) {
    return [
      ...baseHeaders,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      body,
    ].join("\r\n");
  }
  const boundary = `nazai_${crypto.randomUUID().replace(/-/g, "")}`;
  const lines: string[] = [
    ...baseHeaders,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
    "",
  ];
  for (const att of attachments) {
    const mimeType = att.mimeType || guessAttachmentMimeType(att.filename);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      standardBase64Utf8(att.content),
      "",
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

// Encode an RFC 2822 message (optionally multipart/mixed with attachments) to base64url for Gmail API.
export function encodeEmail(
  from: string, to: string, subject: string, body: string, attachments: EmailAttachment[] = [],
): string {
  return b64urlEncodeStr(buildMimeMessage(from, to, subject, body, attachments));
}

// Same as encodeEmail but threads in extra RFC 2822 headers (In-Reply-To,
// References) -- used by reply_email, which otherwise built its raw
// message by hand and had no attachment support at all.
export function encodeEmailWithHeaders(
  from: string, to: string, subject: string, body: string,
  extraHeaders: string[], attachments: EmailAttachment[] = [],
): string {
  return b64urlEncodeStr(buildMimeMessage(from, to, subject, body, attachments, extraHeaders));
}

// Shared by gmailSend and reply_email's own send -- posts an already-encoded
// `raw` message, optionally inside an existing thread.
export async function gmailSendRaw(
  access_token: string, raw: string, threadId?: string,
): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data?.error?.message || `Gmail ${r.status}` };
  return { ok: true, id: data.id, threadId: data.threadId };
}

export async function gmailSend(
  access_token: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[] = [],
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const raw = encodeEmail(from, to, subject, body, attachments);
  return await gmailSendRaw(access_token, raw);
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
