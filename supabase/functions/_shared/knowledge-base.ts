// "Knowledge & autonomy" plan, item 1: give NazAI a real, editable
// knowledge base for judging decisions -- authored facts and standing
// instructions an account writes in plain English, injected straight
// into the AI's judgment prompt. Distinct from hard_rules/safety_rules
// (deterministic pattern rules the LLM never reads or interprets) and
// from business_profiles (auto-researched company info, not authored
// guidance) -- confirmed by research that nothing like this exists
// anywhere in this codebase today.
//
// Mirrors hard_rules' own scoping shape (action_type_pattern/provider,
// both optional -- null means "applies to everything" for that
// dimension) and reuses action-type-policy.ts's own
// matchesActionTypePattern glob matcher rather than a third pattern-
// matching implementation.
import { matchesActionTypePattern } from "./action-type-policy.ts";

export type KnowledgeBaseEntry = {
  id: string;
  entry_text: string;
  action_type_pattern: string | null;
  provider: string | null;
};

/**
 * Pure -- does this entry apply to the given decision's action_type/
 * provider? A null scope on either field means "applies to everything"
 * for that dimension -- the same "no pattern = matches all" convention
 * hard_rules' own action_type_pattern already uses via globToRe's `*`
 * default.
 */
export function matchesKnowledgeBaseEntry(
  entry: { action_type_pattern: string | null; provider: string | null },
  actionType: string,
  provider: string,
): boolean {
  if (entry.action_type_pattern && !matchesActionTypePattern(entry.action_type_pattern, actionType)) return false;
  if (entry.provider && entry.provider.toLowerCase() !== provider.toLowerCase()) return false;
  return true;
}

/** Pure -- filters a full list of an account's knowledge-base entries down to the ones relevant to this exact decision. */
export function selectRelevantKnowledgeBaseEntries(
  entries: KnowledgeBaseEntry[],
  actionType: string,
  provider: string,
): KnowledgeBaseEntry[] {
  return entries.filter((e) => matchesKnowledgeBaseEntry(e, actionType, provider));
}

// Same order of magnitude as precedent-prompt.ts's own MAX_PROMPT_ROWS
// -- enough real context to matter, small enough to never dominate the
// prompt over the account's own business profile and real precedent.
const MAX_PROMPT_ENTRIES = 12;

/**
 * Pure -- builds the prompt block, or "" when there's nothing relevant
 * (never injects an empty/misleading section header) -- same shape as
 * precedent-prompt.ts's buildPrecedentPromptBlock.
 */
export function buildKnowledgeBasePromptBlock(entries: KnowledgeBaseEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.slice(0, MAX_PROMPT_ENTRIES).map((e) => `- ${e.entry_text.slice(0, 500)}`);
  return (
    `\n# ACCOUNT KNOWLEDGE (facts and standing instructions this account has told NazAI directly)\n` +
    `${lines.join("\n")}\n` +
    `Treat this as genuine, current context for this account -- weigh it in your intent/risk/fit judgment, ` +
    `the same way you weigh the business profile above.\n`
  );
}
