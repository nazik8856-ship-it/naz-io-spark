// Pure hard-rule matching — extracted from control-gate.ts so the exact
// same logic that enforces rules in production can also power a rule
// simulator (paste a hypothetical action, see what a draft rule would do)
// without risking the simulator silently drifting from what actually
// enforces.

export type HardRuleLike = {
  action_type_pattern: string;
  provider?: string | null;
};

/** Turns a simple glob ("*" = any run of characters) into an anchored, case-insensitive RegExp. */
export function globToRe(pattern: string): RegExp {
  return new RegExp(
    "^" + pattern.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
}

/** Does this rule apply to an action of this type, from this provider? */
export function ruleMatchesAction(rule: HardRuleLike, actionType: string, provider: string): boolean {
  if (rule.provider && rule.provider.toLowerCase() !== provider.toLowerCase()) return false;
  try {
    return globToRe(rule.action_type_pattern || "*").test(actionType);
  } catch {
    return false;
  }
}
