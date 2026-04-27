import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

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
  email: string;
  name?: string;
  userId?: string;
}): Promise<void> {
  const { email, name, userId } = params;
  if (!email) return;

  // Prefer the live session token if available (e.g., social signup),
  // otherwise fall back to the anon key so unauthenticated signups also pass.
  let bearer = ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) bearer = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  const body = {
    templateName: "welcome-nazai",
    recipientEmail: email,
    idempotencyKey: `welcome-${userId ?? email}-${Date.now()}-${crypto.randomUUID()}`,
    templateData: name ? { name } : {},
  };

  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/send-transactional-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("[welcome-email] send failed", res.status, text);
      return;
    }
    console.info("[welcome-email] queued", text);
  } catch (err) {
    console.error("[welcome-email] network error", err);
  }
}
