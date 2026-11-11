// Two-step sign-in (TOTP, an authenticator app). Pure helpers; the screens call Supabase.
//
// Supabase tracks two levels for a session: aal1 (signed in with a password or Google) and aal2 (aal1 plus a code from the
// authenticator app). "nextLevel" is aal2 once the person has a verified factor, so a session that is still aal1 must be challenged.

export type AssuranceLevels = { currentLevel: string | null; nextLevel: string | null } | null | undefined;

/** "challenge": the person has a verified factor and this session has not used it yet. "ok": nothing more to ask. */
export function mfaStep(levels: AssuranceLevels): "ok" | "challenge" {
  if (!levels) return "ok";
  return levels.nextLevel === "aal2" && levels.currentLevel !== "aal2" ? "challenge" : "ok";
}

/** Keeps the digits a person typed or pasted ("123 456" -> "123456"), at most 6. */
export function cleanCode(input: string): string {
  return String(input ?? "").replace(/\D/g, "").slice(0, 6);
}

export function isCompleteCode(input: string): boolean {
  return cleanCode(input).length === 6;
}

export type FactorLike = { id: string; status: string; factor_type?: string; friendly_name?: string | null; created_at?: string };

/** The verified authenticator-app factors (a factor that was started but never confirmed does not protect anything). */
export function verifiedTotp(factors: FactorLike[] | null | undefined): FactorLike[] {
  return (factors ?? []).filter((f) => f.status === "verified" && (f.factor_type ?? "totp") === "totp");
}

/** Started but never confirmed: safe to remove, and they block starting a new one under the same name. */
export function unverifiedFactors(factors: FactorLike[] | null | undefined): FactorLike[] {
  return (factors ?? []).filter((f) => f.status !== "verified");
}

/** Wording for the errors Supabase returns while enrolling or confirming, without passing its raw text through. */
export function mfaErrorText(message: string | null | undefined): string {
  const m = String(message ?? "").toLowerCase();
  if (m.includes("invalid") && m.includes("code")) return "That code is not right. Open the authenticator app and type the current 6 digits.";
  if (m.includes("expired") || m.includes("challenge")) return "That code took too long. Type the new 6 digits the app shows now.";
  if (m.includes("rate") || m.includes("too many")) return "Too many tries. Wait a minute and try again.";
  if (m.includes("aal2") || m.includes("assurance")) return "Confirm with a code from your authenticator app first.";
  return "Something went wrong. Try again.";
}
