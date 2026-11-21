// Clean it (Context Day 1): the website side. Pasted text from any AI goes to control-system-decide (action clean_text) and comes
// back as one result: the text to copy, what the checks found, what the rewrite changed, and whether it passed the re-check.
// The server is the source of truth for every check and for the free allowance; this file only calls it and words the result.
import { supabase, SUPABASE_ANON, SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/client";
import { posthog } from "@/lib/posthog";

export const FREE_CLEANS_PER_DAY = 15; // the server and the database hold the same number (src/test/context-clean.test.tsx)
export const MAX_CLEAN_CHARS = 8_000;

export const CLEAN_SOURCES = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "other", label: "Other" },
] as const;
export type CleanSource = typeof CLEAN_SOURCES[number]["id"];

export type Found = { kind: "rule" | "context"; name: string; quote: string | null; why: string; context_quote?: string | null };
export type Edit = { before: string; after: string; why: string };
export type CleanStatus = "clean" | "changed" | "flagged" | "held" | "blocked";
export type CleanResult = {
  status: CleanStatus;
  text: string | null;
  found: Found[];
  edits: Edit[];
  rewrite: "not_needed" | "passed" | "failed_check" | "unavailable";
  context: { name: string; checked: boolean } | null;
  summary: string;
  allowance: { used: number; limit: number } | null;
};

export type CleanOutcome =
  | { ok: true; result: CleanResult }
  | { ok: false; limit: boolean; message: string; resetsAt?: string | null };

/** How each result is titled on the card. */
export const STATUS_TITLE: Record<CleanStatus, string> = {
  clean: "Nothing to change",
  changed: "Cleaned",
  flagged: "Check before you use it",
  held: "A person should decide",
  blocked: "Blocked by your rules",
};

export async function cleanContext(input: { content: string; source: CleanSource; projectId: string | null; accountId: string | null }): Promise<CleanOutcome> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-system-decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action: "clean_text", content: input.content, source: input.source, project_id: input.projectId, account_id: input.accountId }),
    });
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (resp.status === 402 || data.error === "free_limit") {
      return { ok: false, limit: true, message: String(data.message || `Today's ${FREE_CLEANS_PER_DAY} free cleaned results are used.`), resetsAt: (data.resets_at as string) ?? null };
    }
    if (!resp.ok || data.mode !== "clean_result") {
      return { ok: false, limit: false, message: String(data.message || data.error || "The text could not be cleaned. Try again.") };
    }
    return { ok: true, result: data as unknown as CleanResult };
  } catch {
    return { ok: false, limit: false, message: "Could not reach NazAI. Try again." };
  }
}

/** "12 of 15 left today", or null for an account without a daily limit. */
export function allowanceLine(a: CleanResult["allowance"]): string | null {
  if (!a || !a.limit) return null;
  const left = Math.max(0, a.limit - a.used);
  return `${left} of ${a.limit} free cleans left today`;
}

// ---- Your context: which project Clean it uses, remembered on this device (an id only) -------------------------------------
export const CONTEXT_NAME = "My AI context";
export function rememberedContext(accountId: string | null, projectIds: string[], namesById: Record<string, string>): string | null {
  if (!accountId) return null;
  let saved: string | null = null;
  try { saved = window.localStorage.getItem(`nazai_clean_context:${accountId}`); } catch { /* storage blocked */ }
  if (saved === "none") return null;
  if (saved && projectIds.includes(saved)) return saved;
  return projectIds.find((id) => namesById[id] === CONTEXT_NAME) ?? null;
}
export function rememberContext(accountId: string | null, projectId: string | null) {
  if (!accountId) return;
  try { window.localStorage.setItem(`nazai_clean_context:${accountId}`, projectId ?? "none"); } catch { /* storage blocked */ }
}

/** Where people find what their AI already knows about them (shown when adding context). */
export const CONTEXT_SOURCES_HELP = [
  { tool: "ChatGPT", where: "Settings → Personalization → Custom instructions, and Settings → Personalization → Memory → Manage." },
  { tool: "Claude", where: "A Project's instructions and its knowledge files, or Settings → Profile." },
  { tool: "Gemini", where: "Settings → Saved info." },
] as const;

// ---- Starter rules for AI output: offered once, saved only when the person adds them -------------------------------------
export const STARTER_RULES = [
  { name: "No invented numbers", description: "Statistics, prices, dates or figures that are not given in the text's own source or the person's context.", action: "remove" as const },
  { name: "No promises", description: "Promising a delivery date, a refund, a result or a guarantee.", action: "remove" as const },
  { name: "No professional advice as fact", description: "Legal, medical or financial advice stated as certain fact.", action: "approval" as const },
];

// ---- Measurement (PostHog): counts and labels only, never the text -------------------------------------------------------
export function trackClean(event: "context_checked" | "result_copied" | "context_added" | "starter_rules_added", props: Record<string, string | number | boolean | null> = {}) {
  try { posthog.capture(event, props); } catch { /* analytics never breaks the page */ }
}
