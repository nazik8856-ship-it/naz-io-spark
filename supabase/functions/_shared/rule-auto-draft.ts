// "Policy autonomy" plan, item 9: auto-draft a new hard rule from a
// strong recurring precedent pattern.
//
// If real precedent already shows an API key's requests of one EXACT
// shape (the same action_type + provider) have been decided the exact
// same way -- blocked -- over and over, that's effectively an unwritten
// rule already. This turns that repetition into a real hard_rules row
// automatically, ALWAYS in shadow mode (hard_rules already has real,
// working shadow-mode infrastructure from a prior round -- shadow_mode,
// promoted_at, hard_rule_shadow_hits -- this inserts directly into that
// existing table and reuses that existing promotion path, never a second
// shadow mechanism), so a human reviews and promotes a pattern that's
// already proven itself instead of writing it from scratch.
//
// Deliberately scoped to consistent BLOCK decisions only, never
// "require_approval"/escalation patterns: a block is already NazAI's own
// settled verdict of "no" -- drafting a rule that generalizes it is safe.
// A frequently-ESCALATED action, by contrast, was only ever sent for a
// human or policy to judge -- some of those escalations may well have
// been approved -- so drafting a blanket always_require_approval rule
// from raw escalation frequency alone would claim more consistency than
// the data actually shows. That stays out of scope for this feature.
//
// Grouped by the literal, exact (action_type, provider) pair -- not a
// semantic/embedding similarity search. "Requests of one exact shape"
// (the plan's own wording) is a literal category match here, deliberately
// simpler than precedent-search.ts's fuzzy embedding similarity: every
// row counted for a group is ALREADY a real, confirmed block for that
// exact shape, so a plain count against the threshold below is itself
// the "real, real similarity/repetition threshold" this needs -- no
// separate consistency-RATE computation on top, since there's no mixed
// outcome to weigh (every input row here is a block, by construction of
// what the caller queries).
export type DecisionRow = { action_type: string; provider: string | null };

export type RecurringBlockPattern = {
  action_type: string;
  provider: string | null;
  sample_size: number;
};

/** Real, documented, tunable threshold: how many real, confirmed blocks
 * of the exact same (action_type, provider) shape, within the sweep's own
 * lookback window, count as a strong enough recurring pattern to draft a
 * shadow-mode rule from. Deliberately not tiny -- a one-off or two-off
 * block is normal, expected gate behavior, not yet a "pattern." */
export const MIN_SAMPLE_FOR_AUTO_DRAFT = 10;

/**
 * Pure -- groups a batch of real, already-confirmed BLOCK decisions
 * (scoped by the caller to one account + one api key) by their exact
 * (action_type, provider) shape, and returns every group whose sample
 * size crosses the threshold, largest pattern first.
 */
export function detectRecurringBlockPatterns(
  rows: DecisionRow[],
  minSample: number = MIN_SAMPLE_FOR_AUTO_DRAFT,
): RecurringBlockPattern[] {
  const counts = new Map<string, { action_type: string; provider: string | null; count: number }>();
  for (const r of rows) {
    if (!r.action_type) continue;
    const key = `${r.action_type}::${r.provider ?? ""}`;
    const existing = counts.get(key) ?? { action_type: r.action_type, provider: r.provider ?? null, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  }
  return [...counts.values()]
    .filter((g) => g.count >= minSample)
    .map((g) => ({ action_type: g.action_type, provider: g.provider, sample_size: g.count }))
    .sort((a, b) => b.sample_size - a.sample_size);
}

export type DraftedRule = {
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block";
  provider: string | null;
  shadow_mode: true;
  rationale: string;
};

/**
 * Pure -- builds the actual hard_rules insert fields for one detected
 * pattern. Gets a real rationale (item 1's field) at draft time, same as
 * every other rule going forward, naming exactly how many real blocks
 * this was drafted from so a reviewing human can judge it on real
 * evidence, not just trust the rule blindly.
 */
export function draftRuleFromPattern(pattern: RecurringBlockPattern): DraftedRule {
  const scope = pattern.provider ? `${pattern.action_type} on ${pattern.provider}` : pattern.action_type;
  return {
    rule_text: `Auto-drafted: block ${scope}`,
    action_type_pattern: pattern.action_type,
    effect: "always_block",
    provider: pattern.provider,
    shadow_mode: true,
    rationale:
      `Auto-drafted in shadow mode: NazAI blocked ${pattern.sample_size} real "${scope}" action(s) in a row with no exception. ` +
      `Review the shadow hits below and promote this rule if it matches your intent.`,
  };
}
