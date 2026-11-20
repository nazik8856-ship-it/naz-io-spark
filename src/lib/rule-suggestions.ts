// Inner Control Day 3 (#173): suggested rules from what happened. When the same action was blocked, changed or held for approval
// several times this week and no rule of yours made that call (the AI's own judgement, the anomaly detector, a spend limit),
// NazAI offers to make it a rule: "This happened 4 times this week. Make it a rule?". One tap opens the Add window with the rule
// drafted; nothing is saved until it is saved there, and it starts in shadow mode like any new rule.
// Pure. From recorded decisions only (agent_decisions with no hard_rule_id), the mirror of coverage-gaps.ts (actions with no rule)
// and rule-effectiveness.ts (rules that never fire).
import { globToRe } from "@/lib/coverage-gaps";
import { SCOPE_LABELS, verdictOf, type HardRuleRow } from "@/lib/inner-control-ui";
import type { HardEdit } from "@/lib/inner-rule-edit";

/** How many times in the window before a suggestion is made, the window, and how many are shown at once. */
export const SUGGEST_MIN_TIMES = 3;
export const SUGGEST_WINDOW_DAYS = 7;
export const MAX_SUGGESTIONS = 3;

/** Answer checks are not actions: what a reply may say is a text rule, not an action rule. */
const ANSWER_CHECK = "outer_control_text_review";

export type SuggestionDecision = { decision: string; action_type: string | null; hard_rule_id: string | null; created_at: string };
export type RuleSuggestion = {
  /** The action, also the key a "Not now" is remembered by. */
  action: string;
  count: number;
  blocked: number;
  held: number;
  changed: number;
  line: string;
  draft: HardEdit;
};

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** The suggestions for these decisions: the actions stopped most often first, at most three, never one a rule already covers. */
export function suggestRules(
  decisions: SuggestionDecision[],
  rules: Pick<HardRuleRow, "action_type_pattern" | "enabled">[],
  opts: { now: number; dismissed?: Set<string>; minTimes?: number },
): RuleSuggestion[] {
  const since = opts.now - SUGGEST_WINDOW_DAYS * 86_400_000;
  const min = opts.minTimes ?? SUGGEST_MIN_TIMES;
  // A rule in shadow mode counts as covering: it is already being tried on that action.
  const patterns: RegExp[] = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    try { patterns.push(globToRe(r.action_type_pattern || "*")); } catch { /* a pattern that does not compile covers nothing */ }
  }
  const covered = (action: string) => patterns.some((re) => re.test(action));

  const by = new Map<string, { blocked: number; held: number; changed: number }>();
  for (const d of decisions) {
    const action = (d.action_type ?? "").trim();
    if (!action || action === ANSWER_CHECK || d.hard_rule_id) continue;
    if (!(Date.parse(d.created_at) >= since)) continue;
    const v = verdictOf(d.decision);
    if (!v || v === "ALLOW") continue;
    const c = by.get(action) ?? { blocked: 0, held: 0, changed: 0 };
    if (v === "BLOCK") c.blocked++;
    else if (v === "MODIFY") c.changed++;
    else c.held++; // ESCALATE, DEFERRED, APPROVAL_REQUIRED, REQUIRE_APPROVAL: a person was asked
    by.set(action, c);
  }

  const out: RuleSuggestion[] = [];
  for (const [action, c] of by) {
    const count = c.blocked + c.held + c.changed;
    if (count < min || covered(action) || opts.dismissed?.has(action)) continue;
    // Mostly blocked: the rule blocks. Otherwise it holds for a person, the safer of the two to start with.
    const block = c.blocked > c.held + c.changed;
    const label = SCOPE_LABELS[action];
    const what = [c.blocked && `blocked ${times(c.blocked)}`, c.held && `held for approval ${times(c.held)}`, c.changed && `changed ${times(c.changed)}`]
      .filter(Boolean).join(", ");
    out.push({
      action, count, ...c,
      line: `${label ?? `"${action}"`} was ${what} this week, and no rule of yours made that call. Make it a rule?`,
      draft: {
        text: block ? `Block ${label ? label.toLowerCase() : `"${action}"`}` : `Hold ${label ? label.toLowerCase() : `"${action}"`} for my approval`,
        scope: action, effect: block ? "always_block" : "always_require_approval", approvals: 1,
      },
    });
  }
  return out.sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)).slice(0, MAX_SUGGESTIONS);
}
