// Outer Control page: the plain-language wording and the small decisions behind the default view.
// Pure, so the page stays a layout and these rules are tested alone.
import { isOpen, type SessionStatus } from "@/lib/outer-control-sessions";

export type Verdict = "allow" | "modify" | "block" | "escalate";
export type Tone = "ok" | "warn" | "bad" | "idle";

/** Verdict wording shown on the page. "escalate" is shown as what the person has to do. */
export const DECISION_LABEL: Record<Verdict, { label: string; tone: Tone }> = {
  allow: { label: "Allow", tone: "ok" },
  modify: { label: "Modify", tone: "ok" },
  block: { label: "Block", tone: "bad" },
  escalate: { label: "Needs approval", tone: "warn" },
};

export type ToolLike = { approved_at: string | null; last_checked_at: string | null; last_error: string | null };

/** One status per tool, worst first: a failed test, then a missing first approval, then the last good test. */
export function toolStatus(t: ToolLike): { label: string; tone: Tone; hint: string } {
  if (t.last_checked_at && t.last_error) return { label: "Test failed", tone: "bad", hint: "Check the address and key, then press Test again." };
  if (!t.approved_at) return { label: "Needs first approval", tone: "warn", hint: "The first session asks you to approve contacting this tool." };
  if (t.last_checked_at) return { label: "Working", tone: "ok", hint: "The last test succeeded." };
  return { label: "Not tested yet", tone: "idle", hint: "Press Test to check the connection." };
}

export type HealthInput = { total7d: number; nonAllow7d: number; anyEver: boolean };

/** The one-line health text under "Outer Control is active". */
export function healthText({ total7d, nonAllow7d, anyEver }: HealthInput): string {
  if (!anyEver) return "Nothing checked yet. Connect a tool and start a session to see decisions here.";
  if (total7d === 0) return "No replies checked in the last 7 days.";
  const checked = `${total7d} ${total7d === 1 ? "reply" : "replies"} checked in the last 7 days`;
  if (nonAllow7d === 0) return `${checked}, all allowed.`;
  return `${checked}; ${nonAllow7d} changed, blocked or sent for approval.`;
}

/** Running or waiting sessions are shown up front; finished ones go to the history. */
export function splitSessions<T extends { status: SessionStatus }>(sessions: T[]): { open: T[]; past: T[] } {
  return { open: sessions.filter((s) => isOpen(s.status)), past: sessions.filter((s) => !isOpen(s.status)) };
}

export const DEFAULT_DECISIONS = 6;
export const DEFAULT_HISTORY = 3;

/** First `n` items, or everything once the person asked for all of them. */
export function visibleItems<T>(items: T[], n: number, showAll: boolean): T[] {
  return showAll ? items : items.slice(0, n);
}

export const TONE_TEXT: Record<Tone, string> = { ok: "text-emerald-300", warn: "text-amber-300", bad: "text-rose-300", idle: "text-zinc-400" };
export const TONE_DOT: Record<Tone, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400", idle: "bg-zinc-500" };
export const TONE_BORDER: Record<Tone, string> = { ok: "border-emerald-500/30", warn: "border-amber-500/40", bad: "border-rose-500/40", idle: "border-white/15" };

/** "5m ago" style age for the decision list. */
export function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
