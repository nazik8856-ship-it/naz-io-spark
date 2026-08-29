// "Knowledge & autonomy" plan, item 3: if humans keep resolving the same
// shape of escalated decision (the same action_type + provider) for the
// same structured reason (item 2's reason_code), that's a real,
// recurring gap in what NazAI knows -- not yet a hard rule (nothing
// here is a deterministic yes/no), but exactly the shape of thing a
// knowledge-base entry (item 1) should say. Drafts a candidate entry
// automatically for a human to review and enable -- the same "detect a
// real recurring pattern past a real threshold, draft it, let a human
// confirm" shape the prior round's rule-auto-draft.ts already proved
// out, applied here to (action_type, provider, reason_code) instead of
// (action_type, provider, block).
import { isValidOverrideReasonCode, describeOverrideReasonCode, type OverrideReasonCode } from "./override-reason.ts";

export type ReasonCodedResolution = { action_type: string; provider: string | null; reason_code: string | null };

export type RecurringReasonPattern = {
  action_type: string;
  provider: string | null;
  reason_code: OverrideReasonCode;
  sample_size: number;
};

// Deliberately lower than rule-auto-draft.ts's own MIN_SAMPLE_FOR_AUTO_DRAFT
// (10): a human resolution with a recorded reason is a much higher-
// signal event than a raw automated block -- it required real human
// attention, and a real, recurring reason code across even a handful of
// them is worth surfacing.
export const MIN_SAMPLE_FOR_KB_AUTO_DRAFT = 5;

/**
 * Pure -- groups a batch of reason-coded human resolutions (scoped by
 * the caller to one account) by the exact (action_type, provider,
 * reason_code) shape, and returns every group whose sample size crosses
 * the threshold, largest pattern first. Rows with no reason_code, or an
 * unrecognized one, are ignored -- there's no real category to draft
 * guidance from.
 */
export function detectRecurringReasonPatterns(
  rows: ReasonCodedResolution[],
  minSample: number = MIN_SAMPLE_FOR_KB_AUTO_DRAFT,
): RecurringReasonPattern[] {
  const counts = new Map<string, { action_type: string; provider: string | null; reason_code: OverrideReasonCode; count: number }>();
  for (const r of rows) {
    if (!r.action_type || !isValidOverrideReasonCode(r.reason_code)) continue;
    const key = `${r.action_type}::${r.provider ?? ""}::${r.reason_code}`;
    const existing = counts.get(key) ?? { action_type: r.action_type, provider: r.provider ?? null, reason_code: r.reason_code, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  }
  return [...counts.values()]
    .filter((g) => g.count >= minSample)
    .map((g) => ({ action_type: g.action_type, provider: g.provider, reason_code: g.reason_code, sample_size: g.count }))
    .sort((a, b) => b.sample_size - a.sample_size);
}

export type DraftedKnowledgeBaseEntry = {
  entry_text: string;
  action_type_pattern: string;
  provider: string | null;
  enabled: false;
  pending_review: true;
  auto_drafted: true;
};

/**
 * Pure -- builds the actual knowledge_base_entries insert fields for one
 * detected pattern. Always inserted disabled and pending review (see
 * the migration) -- a human confirms before this ever reaches the live
 * judgment prompt.
 */
export function draftKnowledgeBaseEntryFromPattern(pattern: RecurringReasonPattern): DraftedKnowledgeBaseEntry {
  const scope = pattern.provider ? `${pattern.action_type} on ${pattern.provider}` : pattern.action_type;
  return {
    entry_text:
      `Auto-suggested from ${pattern.sample_size} real human decisions: for "${scope}", a human has repeatedly ` +
      `stepped in because ${describeOverrideReasonCode(pattern.reason_code)}. Review and rewrite this into real, ` +
      `specific guidance before enabling it -- this draft only names the recurring pattern, not the actual fix.`,
    action_type_pattern: pattern.action_type,
    provider: pattern.provider,
    enabled: false,
    pending_review: true,
    auto_drafted: true,
  };
}
