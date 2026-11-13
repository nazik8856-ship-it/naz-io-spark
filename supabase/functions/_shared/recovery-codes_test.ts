import { formatRecoveryCode, generateRecoveryCode, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_LENGTH } from "./recovery-codes.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

Deno.test("a code is 16 characters from the safe alphabet, and a set has no duplicates", () => {
  const codes = generateRecoveryCodes(8);
  assertEquals(codes.length, 8);
  assertEquals(new Set(codes).size, 8);
  for (const c of codes) {
    assertEquals(c.length, RECOVERY_CODE_LENGTH);
    assert(/^[A-HJKMNP-Z2-9]{16}$/.test(c), c);
  }
});

Deno.test("bytes at or above 248 are thrown away (no modulo bias)", () => {
  // 255 is rejected; 0 -> 'A', 30 -> '9'
  let calls = 0;
  const random = (n: number) => { calls++; return calls === 1 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(30); };
  assertEquals(generateRecoveryCode(random), "9".repeat(16));
  assert(calls >= 2);
});

Deno.test("what the person types is read back: case, spaces and dashes do not matter; wrong length or characters are not codes", () => {
  const code = "ABCDEFGHJKMNPQRS";
  assertEquals(formatRecoveryCode(code), "ABCD-EFGH-JKMN-PQRS");
  assertEquals(normalizeRecoveryCode("abcd-efgh jkmn-pqrs"), code);
  assertEquals(normalizeRecoveryCode(" ABCD-EFGH-JKMN-PQRS "), code);
  assertEquals(normalizeRecoveryCode("ABCD-EFGH-JKMN"), null);
  assertEquals(normalizeRecoveryCode("ABCD-EFGH-JKMN-PQR0"), null); // 0 is not in the alphabet
  assertEquals(normalizeRecoveryCode(""), null);
});

Deno.test("the stored hash is SHA-256 hex, differs per account and per code", async () => {
  const a = await hashRecoveryCode("user-a", "ABCDEFGHJKMNPQRS");
  assert(/^[0-9a-f]{64}$/.test(a));
  assert(a !== await hashRecoveryCode("user-b", "ABCDEFGHJKMNPQRS"));
  assert(a !== await hashRecoveryCode("user-a", "ABCDEFGHJKMNPQRT"));
  assertEquals(a, await hashRecoveryCode("user-a", "ABCDEFGHJKMNPQRS"));
});
