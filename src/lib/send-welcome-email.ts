import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type AuthUserLike = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: Array<{ identity_data?: Record<string, unknown> | null }> | null;
};

type AuthDataLike = {
  user?: AuthUserLike | null;
  session?: { user?: AuthUserLike | null } | null;
} | null | undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export function resolveWelcomeEmailRecipient(params: {
  authData?: AuthDataLike;
  fallbackEmail?: string | null;
  fallbackName?: string | null;
  source: string;
}): { email?: string; name?: string; userId?: string } {
  const authUser = params.authData?.user ?? null;
  const sessionUser = params.authData?.session?.user ?? null;
  const user = authUser ?? sessionUser;
  const identityEmail = [authUser, sessionUser]
    .flatMap((candidate) => candidate?.identities ?? [])
    .map((identity) => readString(identity.identity_data?.email))
    .find(Boolean);

  const emailCandidates = [
    { label: "user.email", value: readString(authUser?.email) },
    { label: "session?.user?.email", value: readString(sessionUser?.email) },
    { label: "data.user?.email", value: readString(params.authData?.user?.email) },
    { label: "user.user_metadata.email", value: readString(authUser?.user_metadata?.email) },
    { label: "session?.user?.user_metadata.email", value: readString(sessionUser?.user_metadata?.email) },
    { label: "user.identities.identity_data.email", value: identityEmail },
    { label: "form.email", value: readString(params.fallbackEmail) },
  ];
  const selectedEmail = emailCandidates.find((candidate) => candidate.value);

  const userId = readString(authUser?.id) ?? readString(sessionUser?.id);
  const name =
    readString(params.fallbackName) ??
    readString(authUser?.user_metadata?.full_name) ??
    readString(authUser?.user_metadata?.name) ??
    readString(sessionUser?.user_metadata?.full_name) ??
    readString(sessionUser?.user_metadata?.name);

  if (!selectedEmail?.value) {
    console.error("[welcome-email] ❌ Failed to extract user email from auth response", {
      source: params.source,
      userId,
      hasAuthUser: !!authUser,
      hasSessionUser: !!sessionUser,
      hasFallbackEmail: !!readString(params.fallbackEmail),
      authUser,
      sessionUser,
    });
  } else {
    console.log("Extracted email for welcome email:", selectedEmail.value);
    console.info("[welcome-email] resolved recipient", {
      source: params.source,
      userEmail: selectedEmail.value,
      emailSource: selectedEmail.label,
      userId,
    });
  }

  return { email: selectedEmail?.value, name, userId };
}

/**
 * Send the NazAI welcome email reliably, even when the user has no active
 * session yet (right after sign-up, before email confirmation).
 *
 * The send-transactional-email edge function uses verify_jwt = true at the
 * Supabase gateway, so the request MUST include an Authorization header.
 * supabase.functions.invoke only injects Authorization from the current
 * session — when there is no session, the gateway returns 401 and the email
 * never reaches the function. We therefore call the function via fetch with
 * the anon key as the bearer token, which always satisfies verify_jwt.
 *
 * Always sends — no duplicate prevention, no rate limiting, no first-time
 * gating. Idempotency key is unique per attempt so repeated sign-ups
 * always trigger a fresh welcome email.
 */
type SendWelcomeEmailParams = {
  email?: string | null;
  name?: string;
  userId?: string;
  /** Optional context label so logs make clear where the call came from. */
  source?: string;
};

export async function sendWelcomeEmail(
  params: string | SendWelcomeEmailParams
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const normalizedParams: SendWelcomeEmailParams =
    typeof params === "string" ? { email: params, source: "signup-final-attempt" } : params;
  const { name, userId, source = "unknown" } = normalizedParams;
  const email = normalizedParams.email?.trim();
  const startedAt = Date.now();

  console.info("[welcome-email] ▶ start", {
    source,
    email,
    hasName: !!name,
    hasUserId: !!userId,
  });

  if (!email) {
    console.error("Welcome email failed to send:", "missing recipient email", { source, userId });
    return { ok: false, error: "missing_email" };
  }

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("Welcome email failed to send:", "missing email function configuration", {
      source,
      hasUrl: !!SUPABASE_URL,
      hasAnonKey: !!ANON_KEY,
    });
    return { ok: false, error: "missing_email_function_config" };
  }

  console.info(`Sending welcome email to: ${email}`, { source, userId });

  // Send directly via Resend through our dedicated edge function.
  // This bypasses the queue (immediate send) and works with verify_jwt=false,
  // so unauthenticated signups (no session yet) succeed reliably.
  const body = { email, name: name || undefined };
  console.info("[welcome-email] payload prepared", { email, hasName: !!name });

  const url = `${SUPABASE_URL}/functions/v1/send-welcome-resend`;
  console.info("[welcome-email] → POST", url);

  try {
    const res = await fetch(url, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const ms = Date.now() - startedAt;

    if (!res.ok) {
      console.error("Welcome email failed to send:", `${res.status} ${res.statusText}`, {
        source,
        body: text,
      });
      console.error(`Welcome email failed: ${res.status} ${res.statusText}`, {
        source,
        body: text,
      });
      console.error("[welcome-email] ✖ send failed", {
        source,
        status: res.status,
        statusText: res.statusText,
        body: text,
        ms,
      });
      return { ok: false, status: res.status, body: text };
    }

    console.info("Welcome email send request succeeded:", {
      source,
      email,
      status: res.status,
      body: text,
      ms,
    });
    console.info("[welcome-email] ✔ sent via Resend", {
      source,
      status: res.status,
      body: text,
      ms,
    });
    return { ok: true, status: res.status, body: text };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    console.error("Welcome email failed to send:", message, { source, ms, err });
    console.error(`Welcome email failed: ${message}`, { source, ms });
    console.error("[welcome-email] ✖ network error", { source, message, ms, err });
    return { ok: false, error: message };
  }
}
