// Data encryption, front 2: one way for the edge functions to encrypt user content stored in the database (AES-256-GCM). The key
// lives only in the edge functions' environment (DATA_KEY: 32 random bytes in base64, or a random password of 32+ characters), so
// the database, its backups and anyone who can read a table see ciphertext, never the content. Imported projects keep their own
// key (project-crypto.ts, PROJECTS_KEY); this module is the same format and rotation, generalised to any column.
//
// Every value is bound to where it is stored: "<table>.<column>:<row id>" is authenticated with it (GCM additional data), so an
// encrypted value copied into another row or column does not decrypt.
//
// Rotation works like PROJECTS_KEY: DATA_KEY holds the new key and DATA_KEY_PREVIOUS the old one; every value says which key
// encrypted it, values on the old key still decrypt and are re-encrypted by the sweep, then DATA_KEY_PREVIOUS is deleted
// (docs/secrets-rotation.md).
//
// Format: "v2:<key id>:<iv base64>:<ciphertext base64>"; the key id is the first 8 hex characters of SHA-256 of the key, a fresh
// 12-byte IV for every write. Encryption and fingerprint keys are both derived from DATA_KEY (HKDF), never used raw.

const enc = new TextEncoder();
const dec = new TextDecoder();

// Base64 is most of the cost for long texts, so the runtime's own (Uint8Array.toBase64 / fromBase64) is used where it exists, and
// a table encoder otherwise (about ten times faster than building a string with String.fromCharCode).
type B64Native = { toBase64?: () => string };
const nativeFrom = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
const ALPHABET = enc.encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");

export function toB64(bytes: Uint8Array): string {
  return typeof (bytes as B64Native).toBase64 === "function" ? (bytes as B64Native).toBase64!() : toB64Table(bytes);
}
/** The fallback encoder (exported for its test). */
export function toB64Table(bytes: Uint8Array): string {
  const n = bytes.length, out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0, i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = ALPHABET[v >> 18]; out[o++] = ALPHABET[(v >> 12) & 63]; out[o++] = ALPHABET[(v >> 6) & 63]; out[o++] = ALPHABET[v & 63];
  }
  if (i < n) {
    const v = (bytes[i] << 16) | ((i + 1 < n ? bytes[i + 1] : 0) << 8);
    out[o++] = ALPHABET[v >> 18]; out[o++] = ALPHABET[(v >> 12) & 63]; out[o++] = i + 1 < n ? ALPHABET[(v >> 6) & 63] : 61; out[o++] = 61;
  }
  return dec.decode(out);
}
export function fromB64(b64: string): Uint8Array {
  if (nativeFrom) return nativeFrom(b64);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** At least this many characters for a key given as a long random password (e.g. several generated passwords joined). */
export const MIN_PASSPHRASE_CHARS = 32;

/** The 32 key bytes and their id from an environment value; null when it is missing or too short. */
export async function keyMaterial(secret: string | null | undefined): Promise<{ raw: Uint8Array; id: string } | null> {
  const s = (secret ?? "").trim();
  if (!s) return null;
  let raw: Uint8Array | null = null;
  try { const b = fromB64(s); if (b.length === 32) raw = b; } catch { /* not base64: maybe a password */ }
  if (!raw) {
    if (s.length < MIN_PASSPHRASE_CHARS) return null;
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  return { raw, id: hex(digest.subarray(0, 4)) };
}

export type FieldKey = { key: CryptoKey; mac: CryptoKey; id: string };
/** The key new values are encrypted with, and during a rotation the one it replaces. */
export type FieldKeys = { current: FieldKey; previous: FieldKey | null };

async function importOne(secret: string | null | undefined): Promise<FieldKey | null> {
  const m = await keyMaterial(secret);
  if (!m) return null;
  const base = await crypto.subtle.importKey("raw", m.raw, "HKDF", false, ["deriveKey"]);
  const derive = (info: string, alg: AesKeyGenParams | HmacImportParams, usages: KeyUsage[]) =>
    crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, base, alg, false, usages);
  return {
    key: await derive("nazai field encryption v1", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    mac: await derive("nazai fingerprint v1", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
    id: m.id,
  };
}

/** The keys: the current one (required) and, during a rotation, the previous one. A previous key equal to the current is ignored. */
export async function importFieldKeys(current: string | null | undefined, previous?: string | null): Promise<FieldKeys | null> {
  const cur = await importOne(current);
  if (!cur) return null;
  const prev = await importOne(previous);
  return { current: cur, previous: prev && prev.id !== cur.id ? prev : null };
}

/** DATA_KEY and DATA_KEY_PREVIOUS from the function's environment. Imported once per function instance by the caller. */
export function dataKeysFromEnv(env: (name: string) => string | undefined = (n) => Deno.env.get(n)): Promise<FieldKeys | null> {
  return importFieldKeys(env("DATA_KEY"), env("DATA_KEY_PREVIOUS"));
}

/** Where a value is stored; authenticated with it, so it only decrypts there. */
export type FieldRef = { table: string; column: string; id: string };
const aad = (r: FieldRef) => enc.encode(`${r.table}.${r.column}:${r.id}`);

export async function encryptField(keys: FieldKeys, ref: FieldRef, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(ref) }, keys.current.key, enc.encode(text)));
  return `v2:${keys.current.id}:${toB64(iv)}:${toB64(ct)}`;
}

