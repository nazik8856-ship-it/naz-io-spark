// First-value onboarding: a person who has just signed up and has nothing in NazAI yet sees one window ("Try your first
// controlled AI task") instead of the full interface, goes straight to Start a task, and gets the full interface (Generator /
// Control / Projects) once a controlled task has finished. The finish is remembered on the account (auth user metadata), so it
// holds on every device; an older account, or one that already has projects, never sees it.
import { WELCOME_WINDOW_DAYS, type WelcomeUser } from "@/lib/welcome";

export const FIRST_VALUE_START = "/control-system/outer?start=first";
/** Finished tasks after which the full interface opens on its own. */
export const FIRST_VALUE_TASKS = 2;

export function isFirstValueUser(user: WelcomeUser | null | undefined, projectCount: number, now: number = Date.now()): boolean {
  if (!user?.created_at) return false;
  if (user.user_metadata?.first_value_done === true) return false;
  if (projectCount > 0) return false;
  const created = Date.parse(user.created_at);
  if (Number.isNaN(created)) return false;
  const age = now - created;
  return age >= 0 && age <= WELCOME_WINDOW_DAYS * 86_400_000;
}
