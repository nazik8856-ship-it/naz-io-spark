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

/** The shape of a result (Context Day 2); the server reshapes only after the clean and checks the new shape again. */
export const CLEAN_FORMATS = [
  { id: "as_pasted", label: "As pasted" },
  { id: "email", label: "Email" },
  { id: "short", label: "Short message" },
  { id: "bullets", label: "Bullet points" },
] as const;
export type CleanFormat = typeof CLEAN_FORMATS[number]["id"];

export type Found = { kind: "rule" | "context"; name: string; quote: string | null; why: string; context_quote?: string | null };
export type Edit = { before: string; after: string; why: string };
export type CleanStatus = "clean" | "changed" | "flagged" | "held" | "blocked";
export type CleanResult = {
  status: CleanStatus;
  text: string | null;
  found: Found[];
  edits: Edit[];
  rewrite: "not_needed" | "passed" | "failed_check" | "unavailable";
  /** How many rules the text was checked against (text rules, built-in protection, rules in plain words). */
  rules_applied?: number;
  /** used / total: characters of the context that were read, out of all of it. */
  context: { name: string; checked: boolean; used?: number; total?: number } | null;
  summary: string;
  allowance: { used: number; limit: number } | null;
  /** The shape it is in ("as_pasted" also when a reshaped version did not pass: format_note says why). */
  format?: CleanFormat;
  email?: { subject: string; body: string };
  format_note?: string;
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

export async function cleanContext(input: { content: string; source: CleanSource; projectId: string | null; accountId: string | null; format?: CleanFormat }): Promise<CleanOutcome> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-system-decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action: "clean_text", content: input.content, source: input.source, project_id: input.projectId, account_id: input.accountId, format: input.format ?? "as_pasted" }),
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

/** A result NazAI stands behind: it passed the account's rules (as it was, or rewritten and checked again, or cut by the rules). */
export const isControlled = (r: CleanResult) => (r.status === "clean" || r.status === "changed") && r.text !== null;

/**
 * The Rule Application Trail under a result: "3 rules applied → 2 fixes made → 1 item blocked".
 * Fixes: words the rewrite replaced. Blocked: words removed, or the whole text when the rules blocked or held it.
 */
export function trailOf(r: CleanResult): { rules: number; fixes: number; blocked: number } {
  const replaced = r.edits.filter((e) => e.after.trim()).length;
  const removed = r.edits.filter((e) => !e.after.trim()).length;
  const ruleFindings = r.found.filter((f) => f.kind === "rule").length;
  const cutByRules = r.status === "changed" && r.edits.length === 0 ? ruleFindings : 0;
  const stopped = r.status === "blocked" || r.status === "held" ? Math.max(1, ruleFindings) : 0;
  return { rules: Math.max(0, r.rules_applied ?? 0), fixes: replaced, blocked: removed + cutByRules + stopped };
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "4.2s": how long the clean took, shown while it runs and on the seal. */
export const secondsLabel = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;

/** How much of a context a clean reads (the weight indicator next to it): lengths only, never the text. */
export async function contextWeight(projectId: string, accountId: string | null): Promise<{ used: number; total: number; limit: number } | null> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-system-decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action: "context_weight", project_id: projectId, account_id: accountId }),
    });
    const d = await resp.json().catch(() => ({})) as { mode?: string; used?: number; total?: number; limit?: number };
    if (!resp.ok || d.mode !== "context_weight") return null;
    return { used: Number(d.used ?? 0), total: Number(d.total ?? 0), limit: Number(d.limit ?? 6000) };
  } catch {
    return null;
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
export function trackClean(event: "context_checked" | "result_copied" | "context_added" | "starter_rules_added" | "email_opened", props: Record<string, string | number | boolean | null> = {}) {
  try { posthog.capture(event, props); } catch { /* analytics never breaks the page */ }
}

// ---- Formats on this device: the shape last chosen (a label only, never text) ----------------------------------------------
export function rememberedFormat(): CleanFormat {
  let v: string | null = null;
  try { v = window.localStorage.getItem("nazai_clean_format"); } catch { /* storage blocked */ }
  return (CLEAN_FORMATS.map((f) => f.id) as string[]).includes(v ?? "") ? v as CleanFormat : "as_pasted";
}
export function rememberFormat(f: CleanFormat) {
  try { window.localStorage.setItem("nazai_clean_format", f); } catch { /* storage blocked */ }
}

// ---- Light text structure: paragraphs, "- " lists and **bold**, for showing a result and for "Copy formatted" --------------
export type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };
export function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    let para: string[] = [];
    let list: string[] = [];
    const flushP = () => { if (para.length) { out.push({ kind: "p", lines: para }); para = []; } };
    const flushL = () => { if (list.length) { out.push({ kind: "ul", items: list }); list = []; } };
    for (const l of lines) {
      const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) { flushP(); list.push(m[1]); } else { flushL(); para.push(l); }
    }
    flushP(); flushL();
  }
  return out;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inlineHtml = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
