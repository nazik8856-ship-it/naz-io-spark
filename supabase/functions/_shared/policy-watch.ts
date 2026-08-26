// "15 more items" plan, item 13: continuous shadow-mode for a whole DRAFT
// policy version. Unlike policy-replay.ts's replayDraft (30 fixed
// scenarios) and replayRealTraffic (one-time batch over past decisions),
// this is called once per LIVE decision, going forward, for as long as a
// draft is marked "watching" -- see control-gate.ts's runControlGate
// wrapper, which is the single place every live decision funnels through
// regardless of caller (control-engine, agent-runtime, control-api).
//
// Reuses policy-replay.ts's evaluateAction (the same deterministic
// hard-rule + safety-scanner evaluator replayRealTraffic already uses) and
// real-traffic-replay.ts's diffRealAction/summarizeRealTrafficReplay (the
// same regression/improvement classifier) rather than duplicating either --
// a watch observation and a real-traffic-replay row are the same shape of
// comparison, just captured continuously instead of in one backward-looking
// batch.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { evaluateAction, type GateOutcome, type PolicySnapshot } from "./policy-replay.ts";
import { diffRealAction, summarizeRealTrafficReplay, type RealTrafficReplaySummary } from "./real-traffic-replay.ts";

export type PolicyWatchAction = { action_type: string; provider: string; description: string; params: unknown };

/**
 * For every DRAFT policy version this account currently has marked
 * "watching," evaluates the SAME real action against that draft's pinned
 * snapshot and records what it would have decided, next to what the real
 * gate actually decided. A no-op (one cheap indexed SELECT, no insert) for
 * the overwhelming majority of accounts that aren't watching anything.
 * Must never throw in a way that affects the real gate result -- callers
 * wrap this in a try/catch, same as the gate's own latency instrumentation.
 */
export async function recordPolicyWatchObservations(
  admin: SupabaseClient,
  userId: string,
  action: PolicyWatchAction,
  activeOutcome: GateOutcome,
  decisionId: string | null,
): Promise<void> {
  const { data: watchers } = await admin
    .from("policy_versions")
    .select("id, snapshot")
    .eq("user_id", userId)
    .eq("status", "draft")
    .eq("watching", true);
  if (!watchers || watchers.length === 0) return;

  const rows = (watchers as { id: string; snapshot: PolicySnapshot | null }[]).map((w) => {
    const draftResult = evaluateAction(action, w.snapshot ?? {});
    return {
      user_id: userId,
      policy_version_id: w.id,
      decision_id: decisionId,
      action_type: action.action_type,
      provider: action.provider,
      active_outcome: activeOutcome,
      draft_outcome: draftResult.gate_outcome,
      changed: draftResult.gate_outcome !== activeOutcome,
    };
  });
  await admin.from("policy_watch_observations").insert(rows);
}

export type PolicyWatchObservationRow = {
  action_type: string;
  provider: string | null;
  active_outcome: GateOutcome;
  draft_outcome: GateOutcome;
  created_at: string;
};

export type PolicyWatchChangedSample = {
  action_type: string;
  provider: string | null;
  active_outcome: GateOutcome;
  draft_outcome: GateOutcome;
  diff: "regression" | "improvement";
  created_at: string;
};

export type PolicyWatchSummary = RealTrafficReplaySummary & {
  policy_version_id: string;
  watching_since: string | null;
  changed_samples: PolicyWatchChangedSample[];
};

const MAX_CHANGED_SAMPLES = 25;

/** Pure -- builds the human-reviewable summary from a batch of stored observation rows. */
export function summarizePolicyWatch(
  policyVersionId: string,
  watchingSince: string | null,
  rows: PolicyWatchObservationRow[],
): PolicyWatchSummary {
  const diffs = rows.map((r) => diffRealAction(r.active_outcome, r.draft_outcome));
  const changedSamples: PolicyWatchChangedSample[] = rows
    .map((r, i) => ({ ...r, diff: diffs[i] }))
    .filter((r): r is PolicyWatchObservationRow & { diff: "regression" | "improvement" } => r.diff !== "same")
    .slice(0, MAX_CHANGED_SAMPLES);

  return {
    ...summarizeRealTrafficReplay(diffs),
    policy_version_id: policyVersionId,
    watching_since: watchingSince,
    changed_samples: changedSamples,
  };
}
