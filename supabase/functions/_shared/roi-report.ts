// Backend mirror of src/lib/roi-report.ts's classification + aggregation
// logic, for the scheduled monthly report email. Duplicated rather than
// shared across the Deno/Vite runtime boundary (same reasoning as
// coverage-gaps.ts duplicating rule-matching.ts) -- kept intentionally
// small, only what the email needs (no Markdown builder here).

export type DecisionOutcome = "allow" | "modify" | "block" | "deferred" | "approval_required" | "other";

export function classifyDecisionOutcome(decisionText: string): DecisionOutcome {
  const first = (decisionText.trim().split(/\s+/)[0] ?? "").toUpperCase();
  switch (first) {
    case "ALLOW": return "allow";
    case "MODIFY": return "modify";
    case "BLOCK": return "block";
    case "DEFERRED": return "deferred";
    case "APPROVAL_REQUIRED": return "approval_required";
    default: return "other";
  }
}

export type DecisionForRoi = { decision: string; escalated: boolean };

export type OutcomeCounts = {
  total: number;
  blocked: number;
  modified: number;
  allowed: number;
  needsHuman: number;
  autonomous: number;
};

/** Pure — overall blocked/modified/allowed + autonomous-vs-human counts. */
export function summarizeDecisionsForRoi(decisions: DecisionForRoi[]): OutcomeCounts {
  let blocked = 0, modified = 0, allowed = 0, needsHuman = 0;
  for (const d of decisions) {
    const kind = classifyDecisionOutcome(d.decision);
    if (kind === "block") blocked++;
    else if (kind === "modify") modified++;
    else if (kind === "allow") allowed++;
    if (d.escalated) needsHuman++;
  }
  return { total: decisions.length, blocked, modified, allowed, needsHuman, autonomous: decisions.length - needsHuman };
}

/** Pure — $ spent per autonomous (non-escalated) decision. Null rather than dividing by zero. */
export function costPerAutonomousDecision(totalSpendUsd: number, autonomousCount: number): number | null {
  if (autonomousCount <= 0) return null;
  return Math.round((totalSpendUsd / autonomousCount) * 10000) / 10000;
}
