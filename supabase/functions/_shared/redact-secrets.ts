// Secrets never reach a log, an error report or a stored error message. This is the one scrubber for all of them: the edge
// functions' console (redact-console.ts), Sentry (server and website), PostHog's error capture (website), and the database
// trigger's SQL twin (redact_secrets() in the migration). It replaces the secret itself with [REDACTED:secrets] and leaves the
// words around it, so a message stays useful ("Notion refused token [REDACTED:secrets]").
//
// Byte-identical copies: supabase/functions/_shared/redact-secrets.ts and src/lib/redact-secrets.ts (a parity test checks).

export const REDACTED = "[REDACTED:secrets]";

// Values that are a credential by their shape (the same formats the built-in "API key or secret" rule catches), wherever they
// appear: provider keys, a private key block, a JWT.
const SECRET_SHAPES =
  /(sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[A-Za-z0-9._-]{20,}|secret_[A-Za-z0-9]{30,}|ntn_[A-Za-z0-9]{30,}|shpat_[A-Fa-f0-9]{20,}|re_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]{5,})?)/g;

// "Bearer abc…", "Basic abc…" (an Authorization header's value, wherever it is printed).
const AUTH_SCHEMES = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g;

// A value right after a name that says it is a secret: token=…, "client_secret": "…", Authorization: …, password: …
const NAMED =
  /(\b(?:authorization|proxy-authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|webhook[_-]?secret|signing[_-]?secret|secret|password|passwd|pwd|token|cookie|set-cookie)\b["']?\s*[:=]\s*["']?)(?!\[REDACTED|(?:Bearer|Basic|Token)\s+\[REDACTED)((?:Bearer|Basic|Token)\s+)?[^\s"',;&}\]]{6,}/gi;

// Secret query parameters in a URL (?access_token=…&code=…).
const URL_PARAMS = /([?&#](?:access_token|refresh_token|id_token|token|key|api_key|apikey|client_secret|code|signature|sig|password)=)[^&#\s"']+/gi;

/** The text with every secret in it replaced by [REDACTED:secrets]. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(SECRET_SHAPES, REDACTED)
    .replace(NAMED, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(AUTH_SCHEMES, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(URL_PARAMS, (_m, prefix: string) => `${prefix}${REDACTED}`);
}

// Object keys whose whole value is a secret, whatever it looks like.
const SECRET_KEYS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token|private[_-]?key|credentials?|service[_-]?key|webhook[_-]?secret|signing[_-]?secret|callback[_-]?secret)$/i;

/** A copy of any value with secrets removed: strings scrubbed, secret-named keys blanked, errors kept readable. Never throws. */
export function redactDeep(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  try {
    if (typeof value === "string") return redactSecrets(value);
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value as object)) return "[circular]";
    if (depth > 8) return "[deep]";
    seen.add(value as object);
    if (value instanceof Error) {
      const copy = new Error(redactSecrets(value.message));
      copy.name = value.name;
      copy.stack = value.stack ? redactSecrets(value.stack) : undefined;
      return copy;
    }
    if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactDeep(v, depth + 1, seen));
    if (typeof (value as { entries?: unknown }).entries === "function" && typeof Headers !== "undefined" && value instanceof Headers) {
      return Object.fromEntries([...value.entries()].map(([k, v]) => [k, SECRET_KEYS.test(k) ? REDACTED : redactSecrets(v)]));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && v !== null && v !== undefined && v !== "" ? REDACTED : redactDeep(v, depth + 1, seen);
    }
    return out;
  } catch {
    return "[unprintable]";
  }
}

/**
 * An error-report event (Sentry, PostHog) made safe to send: request headers and cookies dropped, everything else scrubbed.
 * Returns the cleaned event; never throws (an event that can not be cleaned is not sent: null).
 */
export function scrubErrorEvent<T>(event: T): T | null {
  try {
    const copy = redactDeep(event) as Record<string, unknown> | null;
    if (!copy || typeof copy !== "object") return null;
    const req = copy.request as Record<string, unknown> | undefined;
    if (req && typeof req === "object") { delete req.headers; delete req.cookies; }
    return copy as T;
  } catch {
    return null;
  }
}
