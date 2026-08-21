// ROI / value report (Wave 5, session 4) — distinct from the compliance
// report (audit/regulatory-framed: "what happened and was it handled").
// This is value-framed for whoever holds the budget: how many actions
// were blocked or modified before going out risky, how much ran
// autonomously vs. needed a human, and what that autonomy costs per
// decision. Every number here is derived directly from real, already-
// logged data (agent_decisions.decision text + .escalated, ai_spend_daily)
// — no estimated dollar "exposure avoided" figure is fabricated, since
// that would require price-tagging each action type, which this product
// doesn't do today. Pure aggregation only, no DB access.

export type DecisionOutcome = "allow" | "modify" | "block" | "deferred" | "approval_required" | "other";

/**
 * Pure — classifies a logged decision by the verb every gate/model path
 * already prefixes its `decision` text with (control-gate.ts's
 * "BLOCK ..."/"APPROVAL_REQUIRED ...", control-engine's model path's
 * "ALLOW/MODIFY/BLOCK/DEFERRED ..."). Anything else (kill-switch trips,
 * undo records, etc.) is "other" — not part of the allow/modify/block
 * spectrum this report is about.
 */
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

export type DecisionForRoi = { decision: string; escalated: boolean; agent_id: string | null };

export type OutcomeCounts = {
  total: number;
  blocked: number;
  modified: number;
  allowed: number;
  needsHuman: number; // deferred/approval_required or otherwise escalated
  autonomous: number; // total - needsHuman
};

function summarize(decisions: DecisionForRoi[]): OutcomeCounts {
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

/** Pure — overall counts, plus the same breakdown per agent_id ("account-wide" for null/chat-driven decisions). */
export function summarizeDecisionsForRoi(decisions: DecisionForRoi[]): {
  overall: OutcomeCounts;
  byAgent: Record<string, OutcomeCounts>;
} {
  const overall = summarize(decisions);
  const byAgentInput: Record<string, DecisionForRoi[]> = {};
  for (const d of decisions) {
    const key = d.agent_id ?? "account-wide";
    (byAgentInput[key] ??= []).push(d);
  }
  const byAgent: Record<string, OutcomeCounts> = {};
  for (const [key, rows] of Object.entries(byAgentInput)) byAgent[key] = summarize(rows);
  return { overall, byAgent };
}

/** Pure — $ spent per autonomous (non-escalated) decision. Null when there were none, rather than dividing by zero. */
export function costPerAutonomousDecision(totalSpendUsd: number, autonomousCount: number): number | null {
  if (autonomousCount <= 0) return null;
  return Math.round((totalSpendUsd / autonomousCount) * 10000) / 10000;
}

/**
 * Pure — projects month-end spend from the trailing daily costs seen so
 * far this month, at the average daily rate observed. `daysElapsed` and
 * `daysInMonth` are both required explicitly (no internal Date.now()) so
 * this stays testable without mocking the clock.
 */
export function projectMonthlySpend(dailyCostsSoFar: number[], daysElapsed: number, daysInMonth: number): number {
  if (daysElapsed <= 0) return 0;
  const spentSoFar = dailyCostsSoFar.reduce((n, c) => n + c, 0);
  const dailyRate = spentSoFar / daysElapsed;
  return Math.round(dailyRate * daysInMonth * 100) / 100;
}

export type RoiReportInput = {
  from: string;
  to: string;
  generatedAt: string;
  decisions: DecisionForRoi[];
  totalSpendUsd: number;
  spendByAgent: Record<string, number>; // agent_id -> $ spent, "account-wide" excluded (that's totalSpendUsd)
  agentNames: Record<string, string>; // agent_id -> display name
  decisionsTrend: { current: number; previous: number; changePct: number; direction: string };
  spendTrend: { current: number; previous: number; changePct: number; direction: string };
  projectedMonthlySpendUsd: number | null;
};

const agentLabel = (key: string, names: Record<string, string>) =>
  key === "account-wide" ? "Account-wide (chat)" : names[key] ?? `Agent ${key.slice(0, 8)}…`;

/** Pure — builds the report as Markdown text, same style as buildComplianceReport. */
export function buildRoiReport(input: RoiReportInput): string {
  const { overall, byAgent } = summarizeDecisionsForRoi(input.decisions);
  const costPerDecision = costPerAutonomousDecision(input.totalSpendUsd, overall.autonomous);
  const lines: string[] = [];

  lines.push("# NazAI Control System — ROI Report");
  lines.push(`Range: ${input.from} to ${input.to}`);
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push("");

  lines.push("## Value delivered");
  lines.push(`- ${overall.total} AI actions reviewed by the control system.`);
  lines.push(`- ${overall.blocked + overall.modified} were blocked or modified before running as originally proposed (${overall.blocked} blocked, ${overall.modified} modified).`);
  lines.push(`- ${overall.autonomous} of ${overall.total} were handled without needing a human at all.`);
  lines.push(`- ${overall.needsHuman} needed human review.`);
  lines.push("");

  lines.push("## Efficiency");
  lines.push(`- Total AI spend this range: $${input.totalSpendUsd.toFixed(2)}.`);
  lines.push(
    costPerDecision !== null
      ? `- Cost per autonomous decision: $${costPerDecision.toFixed(4)}.`
      : "- Cost per autonomous decision: n/a (no autonomous decisions in this range).",
  );
  if (input.projectedMonthlySpendUsd !== null) {
    lines.push(`- Projected month-end spend at the current daily rate: $${input.projectedMonthlySpendUsd.toFixed(2)}.`);
  }
  lines.push("");

  lines.push("## Trend vs. the prior period");
  lines.push(`- Decisions: ${input.decisionsTrend.current} vs ${input.decisionsTrend.previous} (${input.decisionsTrend.direction}, ${input.decisionsTrend.changePct}%).`);
  lines.push(`- Spend: $${input.spendTrend.current.toFixed(2)} vs $${input.spendTrend.previous.toFixed(2)} (${input.spendTrend.direction}, ${input.spendTrend.changePct}%).`);
  lines.push("");

  lines.push("## By agent (decision volume)");
  const agentKeys = Object.keys(byAgent).sort((a, b) => byAgent[b].total - byAgent[a].total);
  if (!agentKeys.length) {
    lines.push("No decisions in this range.");
  } else {
    for (const key of agentKeys) {
      const c = byAgent[key];
      lines.push(`- **${agentLabel(key, input.agentNames)}**: ${c.total} decisions (${c.blocked} blocked, ${c.modified} modified, ${c.autonomous} autonomous)`);
    }
  }
  lines.push("");

  // Per-agent spend is only ever tracked separately for an agent that has
  // its own spend cap configured (Wave 5 session 1's deliberate no-auto-
  // create design) -- an agent without one still contributes to the total
  // above, just not broken out here. Never estimated or backed into by
  // subtraction, since that would misattribute spend from agents that
  // simply aren't tracked individually as if it belonged to "account-wide".
  const spendAgentKeys = Object.keys(input.spendByAgent);
  if (spendAgentKeys.length) {
    lines.push("## Per-agent spend (agents with their own cap configured)");
    for (const key of spendAgentKeys.sort((a, b) => input.spendByAgent[b] - input.spendByAgent[a])) {
      lines.push(`- **${agentLabel(key, input.agentNames)}**: $${input.spendByAgent[key].toFixed(2)}`);
    }
  }

  return lines.join("\n");
}
