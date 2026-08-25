// Real tests for the public Control API's key generation/hashing helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/api-key-auth_test.ts
import { KEY_PREFIX, sha256Hex, generateRawKey, displayPrefixFor, isValidRawKeyFormat } from "./api-key-auth.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("generateRawKey: produces a well-formed key every time", () => {
  for (let i = 0; i < 20; i++) {
    const key = generateRawKey();
    assert(isValidRawKeyFormat(key), `generated key failed format check: ${key}`);
  }
});

Deno.test("generateRawKey: never repeats (CSPRNG, not a fixed value)", () => {
  const keys = new Set(Array.from({ length: 50 }, () => generateRawKey()));
  assertEquals(keys.size, 50);
});

Deno.test("sha256Hex: deterministic -- the same input always hashes the same", async () => {
  const a = await sha256Hex("hello world");
  const b = await sha256Hex("hello world");
  assertEquals(a, b);
});

Deno.test("sha256Hex: different inputs hash differently", async () => {
  const a = await sha256Hex("hello world");
  const b = await sha256Hex("hello world!");
  assert(a !== b);
});

Deno.test("sha256Hex: produces a 64-char lowercase hex string", async () => {
  const h = await sha256Hex("anything");
  assert(/^[0-9a-f]{64}$/.test(h), `not 64-char lowercase hex: ${h}`);
});

Deno.test("sha256Hex: matches the known SHA-256 of an empty string", async () => {
  const h = await sha256Hex("");
  assertEquals(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

Deno.test("displayPrefixFor: keeps the prefix and first 8 hex chars, masks the rest", () => {
  const key = `${KEY_PREFIX}abcdef0123456789${"0".repeat(48)}`;
  assertEquals(displayPrefixFor(key), `${KEY_PREFIX}abcdef01...`);
});

Deno.test("displayPrefixFor: never contains the full raw key", () => {
  const key = generateRawKey();
  const shown = displayPrefixFor(key);
  assert(shown.length < key.length);
  assertFalse(shown === key);
});

Deno.test("isValidRawKeyFormat: accepts a genuinely generated key", () => {
  assert(isValidRawKeyFormat(generateRawKey()));
});

Deno.test("isValidRawKeyFormat: rejects a key with the wrong prefix", () => {
  assertFalse(isValidRawKeyFormat(`wrong_prefix_${"a".repeat(64)}`));
});

Deno.test("isValidRawKeyFormat: rejects a key with the right prefix but wrong-length hex", () => {
  assertFalse(isValidRawKeyFormat(`${KEY_PREFIX}abc123`));
});

Deno.test("isValidRawKeyFormat: rejects a key with non-hex characters after the prefix", () => {
  assertFalse(isValidRawKeyFormat(`${KEY_PREFIX}${"z".repeat(64)}`));
});

Deno.test("isValidRawKeyFormat: rejects an empty string", () => {
  assertFalse(isValidRawKeyFormat(""));
});
