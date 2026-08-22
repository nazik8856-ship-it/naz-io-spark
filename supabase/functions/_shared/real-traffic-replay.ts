// Real-traffic policy replay (2026-08-23) -- "would a draft policy have
// decided this differently than my active one, for actions that actually
// happened." Unlike the 30 fixed CONTROL_SCENARIOS (policy-replay.ts),
// real decisions have no "correct answer" to grade a pass/fail against --
// only a diff between what two policy snapshots would each decide for the
// SAME real action. evaluateAction (policy-replay.ts) supplies the
// per-snapshot outcome; this module classifies the diff between two such
// outcomes and aggregates a batch of them.
//
// Scoped to already-captured data only (no new PII capture on ALLOW
// decisions -- confirmed): only decisions with a captured action payload
// (agent_decisions.params, from BLOCK sources -- item 4/09-23's
// description column -- or every escalated pending_approvals row) can be
// replayed at all; that selection happens in get_replayable_real_decisions
// (the migration), not here.
import type { GateOutcome } from "./policy-replay.ts";

export type RealDecisionRow = {
  id: string;
  action_type: string;
  provider: string;
  description: string;
  params: unknown;
  created_at: string;
  real_source: "decision" | "approval";
};

export type RealActionDiff = "same" | "regression" | "improvement";

const SEVERITY_RANK: Record<GateOutcome, number> = { pass_through: 0, require_approval: 1, block: 2 };

/**
 * Pure -- classifies how a draft policy's outcome compares to the active
 * policy's outcome for the SAME real action. "regression" = the draft is
 * strictly LESS strict (would have let through something the active
 * policy stopped); "improvement" = strictly MORE strict (catches
 * something the active policy missed); "same" = identical outcome.
 * There's no separate "changed" bucket the way scenarios have one --
 * regression/improvement already fully partition "different."
 */
export function diffRealAction(active: GateOutcome, draft: GateOutcome): RealActionDiff {
  if (active === draft) return "same";
  return SEVERITY_RANK[draft] < SEVERITY_RANK[active] ? "regression" : "improvement";
}

export type RealTrafficReplaySummary = {
  total: number;
  same: number;
  regressions: number;
  improvements: number;
};

/** Pure -- aggregate counts from a batch of per-action diffs. */
export function summarizeRealTrafficReplay(diffs: RealActionDiff[]): RealTrafficReplaySummary {
  const summary: RealTrafficReplaySummary = { total: diffs.length, same: 0, regressions: 0, improvements: 0 };
  for (const d of diffs) {
    if (d === "same") summary.same++;
    else if (d === "regression") summary.regressions++;
    else summary.improvements++;
  }
  return summary;
}
