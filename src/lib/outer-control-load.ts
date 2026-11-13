// Outer Control page loading (docs/outer-control-loading.md): what a failed read means for the page.
// A read that failed is never shown as "nothing there": the access check (tools and keys) decides whether the page can open at all,
// and a failed activity feed only costs the feed.
import { isTimeout } from "@/lib/with-timeout";

export const PAGE_LOAD_TIMEOUT_MS = 25_000;

type ReadLike = { error?: { message?: string; code?: string } | null } | null | undefined;

export type LoadVerdict = {
  /** The page can not tell what the person has connected: show the error and Retry instead of the page. */
  blocking: string | null;
  /** The page opens, but the recent activity could not be read. */
  feedFailed: boolean;
};

export function loadVerdict(r: { tools: ReadLike; keys: ReadLike; evals: ReadLike }): LoadVerdict {
  const accessErr = r.tools?.error ?? r.keys?.error ?? null;
  if (accessErr) return { blocking: failureText(accessErr.code === "timeout" ? "timeout" : "read"), feedFailed: false };
  return { blocking: null, feedFailed: !!r.evals?.error };
}

export function failureText(kind: "timeout" | "read" | "unexpected"): string {
  if (kind === "timeout") return "Outer Control took too long to answer, so it could not open. Nothing was changed.";
  if (kind === "read") return "Outer Control could not read your connections, so it could not open. Nothing was changed.";
  return "Something went wrong while opening Outer Control. Nothing was changed.";
}

/** The text for an error thrown while loading. */
export function loadErrorText(e: unknown): string {
  return failureText(isTimeout(e) ? "timeout" : "unexpected");
}
