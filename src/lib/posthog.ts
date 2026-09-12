// PostHog product analytics + session replay. Public project key -- safe to
// ship client-side, same convention as SUPABASE_ANON_KEY in
// integrations/supabase/client.ts (hardcoded rather than an env var, since
// this app has no env-var convention and this key is meant to be public).
import posthog from "posthog-js";

const POSTHOG_KEY = "phc_w5rW6zzh54sXxAfNQqexLx2RhDHGsmDApW8sbgMnDno2";
const POSTHOG_HOST = "https://us.i.posthog.com";

export function initPostHog() {
  if (typeof window === "undefined") return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    // React Router is client-side (History API) navigation, not full page
    // loads -- "history_change" patches pushState/replaceState so route
    // changes still count as pageviews without manual wiring per route.
    capture_pageview: "history_change",
    // Auto-captures unhandled exceptions and unhandled promise rejections
    // into PostHog's Error Tracking product -- given how much of this
    // session was "does the client code actually work," this is the one
    // setting most likely to surface a real, silent client-side crash
    // nobody reported.
    capture_exceptions: true,
    session_recording: {
      // Mask every input's value in replay recordings by default (auth
      // fields, card fields in PaymentWindow, API keys, etc.) -- opt a
      // specific field OUT via the posthog-no-capture class only after
      // confirming it never carries anything sensitive.
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask]",
    },
  });
}

export { posthog };
