// "Knowledge & autonomy" plan, item 12: link a sequence of related
// actions into one plan (an opaque, caller-chosen plan_id, threaded
// through the exact same way idempotency_key already is), and if an
// earlier step in that sequence was blocked, treat a later step that
// depends on it more carefully instead of independently auto-resolving
// it as if nothing happened.
//
// One-directional, per this round's own scope decision: a plan link can
// only ever pull a step that WOULD have auto-resolved toward a genuine
// human escalation (never auto-reject it outright -- that's a decisive
// guess this system has no real basis for -- and never toward MORE
// autonomy). Checked at the exact point createPendingApproval already
// finalizes an automatic APPROVAL, the same place item 3's precedent
// check and "policy autonomy" item 3's quiet-hours check already run --
// this is a fourth caution-only check in that same chain, not a new one.
import { classifyDecisionOutcome } from "./roi-report.ts";

/**
 * Pure -- did ANY other real decision already recorded in this same plan
 * come back BLOCK? Reuses roi-report.ts's own classifyDecisionOutcome
 * (the exact same "read the first word of the stored decision text"
 * convention every other block-detection in this codebase already uses),
 * rather than inventing a second way to recognize a block.
 */
export function planHasEarlierBlock(decisionTexts: string[]): boolean {
  return decisionTexts.some((d) => classifyDecisionOutcome(d) === "block");
}
