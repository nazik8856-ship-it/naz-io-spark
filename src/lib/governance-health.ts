// GAP 10 (Unified UX): one traffic-light health indicator combining trust
// score + rule coverage + spend, shown identically in the Generator header
// (GeneratedDashboard.tsx, right after creation), the Control System header
// (ControlSystem.tsx, account-wide), and every Governed Entities row
// (ControlEntities.tsx). Pure and presentation-agnostic -- each caller feeds
// it whatever signals it already has at whatever scope (one entity or the
// whole account); this just decides red/amber/green and why.

export type GovernanceHealthLevel = "green" | "amber" | "red";

export type GovernanceHealthInput = {
  /** 0-100, or null when there isn't enough sample data yet (treated as neutral, never counted against the entity). */
  trustScore: number | null;
  /** Count of enabled hard/safety rules that actually apply here. 0 means genuinely ungoverned. */
  rulesApplied: number;
  /** today's spend ÷ today's cap, or null when spend isn't tracked at this scope. */
  spendPct: number | null;
};

export type GovernanceHealth = {
  level: GovernanceHealthLevel;
  reasons: string[];
};

const RED_TRUST_SCORE = 50;
const AMBER_TRUST_SCORE = 80;
const RED_SPEND_PCT = 1;
const AMBER_SPEND_PCT = 0.8;

export function computeGovernanceHealth(input: GovernanceHealthInput): GovernanceHealth {
  const redReasons: string[] = [];
  const amberReasons: string[] = [];

  if (input.trustScore !== null) {
    if (input.trustScore < RED_TRUST_SCORE) redReasons.push(`Trust score is low (${input.trustScore}).`);
    else if (input.trustScore < AMBER_TRUST_SCORE) amberReasons.push(`Trust score has room to improve (${input.trustScore}).`);
  }

  if (input.rulesApplied === 0) amberReasons.push("No rule currently governs this.");

  if (input.spendPct !== null) {
    if (input.spendPct >= RED_SPEND_PCT) redReasons.push("Over today's spend cap.");
    else if (input.spendPct >= AMBER_SPEND_PCT) amberReasons.push("Near today's spend cap.");
  }

  if (redReasons.length) return { level: "red", reasons: redReasons };
  if (amberReasons.length) return { level: "amber", reasons: amberReasons };
  return { level: "green", reasons: ["Trust score healthy, rules applied, spend within cap."] };
}
