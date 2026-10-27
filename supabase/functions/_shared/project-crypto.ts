// Imported projects are stored encrypted (AES-256-GCM). The key lives only in the edge functions' environment (PROJECTS_KEY:
// 32 random bytes in base64, or a random password of 32+ characters), so the database, its backups and anyone who can read the
// table see ciphertext, never the content.
//
// Rotation (secrets handling, front 4): the key can be replaced with no failed read. During a rotation PROJECTS_KEY holds the new
// key and PROJECTS_KEY_PREVIOUS the old one. Every value says which key encrypted it, so it is decrypted with the right one, and
// anything still on the old key is re-encrypted with the new one (when read, and a few rows per session-sweep run). Once nothing is
// left on the old key, PROJECTS_KEY_PREVIOUS is deleted. docs/secrets-rotation.md has the steps.
//
// Format: "v2:<key id>:<iv base64>:<ciphertext base64>"; the key id is the first 8 hex characters of SHA-256 of the key, a fresh
// 12-byte IV for every write. "v1:<iv>:<ciphertext>" (before key ids) is still read: it is tried with each key.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  // In chunks: a 200,000-character project is far more than one call's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** At least this many characters for a key given as a long random password (e.g. several generated passwords joined). */
export const MIN_PASSPHRASE_CHARS = 32;

export type ProjectKey = { key: CryptoKey; id: string };
/** The key new text is encrypted with, and during a rotation the one it replaces. */
export type ProjectKeys = { current: ProjectKey; previous: ProjectKey | null };

/** One key from its environment value; null when it is missing or too short. */
async function importOne(secret: string | null | undefined): Promise<ProjectKey | null> {
  const s = (secret ?? "").trim();
  if (!s) return null;
  let raw: Uint8Array | null = null;
  try { const b = fromB64(s); if (b.length === 32) raw = b; } catch { /* not base64: maybe a password */ }
  if (!raw) {
    if (s.length < MIN_PASSPHRASE_CHARS) return null;
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const id = [...digest.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { key: await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]), id };
}

/**
 * The keys: PROJECTS_KEY (required: without it nothing is stored, projects fail closed) and, during a rotation,
 * PROJECTS_KEY_PREVIOUS. A previous key equal to the current one is ignored.
 */
export async function importProjectKeys(current: string | null | undefined, previous?: string | null): Promise<ProjectKeys | null> {
  const cur = await importOne(current);
  if (!cur) return null;
  const prev = await importOne(previous);
  return { current: cur, previous: prev && prev.id !== cur.id ? prev : null };
}

/** The keys from the function's environment. */
export function projectKeysFromEnv(env: (name: string) => string | undefined = (n) => Deno.env.get(n)): Promise<ProjectKeys | null> {
  return importProjectKeys(env("PROJECTS_KEY"), env("PROJECTS_KEY_PREVIOUS"));
}

export async function encryptText(keys: ProjectKeys, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.current.key, enc.encode(text)));
  return `v2:${keys.current.id}:${toB64(iv)}:${toB64(ct)}`;
}

async function open(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64)));
}

/** The text back; throws when the data was changed or no configured key encrypted it (GCM checks both). */
export async function decryptText(keys: ProjectKeys, stored: string): Promise<string> {
  const parts = stored.split(":");
  if (parts[0] === "v2" && parts.length === 4) {
    const k = [keys.current, keys.previous].find((x) => x?.id === parts[1]);
    if (!k) throw new Error("encrypted with a key that is not configured");
    return await open(k.key, parts[2], parts[3]);
  }
  if (parts[0] === "v1" && parts.length === 3) {
    try { return await open(keys.current.key, parts[1], parts[2]); } catch (e) {
      if (!keys.previous) throw e;
      return await open(keys.previous.key, parts[1], parts[2]);
    }
  }
  throw new Error("unknown format");
}

/** True when the value should be re-encrypted with the current key (an older format, or the previous key). */
export function needsReencrypt(keys: ProjectKeys, stored: string): boolean {
  return !stored.startsWith(currentKeyPrefix(keys));
}

/** What every value encrypted with the current key starts with (for "not like 'prefix%'" queries). */
export function currentKeyPrefix(keys: ProjectKeys): string {
  return `v2:${keys.current.id}:`;
}
