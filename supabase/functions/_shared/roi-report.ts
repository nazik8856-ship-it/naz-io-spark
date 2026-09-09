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

// "Policy autonomy" plan, item 14: a real automation-value report,
// through the Control API itself -- how much of an api key's traffic ran
// with zero human involved, how that's trended over time, and a rough
// estimate of the manual-review effort it saved. Composes the same
// summarizeDecisionsForRoi/costPerAutonomousDecision this file already
// computes for the monthly email, just scoped to one api key and bucketed
// into weekly trend points instead of one whole-period total.

/**
 * Pure — the Monday-anchored ISO week (UTC) a timestamp falls into, as a
 * plain YYYY-MM-DD date string. No calendar library needed: every
 * timestamp in the same real week maps to the exact same key, which is
 * all a trend bucket needs.
 */
export function weekBucketKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7; // days since the most recent Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

export type DecisionForRoiTrend = DecisionForRoi & { createdAt: string };
export type RoiTrendPoint = { weekStart: string; counts: OutcomeCounts; spendUsd: number; costPerDecision: number | null };

/**
 * Pure — buckets decisions into weekly trend points, each with its own
 * real outcome counts and cost-per-autonomous-decision. `spendByWeek` is
 * a plain weekStart -> total $ map the caller builds from its own
 * ai_spend_daily query (spend is tracked per calendar day, not per
 * decision, so it can't be derived from the decisions array alone).
 * Weeks are returned in chronological order; a week with decisions but no
 * matching spend entry correctly reads as $0 for that week, not missing.
 */
export function buildRoiTrend(decisions: DecisionForRoiTrend[], spendByWeek: Map<string, number>): RoiTrendPoint[] {
  const byWeek = new Map<string, DecisionForRoi[]>();
  for (const d of decisions) {
    const key = weekBucketKey(d.createdAt);
    const list = byWeek.get(key) ?? [];
    list.push(d);
    byWeek.set(key, list);
  }
  return [...byWeek.keys()].sort().map((weekStart) => {
    const counts = summarizeDecisionsForRoi(byWeek.get(weekStart)!);
    const spendUsd = Math.round((spendByWeek.get(weekStart) ?? 0) * 100) / 100;
    return { weekStart, counts, spendUsd, costPerDecision: costPerAutonomousDecision(spendUsd, counts.autonomous) };
  });
}

/**
 * Rough, clearly-labeled assumption, not a measured figure: a typical
 * manual review/approval click for one action. Used only to give an
 * account a tangible sense of scale ("about N hours of manual review
 * avoided"), never presented as a precise measurement.
 */
export const ASSUMED_MINUTES_PER_MANUAL_REVIEW = 3;

/** Pure — rough hours of manual-review effort avoided by resolving this many decisions with zero human involved. */
export function estimateManualReviewHoursSaved(autonomousCount: number): number {
  return Math.round(((autonomousCount * ASSUMED_MINUTES_PER_MANUAL_REVIEW) / 60) * 10) / 10;
}

// Integration round, item 4 of the 2026-09-09 slate: automation-value
// (GET /automation-value) was built entirely from agent_decisions/
// ai_spend_daily -- the gating system -- and never extended when
// /respond (a whole second product surface, item 176 on) shipped. A key
// that only ever calls /respond and never /check would read as zero
// automated activity, even though every answered question is exactly
// the same "zero human involved" outcome this report already exists to
// measure. Mirrors summarizeDecisionsForRoi's own autonomous/needsHuman
// split: grounding_check_intervened is /respond's one and only "needs a
// human" signal (it's what item 170's escalation webhook fires on), so
// everything else -- rule-answered or retrieval-answered, fresh or
// served from cache -- is autonomous by the same definition.
export type RespondRowForRoi = { ruleAnswered: boolean; groundingCheckIntervened: boolean; servedFromCache: boolean };

export type RespondCounts = {
  total: number;
  ruleAnswered: number;
  retrievalAnswered: number;
  cacheHits: number;
  needsHuman: number;
  autonomous: number;
};

/** Pure — how much of this key's /respond traffic was answered automatically, and by which tier. */
export function summarizeRespondForRoi(rows: RespondRowForRoi[]): RespondCounts {
  let ruleAnswered = 0, needsHuman = 0, cacheHits = 0;
  for (const r of rows) {
    if (r.ruleAnswered) ruleAnswered++;
    else if (r.groundingCheckIntervened) needsHuman++;
    if (r.servedFromCache) cacheHits++;
  }
  const total = rows.length;
  return {
    total,
    ruleAnswered,
    retrievalAnswered: total - ruleAnswered - needsHuman,
    cacheHits,
    needsHuman,
    autonomous: total - needsHuman,
  };
}

/**
 * Rough, clearly-labeled assumption, separate from
 * ASSUMED_MINUTES_PER_MANUAL_REVIEW -- approving/rejecting a proposed
 * agent action and writing a real answer to an end user's question are
 * different tasks with different typical durations, so they get their
 * own explicit estimate rather than sharing one number that fits neither
 * well.
 */
export const ASSUMED_MINUTES_PER_MANUAL_RESPONSE = 5;

/** Pure — rough hours of manual support-response effort avoided by /respond answering this many questions with zero human involved. */
export function estimateManualResponseHoursSaved(autonomousRespondCount: number): number {
  return Math.round(((autonomousRespondCount * ASSUMED_MINUTES_PER_MANUAL_RESPONSE) / 60) * 10) / 10;
}
