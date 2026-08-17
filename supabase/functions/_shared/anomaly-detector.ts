// Per-agent behavioral-baseline anomaly detection.
//
// A distinct risk class from the circuit breaker: the breaker only reacts to
// FAILURES. This catches abnormal-but-SUCCESSFUL volume or a brand-new
// provider/action_type an agent has never touched before — a run that looks
// fine action-by-action but is wildly outside how this agent normally
// behaves (e.g. an agent that sends ~2 emails/day suddenly sending 40, or an
// agent that has only ever posted to Slack suddenly writing Shopify orders).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ActionEvent = { created_at: string; action_type: string };

export type Baseline = {
  /** Average successful occurrences per day over the window, per action_type. */
  dailyAvgByType: Record<string, number>;
  /** Every action_type seen at least once in the window. */
  knownActionTypes: Set<string>;
  /** Distinct UTC calendar days that had at least one successful action. */
  daysObserved: number;
  windowDays: number;
};

const dayKey = (iso: string) => iso.slice(0, 10);

/** Pure aggregation — no DB. Builds the rolling baseline from raw event rows. */
export function buildBaseline(events: ActionEvent[], windowDays = 14): Baseline {
  const perType: Record<string, number> = {};
  const daysWithActivity = new Set<string>();
  for (const e of events) {
    perType[e.action_type] = (perType[e.action_type] ?? 0) + 1;
    daysWithActivity.add(dayKey(e.created_at));
  }
  const dailyAvgByType: Record<string, number> = {};
  for (const [type, count] of Object.entries(perType)) {
    dailyAvgByType[type] = count / windowDays;
  }
  return {
    dailyAvgByType,
    knownActionTypes: new Set(Object.keys(perType)),
    daysObserved: daysWithActivity.size,
    windowDays,
  };
}

export type AnomalyCheck =
  | { anomalous: false; reason: null }
  | { anomalous: true; reason: string; kind: "new_action_type" | "volume_spike" };

export type AnomalyOptions = {
  /** How many times over the daily average counts as a spike. */
  volumeMultiplier?: number;
  /** Never flag a volume spike below this absolute count, however low the average is. */
  minAbsoluteCount?: number;
  /** Need at least this many distinct days of any history before judging "normal" at all. */
  minDaysObserved?: number;
};

/**
 * Pure decision — no DB. `todayCount` is how many successful occurrences of
 * `actionType` this agent has logged today, INCLUDING the one about to run.
 */
export function detectAnomaly(
  baseline: Baseline,
  actionType: string,
  todayCount: number,
  opts: AnomalyOptions = {},
): AnomalyCheck {
  const multiplier = opts.volumeMultiplier ?? 5;
  const minAbsolute = opts.minAbsoluteCount ?? 3;
  const minDays = opts.minDaysObserved ?? 3;

  // Too little history to know what "normal" looks like for this agent yet —
  // never force an approval just because it's new.
  if (baseline.daysObserved < minDays) return { anomalous: false, reason: null };

  if (!baseline.knownActionTypes.has(actionType)) {
    return {
      anomalous: true,
      kind: "new_action_type",
      reason: `This agent has never done "${actionType}" in its last ${baseline.windowDays} days of activity.`,
    };
  }

  const avg = baseline.dailyAvgByType[actionType] ?? 0;
  const threshold = Math.max(avg * multiplier, minAbsolute);
  if (todayCount >= threshold && todayCount >= minAbsolute) {
    return {
      anomalous: true,
      kind: "volume_spike",
      reason: `${todayCount} "${actionType}" actions today vs. a ${avg.toFixed(2)}/day average over the last ` +
        `${baseline.windowDays} days — ${avg > 0 ? `${(todayCount / avg).toFixed(1)}x` : "far above"} normal volume.`,
    };
  }

  return { anomalous: false, reason: null };
}

/** Fetches the trailing window of this agent's successful action events and builds its baseline. */
export async function loadAgentBaseline(
  admin: SupabaseClient,
  agentId: string,
  windowDays = 14,
): Promise<Baseline> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("agent_events")
    .select("payload, created_at")
    .eq("agent_id", agentId)
    .eq("kind", "action")
    .gte("created_at", since);
  const events: ActionEvent[] = ((data ?? []) as { payload: Record<string, unknown>; created_at: string }[])
    .filter((r) => r.payload?.ok === true && typeof r.payload?.type === "string")
    .map((r) => ({ created_at: r.created_at, action_type: String(r.payload.type) }));
  return buildBaseline(events, windowDays);
}

/** How many successful `actionType` events this agent has already logged today (UTC), so far. */
export async function countTodaySuccesses(
  admin: SupabaseClient,
  agentId: string,
  actionType: string,
): Promise<number> {
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  const { data } = await admin
    .from("agent_events")
    .select("payload")
    .eq("agent_id", agentId)
    .eq("kind", "action")
    .gte("created_at", startOfUtcDay.toISOString());
  return ((data ?? []) as { payload: Record<string, unknown> }[])
    .filter((r) => r.payload?.ok === true && r.payload?.type === actionType)
    .length;
}
