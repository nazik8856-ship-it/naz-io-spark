// Shared API-key generation/hashing helpers for the public Control API.
// Used by both api-keys/index.ts (create) and control-api/index.ts
// (verify a presented key) so the two sides can never drift on format or
// hashing algorithm.
export const KEY_PREFIX = "nazai_sk_";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${KEY_PREFIX}${hex}`;
}

/** First 8 hex chars after the prefix -- enough to tell keys apart in the UI without exposing anything usable to re-derive the real key. */
export function displayPrefixFor(rawKey: string): string {
  return `${KEY_PREFIX}${rawKey.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8)}...`;
}

/** Pure — a presented Authorization value at least LOOKS like one of our keys, before spending a hash + DB round-trip on it. */
export function isValidRawKeyFormat(rawKey: string): boolean {
  return rawKey.startsWith(KEY_PREFIX) && /^[0-9a-f]{64}$/.test(rawKey.slice(KEY_PREFIX.length));
}