/** HTML for "Copy formatted": escaped, with paragraphs, lists and bold kept (pastes formatted into email, Docs, Notion, Slack). */
export function toHtml(text: string, subject?: string): string {
  const body = blocksOf(text).map((b) => b.kind === "ul"
    ? `<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ul>`
    : `<p>${b.lines.map(inlineHtml).join("<br>")}</p>`).join("");
  return (subject ? `<p><strong>${esc(subject)}</strong></p>` : "") + body;
}
/** Plain text for "Copy": an email gets its subject line on top; **bold** markers are dropped. */
export function toPlain(text: string, subject?: string): string {
  const body = text.replace(/\*\*(.+?)\*\*/g, "$1");
  return subject ? `Subject: ${subject}\n\n${body}` : body;
}

// ---- Send: NazAI opens the person's own mail with everything filled in (it never sends as them) ----------------------------
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const q = (v: string) => encodeURIComponent(v);
export function mailLinks(m: { from: string; to: string; subject: string; body: string }) {
  const personal = /@(outlook|hotmail|live|msn)\./i.test(m.from);
  return {
    gmail: `https://mail.google.com/mail/?authuser=${q(m.from)}&view=cm&fs=1&to=${q(m.to)}&su=${q(m.subject)}&body=${q(m.body)}`,
    outlook: `https://${personal ? "outlook.live.com/mail/0" : "outlook.office.com/mail"}/deeplink/compose?to=${q(m.to)}&subject=${q(m.subject)}&body=${q(m.body)}`,
    mailto: `mailto:${q(m.to)}?subject=${q(m.subject)}&body=${q(m.body)}`,
  };
}

// ---- Structured context (sorted on the server; the person edits; saved with a heading per part) ----------------------------
export const CONTEXT_SECTIONS = [
  { key: "facts", title: "Facts", hint: "Who you are, what you sell, prices, places, dates, names." },
  { key: "policies", title: "Policies", hint: "Refunds, delivery, returns, guarantees, what you do and do not offer." },
  { key: "tone", title: "Tone", hint: "How you write: formal or casual, length, words you like, sign-off." },
  { key: "never_say", title: "Never say", hint: "Promises, claims, words or topics your replies must never contain." },
] as const;
export type SectionKey = typeof CONTEXT_SECTIONS[number]["key"];
export type StructuredContext = Record<SectionKey, string[]>;
const cleanItem = (v: string) => v.replace(/^[\s\-•*·]+/, "").replace(/\s+/g, " ").trim().slice(0, 300);
/** The same text the server saves (supabase/functions/_shared/context-structure.ts, composeContext; a test compares them). */
export function composeContext(s: StructuredContext): string {
  return CONTEXT_SECTIONS
    .filter(({ key }) => s[key]?.length)
    .map(({ key, title }) => `## ${title}\n${s[key].map((i) => `- ${cleanItem(i)}`).join("\n")}`)
    .join("\n\n");
}
export function parseContextSections(text: string | null | undefined): StructuredContext | null {
  if (!text) return null;
  const out: StructuredContext = { facts: [], policies: [], tone: [], never_say: [] };
  let current: SectionKey | null = null;
  let any = false;
  for (const line of text.split("\n")) {
    const h = /^\s*##\s+(.+?)\s*$/.exec(line);
    if (h) { const f = CONTEXT_SECTIONS.find((c) => c.title.toLowerCase() === h[1].toLowerCase()); current = f ? f.key : null; if (f) any = true; continue; }
    if (current && /^\s*[-•*]\s+/.test(line)) { const item = cleanItem(line); if (item) out[current].push(item); }
  }
  return any ? out : null;
}
export async function structureContext(text: string, accountId: string | null): Promise<{ ok: true; sections: StructuredContext; discarded: number; hidden: { name: string; count: number }[] } | { ok: false; message: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-system-decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action: "structure_context", text, account_id: accountId }),
    });
    const d = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (!resp.ok || d.mode !== "context_structure") return { ok: false, message: String(d.message || "Your context could not be sorted right now. You can still save it as it is.") };
    return { ok: true, sections: d.sections as StructuredContext, discarded: Number(d.discarded ?? 0), hidden: (d.hidden as { name: string; count: number }[]) ?? [] };
  } catch {
    return { ok: false, message: "Could not reach NazAI. Try again." };
  }
}
