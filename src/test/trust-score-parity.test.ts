// AUDIT 5 (Trust Score + Provenance + Control Report, 2026-10-07): the
// same drift risk AUDIT 1 found and fixed for the rule-matching
// primitives exists here too -- src/lib/trust-score.ts is a hand-
// maintained mirror of supabase/functions/_shared/trust-score.ts's pure
// computeTrustScore (the Vite frontend can't import a Deno edge-function
// module directly at runtime), and nothing ever verified the two stay
// byte-identical. A future bugfix to one of the three deduction caps, or
// a change to how a component's status is decided, could land in only
// one copy -- the Trust Score this exact audit's own scope calls out
// would then silently disagree between whatever reads the canonical
// version (gatherTrustScoreInput's real callers) and whatever reads this
// mirror (ControlEntities.tsx's UI).
//
// This test imports the canonical module directly via a relative path --
// trust-score.ts's only import is `import type { SupabaseClient } from
// "https://esm.sh/@supabase/supabase-js@2"`, a type-only import erased at
// build time, so it has zero runtime imports and nothing Deno-specific to
// trip up Vite/Node, same as rule-matching.ts before it -- and diffs the
// mirror against it across an adversarial battery of score-composition
// cases. A hand-edited mirror that drifts from the canonical
// implementation fails THIS test, not silently.
//
// Run with the normal frontend suite: npx vitest run
import { describe, it, expect } from "vitest";
import {
  computeTrustScore as computeTrustScoreCanonical,
  type TrustScoreInput,
} from "../../supabase/functions/_shared/trust-score.ts";
import { computeTrustScore as computeTrustScoreMirror } from "@/lib/trust-score";

const INPUT_BATTERY: TrustScoreInput[] = [
  { avgCalibrationGap: null, totalDecisions: 0, ruleTriggeredDecisions: 0, repairInterventions: 0 },
  { avgCalibrationGap: 0, totalDecisions: 50, ruleTriggeredDecisions: 0, repairInterventions: 0 },
  { avgCalibrationGap: 0.05, totalDecisions: 100, ruleTriggeredDecisions: 5, repairInterventions: 5 },
  { avgCalibrationGap: 0.5, totalDecisions: 100, ruleTriggeredDecisions: 50, repairInterventions: 50 },
  { avgCalibrationGap: 1, totalDecisions: 100, ruleTriggeredDecisions: 100, repairInterventions: 100 },
  { avgCalibrationGap: null, totalDecisions: 9, ruleTriggeredDecisions: 9, repairInterventions: 9 }, // just below MIN_SAMPLE_FOR_TRUST_SCORE
  { avgCalibrationGap: null, totalDecisions: 10, ruleTriggeredDecisions: 1, repairInterventions: 0 }, // exactly at the threshold
  { avgCalibrationGap: 0.3, totalDecisions: 1000, ruleTriggeredDecisions: 1, repairInterventions: 1 },
  // gatherTrustScoreInput always passes avgCalibrationGap through Math.abs()
  // before this function ever sees it, so a negative value is out of
  // domain for the real pipeline -- included anyway so parity holds for
  // whatever each copy actually does with an off-happy-path input, not
  // just the inputs the real caller happens to produce today.
  { avgCalibrationGap: -0.4, totalDecisions: 100, ruleTriggeredDecisions: 0, repairInterventions: 0 },
];

describe("trust-score parity (src/lib/trust-score.ts vs supabase/functions/_shared/trust-score.ts)", () => {
  it("every input in the battery produces an identical report from both copies", () => {
    for (const input of INPUT_BATTERY) {
      const canonical = computeTrustScoreCanonical(input);
      const mirror = computeTrustScoreMirror(input);
      expect(mirror, `drift for input ${JSON.stringify(input)}`).toEqual(canonical);
    }
  });
});
