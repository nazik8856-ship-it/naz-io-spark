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
  const identityEmail = user?.identities
    ?.map((identity) => readString(identity.identity_data?.email))
    .find(Boolean);

  const emailCandidates = [
    { label: "auth.user.email", value: readString(authUser?.email) },
    { label: "auth.session.user.email", value: readString(sessionUser?.email) },
    { label: "auth.user.user_metadata.email", value: readString(authUser?.user_metadata?.email) },
    { label: "auth.session.user.user_metadata.email", value: readString(sessionUser?.user_metadata?.email) },
    { label: "auth.user.identities.identity_data.email", value: identityEmail },
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
    console.error("[welcome-email] Failed to extract user email from auth response", {
      source: params.source,
      userId,
      hasAuthUser: !!authUser,
      hasSessionUser: !!sessionUser,
      hasFallbackEmail: !!readString(params.fallbackEmail),
    });
  } else {
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
export async function sendWelcomeEmail(params: {
  email?: string | null;
  name?: string;
  userId?: string;
  /** Optional context label so logs make clear where the call came from. */
  source?: string;
}): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const { name, userId, source = "unknown" } = params;
  const email = params.email?.trim();
  const startedAt = Date.now();

  console.info("[welcome-email] ▶ start", {
    source,
    email,
    hasName: !!name,
    hasUserId: !!userId,
  });

  if (!email) {
    console.error("Welcome email failed: missing recipient email", { source, userId });
    return { ok: false, error: "missing_email" };
  }

  console.info(`Sending welcome email to: ${email}`, { source, userId });

  // Prefer the live session token if available (e.g., social signup),
  // otherwise fall back to the anon key so unauthenticated signups also pass.
  let bearer = ANON_KEY;
  let bearerSource: "session" | "anon" = "anon";
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      bearer = data.session.access_token;
      bearerSource = "session";
    }
  } catch (sessErr) {
    console.warn("[welcome-email] session lookup failed, using anon key", sessErr);
  }
  console.info("[welcome-email] auth", { bearerSource });

  const idempotencyKey = `welcome-${userId ?? email}-${Date.now()}-${crypto.randomUUID()}`;
  const body = {
    templateName: "welcome-nazai",
    recipientEmail: email,
    idempotencyKey,
    templateData: name ? { name } : {},
  };
  console.info("[welcome-email] payload prepared", {
    templateName: body.templateName,
    recipientEmail: body.recipientEmail,
    idempotencyKey,
  });

  const url = `${SUPABASE_URL}/functions/v1/send-transactional-email`;
  console.info("[welcome-email] → POST", url);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const ms = Date.now() - startedAt;

    if (!res.ok) {
      console.error("[welcome-email] ✖ send failed", {
        source,
        status: res.status,
        statusText: res.statusText,
        body: text,
        ms,
      });
      return { ok: false, status: res.status, body: text };
    }

    console.info("[welcome-email] ✔ queued successfully", {
      source,
      status: res.status,
      body: text,
      ms,
    });
    return { ok: true, status: res.status, body: text };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[welcome-email] ✖ network error", { source, message, ms, err });
    return { ok: false, error: message };
  }
}
