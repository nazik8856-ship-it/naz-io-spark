// Inner Control chat: "never mention prices to customers" becomes a drafted rule the person sees and saves with one tap
// (docs/inner-control.md). The chat never saves a rule itself: it returns a draft (mode "rule_draft"), and the page saves it through
// the same table write the Add forms use, so the account's own row rules and the Add forms' checks apply.
//
// Two kinds, the same two the rules list has:
//   action  stop or hold an action (hard_rules): what it says, which actions, block or hold for approval
//   text    find words in a reply (safety_rules): the words or phrases to look for, and block / hold / remove them
// For a text rule the AI only names words and phrases; NazAI builds the pattern from them (escaped, whole words, case-insensitive
// as the scanner matches), so no pattern the AI wrote is ever stored. Pure.

/** Which actions an action rule applies to: the same choices as the Add form (SCOPE_LABELS in src/lib/inner-control-ui.ts). */
export const RULE_SCOPES: Record<string, string> = {
  "*": "Any action", send_email: "Sending email", reply_email: "Replying to email", "slack_*": "Posting to Slack",
  "notion_*": "Notion writes", "canva_*": "Canva writes", "shopify_*": "Shopify writes", "figma_*": "Figma writes",
  create_calendar_event: "Calendar events", "*_doc*": "Docs & sheets",
};

export type TextAction = "approval" | "block" | "redact";
export const TEXT_ACTION_WORDS: Record<TextAction, string> = {
  approval: "holds the reply for your approval", block: "blocks the reply", redact: "removes the matching words from the reply",
};

export type RuleDraft =
  | { type: "action"; text: string; scope: string; effect: "always_block" | "always_require_approval" }
  | { type: "text"; name: string; phrases: string[]; pattern: string; action: TextAction };

const MAX_PHRASES = 12;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The pattern for a list of words and phrases: each escaped, matched as a whole word where it starts or ends with a letter or digit,
 * spaces matching any run of spaces, longest first. Never empty, never matches empty text.
 */
export function phrasesPattern(phrases: string[]): string {
  const parts = [...phrases].sort((a, b) => b.length - a.length).map((p) => {
    const body = escape(p).replace(/\s+/g, "\\s+");
    const pre = /^[A-Za-z0-9]/.test(p) ? "(?<![A-Za-z0-9])" : "";
    const post = /[A-Za-z0-9]$/.test(p) ? "(?![A-Za-z0-9])" : "";
    return `${pre}${body}${post}`;
  });
  return `(?:${parts.join("|")})`;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The AI's tool arguments as a draft the page can show and save, or why it can not be one. */
export function draftFromArgs(a: Record<string, unknown>): { ok: true; draft: RuleDraft } | { ok: false; reason: string } {
  if (a.type === "text") {
    const name = clean(a.name, 120);
    const raw = Array.isArray(a.phrases) ? a.phrases : [];
    const phrases = [...new Set(raw.map((p) => clean(p, 60)).filter((p) => p.length >= 2 || /^[^A-Za-z0-9\s]$/.test(p)).map((p) => p.toLowerCase()))].slice(0, MAX_PHRASES);
    if (!phrases.length) return { ok: false, reason: "Tell me the words or phrases the rule should look for (for example: price, discount, €)." };
    const action: TextAction = a.action === "approval" || a.action === "redact" ? a.action : "block";
    return { ok: true, draft: { type: "text", name: name || `Mentions ${phrases.slice(0, 3).join(", ")}`, phrases, pattern: phrasesPattern(phrases), action } };
  }
  const text = clean(a.text, 500);
  if (text.length < 3) return { ok: false, reason: "Tell me in a few words what the rule should stop or hold." };
  const scope = typeof a.scope === "string" && a.scope in RULE_SCOPES ? a.scope : "*";
  const effect = a.effect === "always_require_approval" ? "always_require_approval" : "always_block";
  return { ok: true, draft: { type: "action", text, scope, effect } };
}

/** The draft in plain words, for the chat. */
export function describeDraft(d: RuleDraft): string {
  if (d.type === "action") {
    return `New rule: “${d.text}”. It ${d.effect === "always_block" ? "blocks" : "holds for your approval"} ${RULE_SCOPES[d.scope] === "Any action" ? "any matching action" : `${RULE_SCOPES[d.scope].toLowerCase()}`}. Nothing is saved until you press Save.`;
  }
  return `New rule “${d.name}”: when a reply contains ${d.phrases.map((p) => `“${p}”`).join(", ")}, it ${TEXT_ACTION_WORDS[d.action]}. Nothing is saved until you press Save.`;
}
