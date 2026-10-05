// GAP 4 (Trust Score + Provenance + Control Report): a real, evidence-based
// 0-100 trust score per GOVERNED ENTITY (one Generator agent, or one Outer
// Control api key) -- not a per-decision score (outer-control-scoring.ts's
// own computeTrustScore already covers that, for one evaluation's safety
// matches). This is the aggregate signal GAP 4 asks for: how trustworthy
// has this entity's REAL, measured behavior actually been, from three
// independent signals that already exist elsewhere in this system:
//   - confidence calibration accuracy (confidence_calibration, item 5's
//     per-account/per-key bucketed expected-vs-actual success rate)
//   - hard/safety rule trigger rate (agent_decisions.source in
//     hard_rule/safety_scanner, as a share of this entity's own decisions)
//   - repair-engine intervention rate (GAP 3's repair-engine.ts --
//     agent_events.kind='self_repair' for an agent, outer_control_evaluations
//     verdict='modify' for an api key)
// No new storage: purely a read/aggregation layer, same posture
// automation-readiness.ts already established for a similar composed
// signal. Never throws -- any single lookup failing degrades that one
// component to "no_data" rather than crashing the whole score.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type TrustScoreComponentName = "confidence_calibration" | "rule_trigger_rate" | "repair_interventions";
export type TrustScoreComponentStatus = "ok" | "elevated" | "no_data";

export type TrustScoreComponent = {
  name: TrustScoreComponentName;
  status: TrustScoreComponentStatus;
  /** Points subtracted from the 100 baseline for this component -- always 0 when status is "no_data" (an unmeasured signal is never held against an entity). */
  deduction: number;
  detail: string;
};

export type TrustScoreReport = {
  /** 0-100. 100 when every component is either "ok" or "no_data" (no evidence of a real issue found). */
  score: number;
  components: TrustScoreComponent[];
};

export type TrustScoreInput = {
  /** Average |calibration_gap| across this entity's own confidence_calibration rows in the lookback window, 0-1. null = no calibration rows measured yet. */
  avgCalibrationGap: number | null;
  /** Total real decisions logged for this entity in the lookback window. */
  totalDecisions: number;
  /** Of those, how many were stopped by a hard rule or the safety scanner. */
  ruleTriggeredDecisions: number;
  /** Of those, how many needed a GAP 3 repair-engine intervention before they could run/ship. */
  repairInterventions: number;
};

/** Below this many real decisions, the rule-trigger-rate and repair-intervention-rate signals are too thin a sample to judge either way -- same reasoning automation-readiness.ts's own MIN_SAMPLE_FOR_READINESS already established for a sibling signal. */
export const MIN_SAMPLE_FOR_TRUST_SCORE = 10;

const CALIBRATION_GAP_DEDUCTION_CAP = 30;
const RULE_TRIGGER_DEDUCTION_CAP = 40;
const REPAIR_INTERVENTION_DEDUCTION_CAP = 30;

/** Pure -- composes the three signals into one 0-100 score, deducting from a 100 baseline. Each component's deduction is capped independently so no single signal alone can drive the score below 100 - (sum of the other two caps), keeping a single bad signal from reading as "zero trust" on its own. */
export function computeTrustScore(input: TrustScoreInput): TrustScoreReport {
  const components: TrustScoreComponent[] = [];

  if (input.avgCalibrationGap === null) {
    components.push({
      name: "confidence_calibration", status: "no_data", deduction: 0,
      detail: "Not enough measured decisions yet to judge confidence calibration for this entity.",
    });
  } else {
    const deduction = Math.round(Math.min(CALIBRATION_GAP_DEDUCTION_CAP, input.avgCalibrationGap * 100));
    components.push({
      name: "confidence_calibration",
      status: deduction > 0 ? "elevated" : "ok",
      deduction,
      detail: `Average confidence-calibration gap of ${Math.round(input.avgCalibrationGap * 100)} percentage point(s) between expected and actual success rate.`,
    });
  }

  if (input.totalDecisions < MIN_SAMPLE_FOR_TRUST_SCORE) {
    const detail = `Only ${input.totalDecisions} real decision(s) logged in the lookback window -- not enough yet to judge rule-trigger or repair-intervention rate.`;
    components.push({ name: "rule_trigger_rate", status: "no_data", deduction: 0, detail });
    components.push({ name: "repair_interventions", status: "no_data", deduction: 0, detail });
  } else {
    const ruleRate = input.ruleTriggeredDecisions / input.totalDecisions;
    const ruleDeduction = Math.round(Math.min(RULE_TRIGGER_DEDUCTION_CAP, ruleRate * 100));
    components.push({
      name: "rule_trigger_rate",
      status: ruleDeduction > 0 ? "elevated" : "ok",
      deduction: ruleDeduction,
      detail: `${input.ruleTriggeredDecisions} of ${input.totalDecisions} decision(s) (${Math.round(ruleRate * 100)}%) were stopped by a hard rule or the safety scanner.`,
    });

    const repairRate = input.repairInterventions / input.totalDecisions;
    const repairDeduction = Math.round(Math.min(REPAIR_INTERVENTION_DEDUCTION_CAP, repairRate * 100));
    components.push({
      name: "repair_interventions",
      status: repairDeduction > 0 ? "elevated" : "ok",
      deduction: repairDeduction,
      detail: `${input.repairInterventions} of ${input.totalDecisions} decision(s) (${Math.round(repairRate * 100)}%) needed an automatic repair-engine fix before they could run or ship.`,
    });
  }

  const score = Math.max(0, Math.min(100, 100 - components.reduce((sum, c) => sum + c.deduction, 0)));
  return { score, components };
}

