// First-time windows after the first two onboarding windows (docs/onboarding-windows.md, window sets 1 and 3).
//
// The Welcome window and the "who runs your first task" choice already exist and are unchanged. After them come, one at a time:
//   3. first product use      (Outer Control or the Generator, once)
//   4. connector unlock       (after the first completed Task)
//   5. control unlock         (after the second completed Task)
// and, after the first success:
//   - nothing forced while the person stays in Outer Control (all of these are small corner cards, never modal);
//   - a soft discovery card once the person leaves Outer Control;
//   - an optional "Was this useful?" when nothing else is on screen and no Task is running.
//
// What was seen is remembered on the account (auth user metadata `onboarding`), so each window shows once on any device.
// Only accounts created after this shipped, within ONBOARDING_DAYS of signup, see them.

export type OnboardingWindowId =
  | "first_use_control"
  | "first_use_generator"
  | "connector_unlock"
  | "control_unlock"
  | "discovery"
  | "feedback";

/** id -> what happened (true when seen or dismissed; for feedback the answer, e.g. "useful", "not_useful:too_slow", "skipped"). */
export type OnboardingState = Partial<Record<OnboardingWindowId, true | string>>;

export const ONBOARDING_SINCE = Date.parse("2026-11-07T00:00:00Z");
export const ONBOARDING_DAYS = 30;

export type OnboardingUser = { created_at?: string | null; user_metadata?: Record<string, unknown> | null };

export function onboardingState(user: OnboardingUser | null | undefined): OnboardingState {
  const raw = user?.user_metadata?.onboarding;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as OnboardingState) : {};
}

/** A new account (created after the windows shipped, within ONBOARDING_DAYS). Older accounts never see them. */
export function isOnboardingUser(user: OnboardingUser | null | undefined, now: number = Date.now()): boolean {
  if (!user?.created_at) return false;
  const created = Date.parse(user.created_at);
  if (Number.isNaN(created) || created < ONBOARDING_SINCE) return false;
  const age = now - created;
  return age >= 0 && age <= ONBOARDING_DAYS * 86_400_000;
}

export type OnboardingContext = {
  path: string;
  /** Completed Control Tasks on the account. */
  done: number;
  /** A Task is queued, running or waiting for the person. */
  running: boolean;
  /** Another window (any modal dialog) is open: wait. */
  dialogOpen: boolean;
  /** The person was in Outer Control after the first success and has now left it. */
  leftOuter: boolean;
  state: OnboardingState;
};

export const isOuterPath = (path: string) => path.startsWith("/control-system/outer");

/** The one window to show now, or null. Never more than one at a time. */
export function nextWindow(c: OnboardingContext): OnboardingWindowId | null {
  if (c.dialogOpen) return null;
  const seen = (id: OnboardingWindowId) => c.state[id] !== undefined;
  // Feedback comes after the unlock card of the moment has been handled, and never while a Task is running ("busy").
  const feedbackReady = c.done >= 1 && !c.running && !seen("feedback")
    && (seen("connector_unlock") || seen("control_unlock") || seen("discovery"));

  if (isOuterPath(c.path)) {
    if (c.done >= 2 && !seen("control_unlock")) return "control_unlock";
    if (c.done === 1 && !seen("connector_unlock")) return "connector_unlock";
    if (feedbackReady) return "feedback";
    if (c.done === 0 && !seen("first_use_control")) return "first_use_control";
    return null;
  }
  if (c.path.startsWith("/generator-home") && !seen("first_use_generator")) return "first_use_generator";
  if (c.done >= 2 && !seen("control_unlock")) return "control_unlock";
  if (c.done >= 1 && c.leftOuter && !seen("discovery") && !seen("control_unlock")) return "discovery";
  if (feedbackReady) return "feedback";
  return null;
}

/** The predefined reasons for "Not really" (no free text is stored). */
export const FEEDBACK_REASONS = [
  { id: "not_what_i_asked", label: "Result was not what I asked" },
  { id: "too_slow", label: "Took too long" },
  { id: "hard_to_follow", label: "Hard to follow" },
  { id: "other", label: "Something else" },
] as const;
