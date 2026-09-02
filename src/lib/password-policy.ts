// Mirrors this project's actual Supabase Auth password policy (confirmed via
// a real 422 from /signup: "Password should contain at least one character
// of each: lowercase, uppercase, digit, symbol"). Validating this client-side
// means a weak password gets a clear, immediate message instead of a raw
// GoTrue error string surfacing as a giant unreadable toast after a wasted
// round trip.
export const PASSWORD_MIN_LENGTH = 6;

export const PASSWORD_REQUIREMENTS_HINT =
  `At least ${PASSWORD_MIN_LENGTH} characters, with a lowercase letter, an uppercase letter, a number, and a symbol.`;

/** Pure — returns a user-facing error message, or null if the password satisfies the policy. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  const missing: string[] = [];
  if (!/[a-z]/.test(password)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) missing.push("an uppercase letter");
  if (!/[0-9]/.test(password)) missing.push("a number");
  if (!/[^A-Za-z0-9]/.test(password)) missing.push("a symbol (e.g. !@#$%)");
  if (missing.length) {
    return `Password needs ${missing.join(", ")}.`;
  }
  return null;
}