export type TrustScoreEntityKind = "agent" | "api_key";

/** How far back to look -- same order of magnitude as automation-readiness.ts's own READINESS_LOOKBACK_DAYS, since both judge "is this entity's recent, real behavior trustworthy." */
export const TRUST_SCORE_LOOKBACK_DAYS = 90;

/**
 * Gathers the three real signals computeTrustScore needs for ONE entity,
 * straight from the tables each already lives in. Never throws -- any
 * single lookup failing degrades that one signal to its own "nothing to
 * report" state rather than failing the whole score.
 */
export async function gatherTrustScoreInput(
  admin: SupabaseClient,
  userId: string,
  entityKind: TrustScoreEntityKind,
  entityId: string,
  lookbackDays: number = TRUST_SCORE_LOOKBACK_DAYS,
): Promise<TrustScoreInput> {
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();
  const entityColumn = entityKind === "agent" ? "agent_id" : "api_key_id";

  let avgCalibrationGap: number | null = null;
  try {
    // confidence_calibration has no agent_id of its own (item 5's
    // per-account/per-key design: api_key_id null means "every internal
    // agent decision," shared across every agent on the account) -- an
    // agent's own calibration signal is necessarily the account-wide one;
    // an api key's is its own.
    let q = admin.from("confidence_calibration").select("calibration_gap").eq("user_id", userId).gte("period_end", since);
    q = entityKind === "api_key" ? q.eq("api_key_id", entityId) : q.is("api_key_id", null);
    const { data } = await q;
    const rows = (data ?? []) as { calibration_gap: number | null }[];
    const gaps = rows.map((r) => Math.abs(Number(r.calibration_gap) || 0)).filter((g) => Number.isFinite(g));
    if (gaps.length) avgCalibrationGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  } catch { /* falls back to null -- reads as "no_data", never penalizes unfairly on a lookup hiccup */ }

  let totalDecisions = 0;
  let ruleTriggeredDecisions = 0;
  try {
    const { data } = await admin
      .from("agent_decisions")
      .select("source")
      .eq(entityColumn, entityId)
      .eq("is_test", false)
      .gte("created_at", since)
      .limit(10000);
    const rows = (data ?? []) as { source: string | null }[];
    totalDecisions = rows.length;
    ruleTriggeredDecisions = rows.filter((r) => r.source === "hard_rule" || r.source === "safety_scanner").length;
  } catch { /* falls back to 0/0 -- correctly reads as "not enough data" rather than crashing the whole score */ }

  let repairInterventions = 0;
  try {
    if (entityKind === "agent") {
      // Two independent sources for an agent: GAP 3's agent-runtime
      // retry-with-repair loop (agent_events.kind='self_repair', a blocked
      // TOOL CALL repaired), and this same agent's own http_post output
      // going through the Outer Control text-review gate and coming back
      // "modify" (outer_control_evaluations.agent_id, a repaired RESPONSE
      // FROM an external endpoint). Both are real GAP-3 interventions for
      // this agent, so both count.
      const [{ count: selfRepairCount }, { count: evalCount }] = await Promise.all([
        admin.from("agent_events").select("id", { count: "exact", head: true })
          .eq("agent_id", entityId).eq("kind", "self_repair").gte("created_at", since),
        admin.from("outer_control_evaluations").select("id", { count: "exact", head: true })
          .eq("agent_id", entityId).eq("verdict", "modify").gte("created_at", since),
      ]);
      repairInterventions = (selfRepairCount ?? 0) + (evalCount ?? 0);
    } else {
      const { count } = await admin
        .from("outer_control_evaluations")
        .select("id", { count: "exact", head: true })
        .eq("api_key_id", entityId)
        .eq("verdict", "modify")
        .gte("created_at", since);
      repairInterventions = count ?? 0;
    }
  } catch { /* falls back to 0 -- reads as "no interventions recorded", never penalizes unfairly on a lookup hiccup */ }

  return { avgCalibrationGap, totalDecisions, ruleTriggeredDecisions, repairInterventions };
}
