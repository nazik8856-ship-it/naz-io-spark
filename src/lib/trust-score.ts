// GAP 4 (Trust Score + Provenance + Control Report): client-side mirror of
// supabase/functions/_shared/trust-score.ts's pure computeTrustScore --
// duplicated here for the same reason the rest of this file's siblings are
// (agent-policy.ts, coverage-gaps.ts): that module lives outside the Vite
// frontend's root. Keep both in sync by hand; there is no gather function
// here -- ControlEntities.tsx does its own browser-client fetching and
// passes the aggregated counts straight into this pure function.

export type TrustScoreComponentName = "confidence_calibration" | "rule_trigger_rate" | "repair_interventions";
export type TrustScoreComponentStatus = "ok" | "elevated" | "no_data";

export type TrustScoreComponent = {
  name: TrustScoreComponentName;
  status: TrustScoreComponentStatus;
  deduction: number;
  detail: string;
};

export type TrustScoreReport = {
  score: number;
  components: TrustScoreComponent[];
};

export type TrustScoreInput = {
  avgCalibrationGap: number | null;
  totalDecisions: number;
  ruleTriggeredDecisions: number;
  repairInterventions: number;
};

export const MIN_SAMPLE_FOR_TRUST_SCORE = 10;

const CALIBRATION_GAP_DEDUCTION_CAP = 30;
const RULE_TRIGGER_DEDUCTION_CAP = 40;
const REPAIR_INTERVENTION_DEDUCTION_CAP = 30;

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
