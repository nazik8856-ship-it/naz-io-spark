// Pure backoff/retry-eligibility logic for outbound webhook delivery.
// Deliveries were previously fire-and-forget: a briefly-down endpoint
// (deploy, restart, blip) meant that event was lost forever, logged as a
// failure but never retried.

export const MAX_ATTEMPTS = 5;
const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 3600; // 1 hour

/** Whether a failed delivery should be scheduled for another attempt at all. */
export function isRetryEligible(attempt: number, ok: boolean): boolean {
  if (ok) return false;
  return attempt < MAX_ATTEMPTS;
}

/**
 * Whether this failed attempt was the LAST one -- retries are now exhausted
 * with no further attempt scheduled. A permanently-broken receiving
 * endpoint previously produced no signal at all once this became true; the
 * caller uses this to fire a one-time dead-letter alert.
 */
export function isExhausted(attempt: number, ok: boolean): boolean {
  return !ok && attempt >= MAX_ATTEMPTS;
}

/**
 * Exponential backoff, no jitter (deterministic, so it's directly
 * testable): 30s, 60s, 120s, 240s, capped at 1 hour. `attempt` is the
 * attempt number that just failed (1 = the first try).
 */
export function computeBackoffSeconds(attempt: number): number {
  const delay = BASE_DELAY_SECONDS * 2 ** (attempt - 1);
  return Math.min(delay, MAX_DELAY_SECONDS);
}

export function computeNextRetryAt(attempt: number, now: Date): Date {
  return new Date(now.getTime() + computeBackoffSeconds(attempt) * 1000);
}
