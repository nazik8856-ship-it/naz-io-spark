// Session and access isolation (general data security, task 5; docs/session-isolation.md).
//
// The website is a single page: signing out, or another person signing in, does not reload it. Everything the previous session
// left in the page would still be there for the next one: the data cache (react-query), the preview cache, live channels, the
// tab's storage. This module empties all of it at the moment the session changes, and when the active account changes (own
// account / a team's), so one session's data is never shown in another's context.
import type { QueryClient } from "@tanstack/react-query";
import { clearAccountBrowserStorage } from "@/lib/browser-storage";
import { clearPreviewCache } from "@/lib/preview-cache";

export type ResetTargets = {
  queryClient: Pick<QueryClient, "clear" | "resetQueries">;
  /** supabase.removeAllChannels: live channels opened for the previous session. */
  removeAllChannels?: () => unknown;
};

export type SessionChange = "signed_out" | "user_changed";

/** Empties what the previous session left in the page. Never throws. */
export function resetClientState(t: ResetTargets, change: SessionChange): void {
  const attempt = (f: () => unknown) => { try { f(); } catch { /* one cache failing never keeps another from being emptied */ } };
  if (change === "signed_out") {
    attempt(() => t.queryClient.clear());
    attempt(() => t.removeAllChannels?.());
  } else {
    // A different person is signed in already: their screens refetch, nothing of the previous person's is kept.
    attempt(() => t.queryClient.resetQueries());
  }
  attempt(clearPreviewCache);
  attempt(clearAccountBrowserStorage);
}

/** The active account (own, or a team's) changed: nothing cached for the old one is shown in the new one. */
export function resetOnAccountSwitch(t: Pick<ResetTargets, "queryClient">): void {
  try { t.queryClient.resetQueries(); } catch { /* best effort */ }
  clearPreviewCache();
}

type AuthEvents = {
  onAuthStateChange(cb: (event: string, session: { user?: { id?: string } | null } | null) => void): unknown;
};

/** Calls `reset` when the session ends or a different person's session takes its place (also from another tab). */
export function watchSession(auth: AuthEvents, reset: (change: SessionChange) => void): void {
  let current: string | null | undefined; // undefined: no session seen yet in this page
  auth.onAuthStateChange((event, session) => {
    const id = session?.user?.id ?? null;
    if (event === "SIGNED_OUT") { current = null; reset("signed_out"); return; }
    if (id && current && id !== current) reset("user_changed");
    if (id) current = id;
    else if (current === undefined) current = null;
  });
}
