// Outer Control (active): what a failed exchange with a tool means and how to recover.
// Pure: the session driver only applies the answer.

export type FailureKind = "transient" | "rate_limited" | "auth" | "client" | "incomplete" | "unusable";

export type FailureClass = {
  kind: FailureKind;
  /** Whether asking again can help at all. */
  retry: boolean;
  /** How long to wait before asking again. */
  delayMs: number;
  /** What to tell the tool on the next request (incomplete replies only). */
  correction: string | null;
  /** Readable, for the step log and the hand-off. */
  reason: string;
};

/** Waits up to this long inside one invocation; longer waits are scheduled (resume_at). */
export const MAX_INLINE_DELAY_MS = 20_000;
export const MAX_SCHEDULED_DELAY_MS = 5 * 60_000;

export type FailureInput = {
  httpStatus: number | null;
  timedOut?: boolean;
  unreachable?: boolean;
  retryAfterMs?: number | null;
  /** The reply arrived but is not usable as an answer. */
  incomplete?: "empty" | "truncated" | "too_long" | null;
  /** Intake refusal code for a reply that could not be read at all. */
  unusableCode?: string | null;
  /** 1 for the first failure on this step. */
  attempt: number;
};

const backoff = (attempt: number) => Math.min(8_000, 1_000 * 2 ** Math.max(0, attempt - 1));

export function classifyFailure(i: FailureInput): FailureClass {
  if (i.incomplete === "empty") {
    return { kind: "incomplete", retry: true, delayMs: 0, reason: "The tool sent an empty reply.", correction: "Your previous reply was empty. Reply again with the full answer." };
  }
  if (i.incomplete === "truncated") {
    return { kind: "incomplete", retry: true, delayMs: 0, reason: "The tool's reply was cut off.", correction: "Your previous reply was cut off before it finished. Reply again, shorter, so it fits in one reply." };
  }
  if (i.incomplete === "too_long") {
    return { kind: "incomplete", retry: true, delayMs: 0, reason: "The tool's reply was too long.", correction: "Your previous reply was too long. Reply again with a shorter answer." };
  }
  if (i.unusableCode) {
    // A reply with tool calls, or in a shape nobody agreed to, is never retried into: asking again would only repeat it.
    return { kind: "unusable", retry: false, delayMs: 0, correction: null, reason: `The reply could not be used (${i.unusableCode}).` };
  }
  const s = i.httpStatus;
  if (s === 429) {
    const wait = Math.min(MAX_SCHEDULED_DELAY_MS, Math.max(1_000, i.retryAfterMs ?? 5_000 * i.attempt));
    return { kind: "rate_limited", retry: true, delayMs: wait, correction: null, reason: "The tool is rate limiting requests (HTTP 429)." };
  }
  if (s === 401 || s === 403) {
    return { kind: "auth", retry: false, delayMs: 0, correction: null, reason: `The tool rejected the credentials (HTTP ${s}). Update the key, then retry.` };
  }
  if (s !== null && s >= 400 && s < 500 && s !== 408) {
    return { kind: "client", retry: false, delayMs: 0, correction: null, reason: s === 404 ? "The tool's address was not found (HTTP 404)." : `The tool rejected the request (HTTP ${s}).` };
  }
  if (i.timedOut) return { kind: "transient", retry: true, delayMs: backoff(i.attempt), correction: null, reason: "The tool did not answer in time." };
  if (i.unreachable) return { kind: "transient", retry: true, delayMs: backoff(i.attempt), correction: null, reason: "The tool could not be reached." };
  return { kind: "transient", retry: true, delayMs: backoff(i.attempt), correction: null, reason: s ? `The tool answered HTTP ${s}.` : "The tool failed." };
}

/** True when a provider-shaped payload says the model stopped because it ran out of room. */
export function truncationOf(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const o = payload as Record<string, unknown>;
  const choices = Array.isArray(o.choices) ? o.choices : [];
  if (choices.some((c) => (c as Record<string, unknown>)?.finish_reason === "length")) return true;
  if (o.stop_reason === "max_tokens") return true;
  const cands = Array.isArray(o.candidates) ? o.candidates : [];
  if (cands.some((c) => (c as Record<string, unknown>)?.finishReason === "MAX_TOKENS")) return true;
  const inc = o.incomplete_details as Record<string, unknown> | null | undefined;
  return !!inc && inc.reason === "max_output_tokens";
}

/** Retry-After header: seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
