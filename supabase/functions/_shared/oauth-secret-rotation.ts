// "15 more items" plan, item 8: rotation support for the six third-party
// OAuth client secrets (Google, Shopify, Notion, Figma, Canva, Slack).
//
// decision_signing_secret and the outbound webhook secret already have
// proper rotation with a bounded overlap window (a DB row with
// previous_secret + previous_secret_expires_at, cleared by a scheduled
// sweep). OAuth client secrets can't use that exact shape -- they live in
// plain Deno env vars, not a database row this project's own code can
// write to or expire on a timer. The realistic, honest equivalent here:
// a SECOND env var per provider (e.g. GOOGLE_OAUTH_CLIENT_SECRET_PREVIOUS)
// that, when set, is tried automatically if the primary secret is
// rejected specifically for being the WRONG credential (not for some
// unrelated reason) -- so an operator can generate a new secret at the
// provider, set it as primary, and leave the just-rotated-out one as
// "previous" for a while, without every in-flight token exchange/refresh
// breaking during the changeover. There's no automatic expiry (env vars
// have no timestamp field to sweep) -- the operator removes the
// "_PREVIOUS" var once satisfied the rotation is stable, same manual
// cleanup step decision-signing's OWN groundwork item once flagged for
// its eventual real cutover.
export type RotatableClientSecret = { current: string; previous: string | null };

export function getRotatableClientSecret(envVarName: string): RotatableClientSecret {
  return {
    current: Deno.env.get(envVarName) || "",
    previous: Deno.env.get(`${envVarName}_PREVIOUS`) || null,
  };
}

/**
 * Runs `attempt` with the current secret; if the result looks like a
 * "this client's credentials were rejected" failure (per `isClientAuthError`)
 * AND a previous secret is configured, retries once with that previous
 * secret and returns ITS result instead -- covers the exact window where
 * the provider (or this app's own env var) has moved to the new secret but
 * a caller is still relying on the one just rotated out. Any other kind of
 * failure (network error, a revoked refresh token, a 5xx) is returned
 * as-is from the first attempt -- retrying with a different SECRET can't
 * fix a problem that was never about the secret in the first place.
 */
export async function withClientSecretRotation<T>(
  secrets: RotatableClientSecret,
  attempt: (secret: string) => Promise<T>,
  isClientAuthError: (result: T) => boolean,
): Promise<T> {
  const result = await attempt(secrets.current);
  if (secrets.previous && isClientAuthError(result)) {
    return attempt(secrets.previous);
  }
  return result;
}

/**
 * Same retry-on-rotation shape, specialized for HMAC-signature verification
 * (Shopify's callback HMAC is signed with the client secret, unlike the
 * other five providers which only ever send it in an outbound POST body) --
 * tries the current secret's signature first, then the previous one if it
 * doesn't match and a previous secret is configured.
 */
export async function verifyWithClientSecretRotation(
  secrets: RotatableClientSecret,
  verify: (secret: string) => Promise<boolean>,
): Promise<boolean> {
  if (await verify(secrets.current)) return true;
  if (secrets.previous) return verify(secrets.previous);
  return false;
}

/** RFC 6749's standard error code for a rejected client_id/client_secret pair -- the shared default every compliant provider's token endpoint uses. */
export function isStandardInvalidClientError(data: unknown): boolean {
  return (data as { error?: string } | null)?.error === "invalid_client";
}
