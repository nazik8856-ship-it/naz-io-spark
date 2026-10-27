// Verifies webhooks signed with the Svix scheme (Resend). Moved out of resend-events so it can be tested, and so it accepts more
// than one secret: secrets handling, front 4 -- while an inbound secret is being rotated, <NAME>_PREVIOUS still verifies events
// signed with the old one (docs/secrets-rotation.md).
import { timingSafeEqual } from "./timing-safe.ts";

/** The configured secrets for an inbound webhook: <name>, then <name>_PREVIOUS during a rotation. Empty when none is set. */
export function webhookSecrets(name: string, env: (n: string) => string | undefined = (n) => Deno.env.get(n)): string[] {
  return [env(name), env(`${name}_PREVIOUS`)].map((v) => (v ?? "").trim()).filter((v, i, all) => v !== "" && all.indexOf(v) === i);
}

// Tolerance window for the svix-timestamp header, matching Svix's own
// recommended practice -- bounds how old (or how far in the future) a
// "genuine" signed request can be, so a captured request/signature pair
// can't be replayed indefinitely.
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function computeSvixSignature(secret: string, signedContent: string): Promise<string> {
  // Svix secrets are shipped as "whsec_<base64>" -- the prefix identifies the
  // secret format/version and is never part of the key material itself.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const keyBytes = base64ToBytes(rawSecret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  return bytesToBase64(new Uint8Array(sig));
}

/**
 * Verifies a Svix-signed webhook request. Returns null on success, or a
 * string reason on failure -- fail closed in every case (missing secret,
 * missing headers, stale timestamp, no matching signature).
 */
export async function verifySvixSignature(
  secrets: string[],
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  rawBody: string,
): Promise<string | null> {
  if (!svixId || !svixTimestamp || !svixSignature) return "missing svix headers";

  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum)) return "invalid svix-timestamp";
  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - tsNum) > TIMESTAMP_TOLERANCE_SECONDS) return "stale svix-timestamp";

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  // svix-signature can carry multiple space-separated "v1,<base64>" values
  // (e.g. during secret rotation) -- a match against any one is valid, with
  // any of our configured secrets (the current one, and the previous one
  // while a rotation is in progress).
  const candidates = svixSignature.split(" ").map((part) => part.split(",")[1]).filter(Boolean);
  for (const secret of secrets) {
    // A secret that is not valid base64 can not match anything; it must not stop the others from being tried.
    const expected = await computeSvixSignature(secret, signedContent).catch(() => null);
    if (!expected) continue;
    for (const candidate of candidates) {
      if (timingSafeEqual(candidate, expected)) return null;
    }
  }
  return "signature mismatch";
}
