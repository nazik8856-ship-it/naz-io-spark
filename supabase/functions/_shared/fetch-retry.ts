// Transient-failure retry/backoff for outbound provider API calls
// (2026-08-24) -- confirmed zero retry logic anywhere in provider-writes.ts
// (and the Canva/Figma auth-refresh wrappers underneath it): a single
// network hiccup or a provider's own transient 429/5xx was previously
// indistinguishable from a permanent rejection, and the real action was
// simply reported failed and lost.
//
// Transparent passthrough on success or on a PERMANENT rejection (any
// status other than 429/5xx) -- the caller's existing !r.ok / r.status
// handling works completely unchanged either way, since a non-retried
// Response is returned exactly as a plain fetch() would. Only retries on:
//   - a thrown network-level error (timeout, connection reset, DNS...)
//   - HTTP 429 (rate limited) or 5xx (server-side failure)
// Never retries a real 4xx rejection (bad request, auth, not found, a
// channel that doesn't exist, ...) -- those are permanent, not transient.
//
// Known, accepted limitation shared by every retry-on-network-error
// strategy for a non-idempotent write: if the request reached the
// provider and was processed but the RESPONSE was lost (e.g. a dropped
// connection after the provider already committed the write), a retry
// cannot tell that apart from "never arrived" and will resend. This is
// the same tradeoff Stripe/AWS-style retry guidance accepts; there is no
// way to eliminate it without provider-side idempotency keys, which most
// of these APIs (Slack, Notion, Canva, Shopify, Figma) don't expose on
// these endpoints.

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { attempts?: number; baseDelayMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const doFetch = opts.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLast = attempt === attempts - 1;
    try {
      const res = await doFetch(url, init);
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || isLast) return res;
      lastErr = new Error(`retryable HTTP ${res.status}`);
    } catch (e) {
      if (isLast) throw e;
      lastErr = e;
    }
    await sleep(baseDelayMs * Math.pow(2, attempt));
  }
  // Unreachable: the loop above always returns or throws on the last attempt.
  throw lastErr;
}
