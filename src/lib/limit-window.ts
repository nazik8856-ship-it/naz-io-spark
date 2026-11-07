// The global limit window (docs/onboarding-windows.md, window set 2).
//
// Anything that hits a free usage limit opens the same window: the server answers 402 with { error: "free_limit", kind, used,
// limit, resets_at, message } (supabase/functions/_shared/free-limits.ts), or { error/code: "no_credits" } when the credits are
// used. Callers pass the response body to `showLimitIfAny`; if it is a limit, the window opens and the caller skips its own error.

export type LimitKind = "control_task" | "website" | "credits";

export type LimitDetail = {
  kind: LimitKind;
  used?: number | null;
  limit?: number | null;
  resets_at?: string | null;
};

export const LIMIT_EVENT = "nazai:limit";

/** The free monthly allowance (the database's free_limit_of says the same; the server is what enforces it). */
export const FREE_LIMITS = { control_task: 3, website: 2 } as const;

/**
 * Where "Upgrade to Pro" leads. A placeholder until payments are set up: the plans page.
 * TODO(payments): decide the real destination when payments are set up (the owner asked to be reminded then).
 */
export const UPGRADE_PATH = "/pricing";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A limit refusal in a server response body, or null when the body is something else. */
export function limitFromResponse(body: unknown): LimitDetail | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.error === "free_limit" && (b.kind === "control_task" || b.kind === "website")) {
    return { kind: b.kind, used: num(b.used), limit: num(b.limit), resets_at: typeof b.resets_at === "string" ? b.resets_at : null };
  }
  if (b.error === "no_credits" || b.code === "no_credits") return { kind: "credits" };
  return null;
}

/** A database error from the insert trigger (e.g. a website duplicated in the browser past the limit). */
export function limitFromDbError(error: unknown): LimitDetail | null {
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message ?? "") : "";
  const m = /free_limit:(control_task|website)\b/.exec(msg);
  return m ? { kind: m[1] as "control_task" | "website" } : null;
}

export function openLimitWindow(detail: LimitDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LimitDetail>(LIMIT_EVENT, { detail }));
}

/** Opens the limit window when `body` is a limit refusal. Returns true when it did, so the caller shows nothing else. */
export function showLimitIfAny(body: unknown): boolean {
  const d = limitFromResponse(body);
  if (d) openLimitWindow(d);
  return d !== null;
}

/** The window's words. Calm and precise: what reached its limit, what still works, when it resets. */
export function limitCopy(d: LimitDetail, now: Date = new Date()) {
  const resets = resetLabel(d.resets_at, now);
  if (d.kind === "control_task") {
    const n = d.limit ?? FREE_LIMITS.control_task;
    return {
      eyebrow: "Free usage · this month",
      title: `${n} of ${n} free Control Tasks used`,
      body: "Starting a new Control Task needs Pro, or waits for next month's allowance.",
      available: ["Your Tasks and their results", "Your connected tools and rules", "Pending approvals and history"],
      resets,
    };
  }
  if (d.kind === "website") {
    const n = d.limit ?? FREE_LIMITS.website;
    return {
      eyebrow: "Free usage · this month",
      title: `${n} of ${n} free websites created`,
      body: "Creating a new website needs Pro, or waits for next month's allowance.",
      available: ["Your websites, to open and edit", "Publishing and sharing", "Agents and Control"],
      resets,
    };
  }
  return {
    eyebrow: "Credits",
    title: "Your credits are used",
    body: "New generations need credits. Pro includes a monthly credit allowance.",
    available: ["Everything you have built", "Editing what you already made", "Control and your rules"],
    resets: null,
  };
}

/** "Resets on 1 December" (UTC, the day the allowance comes back), or null when unknown. */
export function resetLabel(resetsAt: string | null | undefined, now: Date = new Date()): string | null {
  let at = resetsAt ? new Date(resetsAt) : null;
  if (!at || Number.isNaN(at.getTime())) at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `Resets on ${at.getUTCDate()} ${at.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}`;
}
