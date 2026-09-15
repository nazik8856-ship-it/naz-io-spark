// Error tracking + basic performance tracing. Public DSN -- safe to ship
// client-side, same convention as SUPABASE_ANON_KEY in
// integrations/supabase/client.ts and POSTHOG_KEY in lib/posthog.ts
// (hardcoded rather than an env var, since this app has no env-var
// convention and a Sentry DSN is meant to be public).
import * as Sentry from "@sentry/react";

const SENTRY_DSN = "https://0253663b0a7ad8a706ac9c1d7fc3c326@o4512076695666688.ingest.de.sentry.io/4512076788990032";

export function initSentry() {
  if (typeof window === "undefined") return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Low but nonzero -- enough to catch real performance regressions
    // without paying for every single page load at launch-scale traffic.
    tracesSampleRate: 0.1,
    // Never captures replay video/DOM for anyone by default -- PostHog
    // already owns session replay (lib/posthog.ts); Sentry's own replay
    // would be a second, redundant recording of the same sessions.
    integrations: [],
  });
}

// Ties Sentry's error reports to a real account once we know who they are,
// and severs it again on sign-out -- same reasoning as posthog.ts's own
// syncPostHogIdentity. Never sends more than an id/email: no names, no
// free-text profile fields.
export function syncSentryIdentity(user: { id: string; email?: string | null } | null) {
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email ?? undefined });
  } else {
    Sentry.setUser(null);
  }
}

export { Sentry };
