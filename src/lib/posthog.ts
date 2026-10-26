// PostHog product analytics + session replay. Public project key -- safe to
// ship client-side, same convention as SUPABASE_ANON_KEY in
// integrations/supabase/client.ts (hardcoded rather than an env var, since
// this app has no env-var convention and this key is meant to be public).
import posthog from "posthog-js";
import { redactDeep, redactSecrets, scrubErrorEvent } from "@/lib/redact-secrets";

type PostHogEvent = { event?: string; properties?: Record<string, unknown> };
/**
 * A PostHog event with secrets scrubbed (an error capture's message and stack can hold a token from a URL). A session replay
 * snapshot keeps its recording (inputs are already masked, and secret text on screen carries data-ph-mask); only the page
 * address it records is scrubbed (an OAuth return carries ?code=…). The event's own properties.token is PostHog's public
 * project key and must stay, or the event is rejected.
 */
export function scrubPostHogEvent<T extends PostHogEvent | null>(event: T): T {
  if (!event) return event;
  if (event.event === "$snapshot") {
    const frames = event.properties?.$snapshot_data;
    if (Array.isArray(frames)) {
      for (const f of frames as { type?: number; data?: { href?: unknown } }[]) {
        if (f && f.type === 4 && f.data && typeof f.data.href === "string") f.data.href = redactSecrets(f.data.href);
      }
    }
    return event;
  }
  const projectKey = event.properties?.token;
  const clean = scrubErrorEvent(event) as T;
  if (clean && clean.properties && projectKey !== undefined) clean.properties.token = projectKey;
  return clean ?? event;
}

type ReplayNetworkRequest = { name?: string; requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string>; requestBody?: string | null; responseBody?: string | null };
/** A network request recorded by session replay, with secrets scrubbed from its address, headers and bodies. */
export function scrubReplayNetworkRequest<T extends ReplayNetworkRequest>(req: T): T {
  const out = { ...req };
  if (typeof out.name === "string") out.name = redactSecrets(out.name);
  if (out.requestHeaders) out.requestHeaders = redactDeep(out.requestHeaders) as Record<string, string>;
  if (out.responseHeaders) out.responseHeaders = redactDeep(out.responseHeaders) as Record<string, string>;
  if (typeof out.requestBody === "string") out.requestBody = redactSecrets(out.requestBody);
  if (typeof out.responseBody === "string") out.responseBody = redactSecrets(out.responseBody);
  return out;
}

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
    // Every event (error captures included: their message and stack can hold a token from a URL) is scrubbed of secrets
    // before it is sent.
    before_send: (event) => scrubPostHogEvent(event),
    // Console output is never recorded in replays, whatever the project setting says: a log line can not be scrubbed once it
    // is inside a recording.
    enable_recording_console_log: false,
    session_recording: {
      // Mask every input's value in replay recordings by default (auth
      // fields, card fields in PaymentWindow, API keys, etc.) -- opt a
      // specific field OUT via the posthog-no-capture class only after
      // confirming it never carries anything sensitive.
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask]",
      // Recorded network requests (their address, and headers and bodies if those are ever turned on) are scrubbed of secrets.
      maskCapturedNetworkRequestFn: (req) => scrubReplayNetworkRequest(req),
    },
  });
}

export { posthog };
