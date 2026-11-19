// Inner Control Day 2 (#170): warnings for a rule being added. It is checked against the rules already there: it may repeat one, overlap one, or
// contradict one (the same actions or text, a different outcome). This only warns and never blocks the save. It names the other rule
// so the person can decide. Deterministic and pure: the gate's own glob for actions, the scanner's own regex for text.
//   Action rules: the gate uses the first live rule that matches, oldest first, and a rule for one AI before an account-wide one
//   (see rule-conflicts.ts, which finds the same among saved rules). A rule added here is account-wide and newest, so a live rule
//   that matches the same actions decides for them. The warning says so.
import { globToRe } from "@/lib/rule-conflicts";
import { findPatternProblem } from "@/lib/safety-pattern";
import type { HardEdit, SafetyEdit } from "@/lib/inner-rule-edit";
import type { HardRuleRow, SafetyRuleRow } from "@/lib/inner-control-ui";

export type ConflictKind = "duplicate" | "contradicts" | "overlaps";
export type RuleWarning = { kind: ConflictKind; id: string; name: string; line: string };

const MAX_SHOWN = 3;
const ORDER: Record<ConflictKind, number> = { duplicate: 0, contradicts: 1, overlaps: 2 };

const stateOf = (r: { enabled: boolean | null; shadow_mode: boolean }) =>
  r.enabled === false ? " (switched off)" : r.shadow_mode ? " (in shadow mode)" : "";
const scopedOf = (r: { agent_id: string | null; api_key_id?: string | null; provider?: string | null }) =>
  !!(r.agent_id || r.api_key_id || r.provider);
const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 77)}…` : s}”`;
const sorted = (list: RuleWarning[]) => list.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).slice(0, MAX_SHOWN);

/** Does action pattern a match every action pattern b can match? A * in b is read as a run of any letters. */
function covers(a: string, b: string): boolean {
  try { return globToRe(a).test(b.trim().replace(/\*/g, "zz")); } catch { return false; }
}
const norm = (p: string) => (p || "*").trim().toLowerCase();
const what = (p: string) => (p === "*" ? "every action" : p);
const does = (effect: string, w: string) => (effect === "always_block" ? `blocks ${w}` : `holds ${w} for approval`);
const would = (effect: string, w: string) => (effect === "always_block" ? `would block ${w}` : `would hold ${w} for approval`);

/** What an action rule being added has in common with the action rules already there. */
export function hardConflicts(draft: HardEdit, existing: HardRuleRow[]): RuleWarning[] {
  const mine = norm(draft.scope);
  const out: RuleWarning[] = [];
  for (const r of existing) {
    const theirs = norm(r.action_type_pattern);
    const same = theirs === mine;
    const wider = !same && covers(theirs, mine);
    const narrower = !same && !wider && covers(mine, theirs);
    if (!same && !wider && !narrower) continue;
    const name = quote(r.rule_text);
    const state = stateOf(r);
    const live = r.enabled !== false && !r.shadow_mode;
    const firstWins = !live ? "" : scopedOf(r) ? " For the AI it is set for, that rule is used." : " When both match, the older rule is used, so it decides.";
    // The gate holds for the winning rule's own number of approvals (none stored means 1).
    const theirApprovals = r.required_approvals ?? 1;
    const fewer = r.effect === "always_require_approval" && draft.effect === "always_require_approval" && theirApprovals !== draft.approvals;
    if (same && r.effect === draft.effect && fewer) {
      out.push({ kind: "contradicts", id: r.id, name: r.rule_text, line: `Your rule ${name}${state} holds ${what(theirs)} for ${theirApprovals} ${theirApprovals === 1 ? "approval" : "approvals"}; this one asks for ${draft.approvals}.${firstWins}` });
    } else if (same && r.effect === draft.effect) {
      out.push({ kind: "duplicate", id: r.id, name: r.rule_text, line: `Same as your rule ${name}${state}: it already ${does(r.effect, what(theirs))}.` });
    } else if (r.effect !== draft.effect && (same || wider)) {
      out.push({ kind: "contradicts", id: r.id, name: r.rule_text, line: `Your rule ${name}${state} ${does(r.effect, what(theirs))}; this one ${would(draft.effect, same ? "them" : what(mine))}.${firstWins}` });
    } else if (wider) {
      out.push({ kind: "overlaps", id: r.id, name: r.rule_text, line: `Your rule ${name}${state} already covers ${what(mine)}, as it applies to ${what(theirs)}.` });
    } else {
      out.push({ kind: "overlaps", id: r.id, name: r.rule_text, line: `This rule also covers ${what(theirs)}, which your rule ${name}${state} ${r.effect === "always_block" ? "blocks" : "holds for approval"}.` });
    }
  }
  return sorted(out);
}

const TEXT_DOES: Record<SafetyEdit["action"], string> = { block: "blocks the reply", approval: "holds the reply for approval", redact: "removes the matching text" };
const textActionOf = (r: Pick<SafetyRuleRow, "severity" | "redact">): SafetyEdit["action"] =>
  r.redact ? "redact" : r.severity === "block" ? "block" : "approval";

/** What a text rule being added has in common with the text rules already there. Words typed are checked against each rule. */
export function textConflicts(draft: SafetyEdit, phrases: string[], existing: SafetyRuleRow[]): RuleWarning[] {
  const mine = draft.pattern.trim();
  const out: RuleWarning[] = [];
  for (const r of existing) {
    const theirs = String(r.pattern ?? "").trim();
    const action = textActionOf(r);
    const name = quote(r.name);
    const state = stateOf(r);
    if (theirs === mine) {
      out.push(action === draft.action
        ? { kind: "duplicate", id: r.id, name: r.name, line: `Same as your rule ${name}${state}: it already looks for this and ${TEXT_DOES[action]}.` }
        : { kind: "contradicts", id: r.id, name: r.name, line: `Your rule ${name}${state} looks for the same text but ${TEXT_DOES[action]}; this one ${TEXT_DOES[draft.action]}.` });
      continue;
    }
    // An existing pattern that could not run safely is skipped, as the scanner skips it.
    if (!phrases.length || findPatternProblem(theirs)) continue;
    let re: RegExp;
    try { re = new RegExp(theirs, "i"); } catch { continue; }
    const caught = phrases.filter((p) => re.test(p));
    if (!caught.length) continue;
    const words = caught.slice(0, 3).map((p) => `“${p}”`).join(", ");
    out.push(action === draft.action
      ? { kind: "overlaps", id: r.id, name: r.name, line: `Your rule ${name}${state} already catches ${words}.` }
      : { kind: "contradicts", id: r.id, name: r.name, line: `Your rule ${name}${state} already catches ${words} and ${TEXT_DOES[action]}; this one ${TEXT_DOES[draft.action]}.` });
  }
  return sorted(out);
}
