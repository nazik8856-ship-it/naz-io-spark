// Constant-time string comparison for secret checks. A plain `a !== b`
// (or any comparison that returns as soon as it finds a mismatched byte) is
// a timing side-channel in principle -- an attacker who can measure
// response latency precisely enough can recover a secret one byte at a
// time by noticing which guessed prefix takes marginally longer to reject.
// Compares every byte regardless of where the first mismatch is, so the
// time taken never depends on how much of `a` and `b` agree.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  // A length mismatch is fine to short-circuit on -- it leaks nothing an
  // attacker doesn't already know (secret lengths are fixed-format, not
  // secret in themselves), and comparing byte-by-byte still requires equal
  // lengths to index safely.
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
