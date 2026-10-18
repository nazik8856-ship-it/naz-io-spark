// The Welcome screen shows its guidance labels only on a person's first use after signup. "First use" means: the account is
// recent and the person has not yet chosen an interface. The choice is remembered on the account itself (auth user metadata),
// so it holds on every device, and an older account without the marker never sees the labels.
export const WELCOME_WINDOW_DAYS = 7;

export type WelcomeUser = { created_at?: string | null; user_metadata?: Record<string, unknown> | null };

export function isFirstVisit(user: WelcomeUser | null | undefined, now: number = Date.now()): boolean {
  if (!user?.created_at) return false;
  if (user.user_metadata?.welcome_seen === true) return false;
  const created = Date.parse(user.created_at);
  if (Number.isNaN(created)) return false;
  const age = now - created;
  return age >= 0 && age <= WELCOME_WINDOW_DAYS * 86_400_000;
}
