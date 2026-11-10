// What the OAuth consent screen (pages/OAuthConsent.tsx) shows about an app that asks for access.

/** The host of an address, or null when it is not a plain web address. Shown so a person can tell an app from one that borrows its name. */
export function hostOf(address: string | undefined): string | null {
  if (!address) return null;
  try { const u = new URL(address); return u.protocol === "https:" || u.protocol === "http:" ? u.host : null; } catch { return null; }
}