/** The text back; throws when the value was changed, belongs to another row or column, or no configured key encrypted it. */
export async function decryptField(keys: FieldKeys, ref: FieldRef, stored: string): Promise<string> {
  const parts = stored.split(":");
  if (parts[0] !== "v2" || parts.length !== 4) throw new Error("unknown format");
  const k = [keys.current, keys.previous].find((x) => x?.id === parts[1]);
  if (!k) throw new Error("encrypted with a key that is not configured");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[2]), additionalData: aad(ref) }, k.key, fromB64(parts[3])));
}

/** What every value encrypted with the current key starts with (for "not like 'prefix%'" queries). */
export function currentKeyPrefix(keys: FieldKeys): string {
  return `v2:${keys.current.id}:`;
}

/** True when the value should be re-encrypted with the current key. */
export function needsReencrypt(keys: FieldKeys, stored: string): boolean {
  return !stored.startsWith(currentKeyPrefix(keys));
}

// ---------------------------------------------------------------------------------------
// Rows: an encrypted column "<col>_enc" next to the plain "<col>" (the migration pattern in docs/data-encryption.md)

/** The value as stored in "<col>_enc": any JSON value (text, object, array), so a jsonb column round-trips with its type. */
export const encColumn = (col: string) => `${col}_enc`;

/**
 * The update for a row: each listed column encrypted into "<col>_enc" and the plain column emptied (null, or `empty[col]` for a
 * column that can not be null). Columns not present in `values` are left alone. The row's id must be known (generate it before
 * an insert), because it is part of what is authenticated.
 */
export async function sealFields(
  keys: FieldKeys, table: string, id: string, values: Record<string, unknown>, cols: string[], empty: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    if (!(col in values)) continue;
    const v = values[col];
    out[encColumn(col)] = v === null || v === undefined ? null : await encryptField(keys, { table, column: col, id }, JSON.stringify(v));
    out[col] = col in empty ? empty[col] : null;
  }
  return out;
}

/**
 * The row as the code expects it: each listed column decrypted from "<col>_enc" when it has a value, otherwise the plain column
 * as stored (rows not converted yet). The "<col>_enc" fields are removed. Throws when a value does not decrypt: a wrong or
 * missing key must never look like an empty field.
 */
export async function openFields<T extends Record<string, unknown>>(keys: FieldKeys, table: string, row: T, cols: string[]): Promise<T> {
  const out: Record<string, unknown> = { ...row };
  const id = String(row.id ?? "");
  for (const col of cols) {
    const sealed = row[encColumn(col)];
    delete out[encColumn(col)];
    if (typeof sealed === "string" && sealed) out[col] = JSON.parse(await decryptField(keys, { table, column: col, id }, sealed));
  }
  return out as T;
}

// ---------------------------------------------------------------------------------------
// Fingerprints

/**
 * A keyed fingerprint of a text (HMAC-SHA-256, hex): equal texts give equal fingerprints, so a change can be noticed or a retry
 * matched, but unlike a plain SHA-256 it can not be used to guess a short text, or compared with a hash computed elsewhere.
 */
export async function fingerprint(keys: FieldKeys, text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", keys.current.mac, enc.encode(text))));
}

/** Whether `stored` is this text's fingerprint: under the current or previous key, or a plain SHA-256 stored before keyed ones. */
export async function fingerprintMatches(keys: FieldKeys, stored: string | null | undefined, text: string): Promise<boolean> {
  if (!stored) return false;
  for (const k of [keys.current, keys.previous]) {
    if (k && hex(new Uint8Array(await crypto.subtle.sign("HMAC", k.mac, enc.encode(text)))) === stored) return true;
  }
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))) === stored;
}

// ---------------------------------------------------------------------------------------
// The sweep: converts existing rows a few at a time, and moves values off a previous key

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;
export type SweepResult = { table: string; column: string; encrypted: number; reencrypted: number; failed: number };

/**
 * For one column: up to `limit` rows still holding plain text are encrypted into "<col>_enc" (plain emptied), then up to `limit`
 * values on an older key are re-encrypted with the current one. A row that fails is counted and left as it was.
 */
export async function sweepColumn(
  admin: AnyAdmin, keys: FieldKeys, table: string, column: string, opts: { limit?: number; empty?: unknown } = {},
): Promise<SweepResult> {
  const limit = opts.limit ?? 50;
  const ec = encColumn(column);
  const res: SweepResult = { table, column, encrypted: 0, reencrypted: 0, failed: 0 };
  const plainEmpty = opts.empty === undefined ? null : opts.empty;

  // Already-emptied rows are filtered out in the query, so each run reaches rows that still need converting.
  let q = admin.from(table).select(`id, ${column}, ${ec}`).not(column, "is", null);
  if (plainEmpty === "") q = q.neq(column, "");
  const { data: plain } = await q.limit(limit);
  for (const r of (plain ?? []) as Record<string, unknown>[]) {
    try {
      const patch = r[ec] ? { [column]: plainEmpty } : await sealFields(keys, table, String(r.id), r, [column], { [column]: plainEmpty });
      const { error } = await admin.from(table).update(patch).eq("id", r.id);
      if (error) throw error;
      res.encrypted++;
    } catch { res.failed++; }
  }

  const { data: old } = await admin.from(table).select(`id, ${ec}`).not(ec, "is", null).not(ec, "like", `${currentKeyPrefix(keys)}%`).limit(limit);
  for (const r of (old ?? []) as Record<string, unknown>[]) {
    try {
      const ref = { table, column, id: String(r.id) };
      const text = await decryptField(keys, ref, String(r[ec]));
      const { error } = await admin.from(table).update({ [ec]: await encryptField(keys, ref, text) }).eq("id", r.id);
      if (error) throw error;
      res.reencrypted++;
    } catch { res.failed++; }
  }
  return res;
}
