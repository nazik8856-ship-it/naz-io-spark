// Rule conflict detector (Wave 5, session 2) — two hard rules that overlap
// in scope but disagree on effect is a real correctness/trust problem as
// rule counts grow: the gate enforces "first match wins" (oldest rule, by
// created_at), so the second rule silently never applies to whatever the
// first rule already covers. Surface that at review time, not silently.
//
// Mirrors globToRe from supabase/functions/_shared/rule-matching.ts —
// duplicated here rather than imported since that file lives outside the
// Vite frontend's root (same reasoning as coverage-gaps.ts).

function globToRe(pattern: string): RegExp {
  return new RegExp(
    "^" + pattern.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
}

export type HardRuleForConflict = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider?: string | null;
  enabled?: boolean;
  shadow_mode?: boolean;
  created_at: string;
  agent_id?: string | null;
};

export type RuleConflict = {
  winner: HardRuleForConflict; // the one that actually applies (first match wins — oldest)
  shadowed: HardRuleForConflict; // the one that can never independently fire for the overlap
};

/**
 * Best-effort overlap check between two action-type glob patterns. Exact
 * matches, a "*" on either side, and a literal (wildcard-free) pattern
 * tested against the other's regex are all detected reliably. Two patterns
 * that BOTH contain wildcards but were never written to be identical or
 * "*" can, in principle, still share some concrete action type this check
 * won't catch — a known, documented limitation, not a silent gap: this is
 * a best-effort surfacing tool for human review, not an enforcement path.
 */
function patternsCanOverlap(a: string, b: string): boolean {
  if (a === b || a === "*" || b === "*") return true;
  const hasWildcard = (p: string) => p.includes("*");
  if (!hasWildcard(a)) return globToRe(b).test(a);
  if (!hasWildcard(b)) return globToRe(a).test(b);
  return false;
}

function providersCanOverlap(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true; // either side unscoped -> can apply to anything
  return a.toLowerCase() === b.toLowerCase();
}

// Two hard rules scoped to DIFFERENT specific agents never both come into
// play for the same decision (control-gate.ts's selectRulesForAgent scopes
// each decision to exactly one agent's own rules + the account-wide
// fallback) -- they can never conflict, no matter how their patterns
// overlap. A rule scoped to agent_id null (account-wide) is always in
// play alongside any agent-scoped rule, so those pairs are still checked.
function agentScopesCanCoexist(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true; // either side account-wide -> always in play together
  return a === b;
}

/**
 * Pure — pairs of live (enabled, non-shadow) hard rules whose scope can
 * overlap but whose effect differs. Precedence mirrors the real gate
 * (control-gate.ts's selectRulesForAgent): an agent-scoped rule ALWAYS
 * wins over an account-wide one for that agent's own decisions, regardless
 * of which was created first -- only when both rules share the same scope
 * (same agent, or both account-wide) does the older one win, matching the
 * gate's oldest-first evaluation order within a single scope.
 */
export function findRuleConflicts(rules: HardRuleForConflict[]): RuleConflict[] {
  const live = rules
    .filter((r) => r.enabled !== false && !r.shadow_mode)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const conflicts: RuleConflict[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.effect === b.effect) continue;
      if (!providersCanOverlap(a.provider, b.provider)) continue;
      if (!patternsCanOverlap(a.action_type_pattern, b.action_type_pattern)) continue;
      if (!agentScopesCanCoexist(a.agent_id, b.agent_id)) continue;
      // a is older than b (sorted above). An agent-scoped rule beats an
      // account-wide one regardless of age; otherwise age decides.
      const aIsAgentScoped = !!a.agent_id;
      const bIsAgentScoped = !!b.agent_id;
      const [winner, shadowed] = bIsAgentScoped && !aIsAgentScoped ? [b, a] : [a, b];
      conflicts.push({ winner, shadowed });
    }
  }
  return conflicts;
}
