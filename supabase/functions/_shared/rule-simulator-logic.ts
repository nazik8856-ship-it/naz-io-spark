// Pure combination logic for the rule simulator's "projected verdict" —
// separated from rule-simulator/index.ts so it's directly testable without
// spinning up the whole edge function. Mirrors the real gate's precedence
// (hard rule beats the safety scanner) but is NOT the same code path as
// control-gate.ts — this only ever answers a hypothetical, read-only "what
// would happen", it does not enforce anything.

export type ProjectedVerdict = "block" | "require_approval" | "allow";

export function projectVerdict(input: {
  liveRuleEffect: "always_block" | "always_require_approval" | null;
  draftRuleMatches: boolean;
  draftRuleEffect: "always_block" | "always_require_approval" | null;
  safetyMatched: boolean;
  safetySeverity: "block" | "require_approval" | null;
}): ProjectedVerdict {
  if (input.liveRuleEffect) {
    return input.liveRuleEffect === "always_block" ? "block" : "require_approval";
  }
  if (input.draftRuleMatches && input.draftRuleEffect) {
    return input.draftRuleEffect === "always_block" ? "block" : "require_approval";
  }
  if (input.safetyMatched && input.safetySeverity) {
    return input.safetySeverity === "block" ? "block" : "require_approval";
  }
  return "allow";
}
