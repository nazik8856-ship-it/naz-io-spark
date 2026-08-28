// "Policy autonomy" plan, item 10: break down an API key's auto-resolve
// trust by action type, instead of one blanket on_uncertain policy for
// every kind of action that key ever sends -- confidently automated for
// a routine action, still requiring review for a risky one, without
// needing an entirely separate API key for each.
//
// Deliberately a lightweight override LIST layered on top of the
// existing blanket on_uncertain column, not a full parallel policy
// system: an action-type-specific override, when its pattern matches,
// replaces the blanket default for THIS decision only -- every other
// decision this key sends, with no matching override, keeps using the
// blanket policy exactly as it does today. No existing policy-lookup
// call site's return SHAPE changes: a caller still gets back a single
// plain policy string, just possibly a different one than the key's own
// blanket column depending on which action_type this particular decision
// was for.
export type ActionTypeOverride = {
  action_type_pattern: string;
  on_uncertain: string;
  // "Knowledge & autonomy" plan, item 9: a SEPARATE, optional override on
  // the same row -- a row can set an on_uncertain override, a confidence-
  // threshold override, or both. null/undefined means this row carries no
  // threshold override at all (every row that predates this item), so
  // resolveEffectiveConfidenceThreshold below correctly skips it rather
  // than treating "unset" as "threshold zero."
  confidence_threshold?: number | null;
};

// Same "*"-wildcard, case-insensitive glob convention hard_rules'
// action_type_pattern already uses (policy-replay.ts's globToRe) -- an
// account configuring one already knows how the other behaves.
const globToRe = (pattern: string): RegExp =>
  new RegExp(
    "^" + pattern.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );

/** Pure -- does this override's action_type_pattern match a real decision's action_type? An invalid pattern (bad regex) never matches, rather than throwing. */
export function matchesActionTypePattern(pattern: string, actionType: string): boolean {
  try {
    return globToRe(pattern).test(actionType);
  } catch {
    return false;
  }
}

export type EffectiveOnUncertain = { policy: string | null; matchedOverride: ActionTypeOverride | null };

/**
 * Pure -- the on_uncertain value that actually governs one decision: the
 * first configured override whose pattern matches this action_type, or
 * the key's own blanket policy when none matches. Overrides are checked
 * in the order given -- the caller queries them oldest-first
 * (created_at ascending), the same "oldest rule wins a tie" precedent
 * hard_rules matching already established, so behavior stays predictable
 * even when two overrides could both match the same action_type.
 */
export function resolveEffectiveOnUncertain(
  blanketPolicy: string | null,
  actionType: string,
  overrides: ActionTypeOverride[],
): EffectiveOnUncertain {
  const matched = overrides.find((o) => matchesActionTypePattern(o.action_type_pattern, actionType));
  return matched ? { policy: matched.on_uncertain, matchedOverride: matched } : { policy: blanketPolicy, matchedOverride: null };
}

export type EffectiveConfidenceThreshold = { threshold: number; matchedOverride: ActionTypeOverride | null };

/**
 * "Knowledge & autonomy" plan, item 9: the SAME override-list shape and
 * matching order item 10 (last round) already established for
 * on_uncertain, applied here to the confidence threshold instead -- the
 * first configured override whose pattern matches AND actually carries a
 * confidence_threshold (a row that only overrides on_uncertain is
 * correctly skipped here, never treated as "threshold zero"), or the
 * key's own blanket/risk-based threshold when none matches. This is a
 * REPLACEMENT of the base threshold for this one decision, not a floor or
 * ceiling on it -- any further caution-only widening (e.g.
 * widenThresholdForFlags for an active miscalibration flag) is still the
 * caller's job to apply on top, same one-directional "never a blind
 * allow" posture every automatic caution mechanism in this system
 * already has.
 */
export function resolveEffectiveConfidenceThreshold(
  blanketThreshold: number,
  actionType: string,
  overrides: ActionTypeOverride[],
): EffectiveConfidenceThreshold {
  const matched = overrides.find(
    (o) => o.confidence_threshold != null && matchesActionTypePattern(o.action_type_pattern, actionType),
  );
  return matched
    ? { threshold: matched.confidence_threshold as number, matchedOverride: matched }
    : { threshold: blanketThreshold, matchedOverride: null };
}
