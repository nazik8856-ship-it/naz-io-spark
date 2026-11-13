// Two-step sign-in recovery codes (docs/two-step-sign-in.md): make, format, read back and hash them.
// 16 characters from 31 (no 0 1 O I L), drawn without bias: about 79 bits, so a plain SHA-256 of the code (with the account id mixed in)
// is enough to store; the database also locks the door after five wrong tries in fifteen minutes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 characters
export const RECOVERY_CODE_LENGTH = 16;
const LIMIT = 256 - (256 % ALPHABET.length); // bytes at or above this are thrown away, so every character is equally likely

export function generateRecoveryCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = "";
  while (out.length < RECOVERY_CODE_LENGTH) {
    for (const b of random(32)) {
      if (b >= LIMIT) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === RECOVERY_CODE_LENGTH) break;
    }
  }
  return out;
}

export function generateRecoveryCodes(count: number, random?: (n: number) => Uint8Array): string[] {
  const set = new Set<string>();
  while (set.size < count) set.add(generateRecoveryCode(random));
  return [...set];
}

/** "ABCD-EFGH-JKMN-PQRS" for showing. */
export const formatRecoveryCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code;

/** What the person typed -> the plain code, or null when it can not be one (wrong length or characters). Case, spaces and dashes do not matter. */
export function normalizeRecoveryCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "");
  return c.length === RECOVERY_CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export async function hashRecoveryCode(userId: string, code: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${code}`));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
