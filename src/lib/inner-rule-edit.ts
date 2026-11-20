// Inner Control: changing a rule that exists (Edit), and telling the truth about every rule write.
//
// A write the database's row rules refuse does not fail: it changes nothing and returns no error. So every update and delete asks
// for the rows it changed (.select("id")) and writeOutcome turns "no row changed" into an error the person can act on, instead of a
// "Rule disabled" that is not true. Pure, no dependencies besides the shared pattern check.
import { findPatternProblem } from "@/lib/safety-pattern";
import { SCOPE_LABELS, type HardRuleRow, type SafetyRuleRow } from "@/lib/inner-control-ui";

/** What a write that changed nothing means for the person, and what to do. */
export const NOTHING_CHANGED =
  "Nothing was changed. Your role may not allow changing this account's rules, or two-step sign-in is needed: sign in again with your authenticator and retry.";

type WriteResult = { data?: unknown; error?: { message?: string } | null };
/** The outcome of an update or delete that asked for the rows it changed. */
export function writeOutcome(res: WriteResult): { ok: true } | { ok: false; message: string } {
  if (res.error) return { ok: false, message: res.error.message || "The change could not be saved." };
  const rows = Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0;
  return rows > 0 ? { ok: true } : { ok: false, message: NOTHING_CHANGED };
}

// ---- Hard rules: stop or hold an action

export type HardEffect = HardRuleRow["effect"];
export type HardEdit = { text: string; scope: string; effect: HardEffect; approvals: number };

export const MAX_RULE_TEXT = 500;
export const MAX_SCOPE = 100;

export const hardEditOf = (r: Pick<HardRuleRow, "rule_text" | "action_type_pattern" | "effect" | "required_approvals">): HardEdit =>
  ({ text: r.rule_text, scope: r.action_type_pattern || "*", effect: r.effect, approvals: r.required_approvals ?? 1 });

export function hardEditProblem(e: HardEdit): string | null {
  const t = e.text.trim();
  if (t.length < 3) return "Describe the rule in a few words.";
  if (t.length > MAX_RULE_TEXT) return `Keep the rule under ${MAX_RULE_TEXT} characters.`;
  const s = e.scope.trim();
  if (!s) return "Choose which actions the rule applies to.";
  if (s.length > MAX_SCOPE || !/^[A-Za-z0-9_*.:-]+$/.test(s)) return "The action pattern may use letters, digits, _ . : - and * only.";
  if (e.effect !== "always_block" && e.effect !== "always_require_approval") return "Choose what the rule does.";
  if (e.effect === "always_require_approval" && !(Number.isInteger(e.approvals) && e.approvals >= 1 && e.approvals <= 5)) return "Approvals must be between 1 and 5.";
  return null;
}

/** The columns an edit writes (the same ones the Add form writes). */
export const hardPatch = (e: HardEdit) => ({
  rule_text: e.text.trim(), action_type_pattern: e.scope.trim(), effect: e.effect,
  required_approvals: e.effect === "always_require_approval" ? e.approvals : null,
});

export const SCOPE_CHOICES = Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label }));

// ---- Safety rules: find text in a reply

export type SafetyAction = "approval" | "block" | "redact";
export const SAFETY_ACTION_FIELDS: Record<SafetyAction, { severity: SafetyRuleRow["severity"]; redact: boolean }> = {
  approval: { severity: "require_approval", redact: false },
  block: { severity: "block", redact: false },
  redact: { severity: "block", redact: true },
};
export const SAFETY_ACTION_LABEL: Record<SafetyAction, string> = {
  approval: "Hold it for approval", block: "Block the reply", redact: "Remove the matching text",
};
export const safetyActionOf = (r: Pick<SafetyRuleRow, "severity" | "redact">): SafetyAction =>
  r.redact ? "redact" : r.severity === "block" ? "block" : "approval";

export type SafetyEdit = { name: string; pattern: string; action: SafetyAction };
export const safetyEditOf = (r: Pick<SafetyRuleRow, "name" | "pattern" | "severity" | "redact">): SafetyEdit =>
  ({ name: r.name, pattern: r.pattern, action: safetyActionOf(r) });

export function safetyEditProblem(e: SafetyEdit): string | null {
  const n = e.name.trim();
  if (!n) return "Give the rule a name.";
  if (n.length > 120) return "Keep the name under 120 characters.";
  if (!e.pattern.trim()) return "Give the text pattern to look for.";
  return findPatternProblem(e.pattern.trim());
}

export const safetyPatch = (e: SafetyEdit) => ({ name: e.name.trim(), pattern: e.pattern.trim(), ...SAFETY_ACTION_FIELDS[e.action] });

// ---- Rules in plain words: an AI judge reads each reply against them and must quote the words that break one

export type MeaningAction = "block" | "approval" | "remove";
export type MeaningEdit = { name: string; description: string; action: MeaningAction };
export const MEANING_ACTION_LABEL: Record<MeaningAction, string> = {
  block: "Block the reply", approval: "Hold it for approval", remove: "Remove the words that break it",
};
export const MAX_MEANING_NAME = 120;
export const MAX_MEANING_DESCRIPTION = 500;
export const meaningEditOf = (r: { name: string; description: string; action: MeaningAction }): MeaningEdit =>
  ({ name: r.name, description: r.description, action: r.action });

/** The same limits the database keeps (meaning_rules: name 1-120, description 3-500). */
export function meaningEditProblem(e: MeaningEdit): string | null {
  const d = e.description.trim();
  if (d.length < 3) return "Say in plain words what a reply must never do.";
  if (d.length > MAX_MEANING_DESCRIPTION) return `Keep the rule under ${MAX_MEANING_DESCRIPTION} characters.`;
  const n = e.name.trim();
  if (!n) return "Give the rule a name.";
  if (n.length > MAX_MEANING_NAME) return `Keep the name under ${MAX_MEANING_NAME} characters.`;
  if (!(e.action in MEANING_ACTION_LABEL)) return "Choose what happens when a reply breaks it.";
  return null;
}

export const meaningPatch = (e: MeaningEdit) => ({ name: e.name.trim(), description: e.description.trim().replace(/\s+/g, " "), action: e.action });
