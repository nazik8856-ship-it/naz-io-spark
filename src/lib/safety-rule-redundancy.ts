// Safety-rule redundancy detector (2026-08-23) — the hard-rule conflict
// detector's core concept ("first match wins, the second rule is silently
// shadowed") does NOT transfer here: scanWithRules evaluates every rule
// and returns the WORST severity across all matches, so two overlapping
// safety rules never silently shadow each other the way hard rules do.
// General regex-overlap detection between two arbitrary patterns is also
// impractical (undecidable in the general case).
//
// Scoped down instead to what's actually checkable and useful: two
// enabled, non-shadow custom safety rules with an EXACT (or
// whitespace/case-only) duplicate pattern but different severities always
// co-fire together. Since scanWithRules takes the worst severity across
// every match, the lower-severity rule's contribution is then always moot
// whenever both fire — informational ("these always co-fire, one is
// redundant"), not a correctness-bug detector like the hard-rule case.
//
// Note: SafetyRule (the pure type scanWithRules itself uses, in
// supabase/functions/_shared/safety-scanner.ts) has no created_at -- this
// sources ordering from the DB row shape instead, same as the hard-rule
// detector already does with HardRuleForConflict.

/** Normalizes a pattern for exact/near-duplicate comparison — trims and
 * lowercases, since two regexes that differ only in whitespace or case
 * are functionally the same pattern for this purpose. */
function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

export type SafetyRuleForRedundancy = {
  id: string;
  name: string;
  category: string;
  pattern: string;
  severity: "block" | "require_approval";
  enabled?: boolean;
  shadow_mode?: boolean;
  created_at: string;
};

export type SafetyRuleRedundancy = {
  older: SafetyRuleForRedundancy;
  newer: SafetyRuleForRedundancy;
};

/**
 * Pure — pairs of live (enabled, non-shadow) custom safety rules whose
 * patterns are an exact or near-duplicate (same regex source, ignoring
 * case/whitespace) but whose severities differ. Both rules still fire on
 * every match (unlike hard rules, nothing is shadowed) — this is purely
 * informational, flagging the newer rule's severity as redundant given
 * the older one already co-fires at a severity that's equal or worse.
 */
export function findSafetyRuleRedundancies(rules: SafetyRuleForRedundancy[]): SafetyRuleRedundancy[] {
  const live = rules
    .filter((r) => r.enabled !== false && !r.shadow_mode)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const redundancies: SafetyRuleRedundancy[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const older = live[i];
      const newer = live[j];
      if (older.severity === newer.severity) continue;
      if (normalizePattern(older.pattern) !== normalizePattern(newer.pattern)) continue;
      redundancies.push({ older, newer });
    }
  }
  return redundancies;
}
