// Free usage limits (docs/onboarding-windows.md).
//
// A free (Explorer) account may start FREE_LIMITS.control_task Control Tasks and create FREE_LIMITS.website new websites per
// calendar month (UTC). Everything already made stays available; only the new limited action is refused. The numbers live in the
// database (free_limit_of); this file only asks free_limit_status() and turns a refusal into the body the app's limit window reads.
//
// Three layers, so no path gets around it:
//   1. the server checks before it spends anything (drive start actions, compile-website-manifest) -> 402 { error: "free_limit" };
//   2. startWorkflow checks again right before the insert (the relay and every other Task path go through it);
//   3. the insert triggers on outer_control_workflows and websites refuse a row past the limit (raise "free_limit:<kind>").

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type FreeLimitKind = "control_task" | "website";
export const FREE_LIMITS: Record<FreeLimitKind, number> = { control_task: 3, website: 2 };

export type FreeLimitStatus = {
  kind: FreeLimitKind;
  limited: boolean;
  used?: number;
  limit?: number;
  allowed?: boolean;
  resets_at?: string;
};

export type FreeLimitRefusal = {
  error: "free_limit";
  kind: FreeLimitKind;
  used: number;
  limit: number;
  resets_at: string | null;
  message: string;
};

/** The calm reason the limit window shows. It names what still works, never what is "locked". */
export function freeLimitMessage(kind: FreeLimitKind, limit: number = FREE_LIMITS[kind]): string {
  return kind === "control_task"
    ? `This month's ${limit} free Control Tasks are used. Your Tasks, results and tools stay available; starting a new Task needs Pro or next month's allowance.`
    : `This month's ${limit} free websites are created. Your websites stay available and editable; creating a new one needs Pro or next month's allowance.`;
}

export function freeLimitRefusal(kind: FreeLimitKind, st: Partial<FreeLimitStatus> = {}): FreeLimitRefusal {
  const limit = typeof st.limit === "number" ? st.limit : FREE_LIMITS[kind];
  return {
    error: "free_limit", kind, used: typeof st.used === "number" ? st.used : limit, limit,
    resets_at: typeof st.resets_at === "string" ? st.resets_at : null, message: freeLimitMessage(kind, limit),
  };
}

/**
 * Whether this account may start one more `kind` now. Fails open on an infrastructure error (a failed lookup must not block a
 * paying customer); the insert trigger is still there as the backstop.
 */
export async function checkFreeLimit(admin: AnyAdmin, userId: string, kind: FreeLimitKind): Promise<{ ok: true } | { ok: false; refusal: FreeLimitRefusal }> {
  try {
    const { data, error } = await admin.rpc("free_limit_status", { _user_id: userId, _kind: kind });
    if (error || !data || typeof data !== "object") return { ok: true };
    const st = data as FreeLimitStatus;
    if (st.limited === true && st.allowed === false) return { ok: false, refusal: freeLimitRefusal(kind, st) };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** The insert trigger's refusal ("free_limit:control_task"), read back from a database error. */
export function freeLimitFromDbError(error: unknown): FreeLimitKind | null {
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message ?? "") : "";
  const m = /free_limit:(control_task|website)\b/.exec(msg);
  return m ? m[1] as FreeLimitKind : null;
}
