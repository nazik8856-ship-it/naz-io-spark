// Error tracking for edge functions -- reports uncaught exceptions and
// critical safety events to Sentry so they're visible outside server logs.
// Deliberately manual capture only (captureException/captureMessage + an
// explicit flush before the caller returns), not automatic instrumentation
// -- a Supabase Edge Function's isolate can be torn down the instant the
// response is sent, so anything relying on background auto-instrumentation
// risks losing events silently. Public DSN, safe to hardcode (same
// convention as every other public key in this codebase).
import * as Sentry from "npm:@sentry/deno@8";

const SENTRY_DSN = "https://44ff55d0854209b82ab71c48874b00e6@o4512076695666688.ingest.de.sentry.io/4512076789121104";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
    // No tracing -- this is error/event reporting only, not perf monitoring.
    tracesSampleRate: 0,
  });
}

/** Reports a real exception, flushing before the caller returns (the isolate may not survive past that). Never throws -- reporting must never break the real error path. */
export async function reportEdgeException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  try {
    ensureInit();
    Sentry.captureException(err, context ? { extra: context } : undefined);
    await Sentry.flush(2000);
  } catch { /* best effort */ }
}

/** Reports a critical safety event that has no thrown Error object (e.g. a kill-switch trip) as its own Sentry issue. Never throws. */
export async function reportEdgeMessage(message: string, context?: Record<string, unknown>): Promise<void> {
  try {
    ensureInit();
    Sentry.captureMessage(message, { level: "error", extra: context ?? {} });
    await Sentry.flush(2000);
  } catch { /* best effort */ }
}
