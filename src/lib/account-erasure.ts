// Account erasure (docs/account-erasure.md): the words the screen uses, and the one check before the button works.

/** What the person must type to confirm. */
export const ERASE_CONFIRM_WORD = "DELETE MY ACCOUNT";

export function canRequestErasure(typed: string): boolean {
  return String(typed ?? "").trim().toUpperCase() === ERASE_CONFIRM_WORD;
}

/** Whole days left until the erasure runs (never negative). */
export function daysUntil(executeAt: string, now: Date = new Date()): number {
  const ms = new Date(executeAt).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : 0;
}

export function erasureErrorText(message: string | null | undefined): string {
  const m = String(message ?? "").toLowerCase();
  if (m.includes("two-step")) return "Confirm with a code from your authenticator app first, then try again.";
  if (m.includes("staff")) return "This account manages NazAI itself and can not be deleted here.";
  if (m.includes("not authenticated")) return "Your session has ended. Sign in again.";
  return "Something went wrong. Try again.";
}

export const ERASE_REMOVES = [
  "your agents, websites, projects, missions and everything in them",
  "your Control System data: decisions, rules, incidents, approvals, spend history",
  "your connected tools (their access is cancelled at the provider) and every key stored for them",
  "your API keys, team members you invited, and the record of your credits",
  "your sign-in itself, including two-step sign-in and recovery codes",
];

export const ERASE_KEEPS = [
  "an address on the do-not-email list if you ever unsubscribed (so we keep honouring it)",
  "encrypted daily backups for up to 30 days, then they are deleted",
  "records we must keep by law, if any (for example invoices once payments exist)",
  "a note that an account was erased, with the date and row counts, and nothing that names you",
];
