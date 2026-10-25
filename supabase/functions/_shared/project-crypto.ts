// Imported projects are stored encrypted (AES-256-GCM). The key lives only in the edge functions' environment (PROJECTS_KEY,
// 32 random bytes in base64), so the database, its backups and anyone who can read the table see ciphertext, never the content.
// Format: "v1:<iv base64>:<ciphertext base64>"; a fresh 12-byte IV for every write.

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

/** The key from its base64 form; null when it is missing or not 32 bytes (then nothing is stored: projects fail closed). */
export async function importProjectKey(b64: string | null | undefined): Promise<CryptoKey | null> {
  if (!b64) return null;
  let raw: Uint8Array;
  try { raw = fromB64(b64.trim()); } catch { return null; }
  if (raw.length !== 32) return null;
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text)));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}

/** The text back; throws when the data was changed or the key is wrong (GCM checks both). */
export async function decryptText(key: CryptoKey, stored: string): Promise<string> {
  const [v, ivB64, ctB64] = stored.split(":");
  if (v !== "v1" || !ivB64 || !ctB64) throw new Error("unknown format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return dec.decode(pt);
}
