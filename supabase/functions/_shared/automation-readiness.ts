// "Policy autonomy" plan, item 11: give an account a real, evidence-based
// answer to "what's actually stopping me from fully automating this kind
// of action" for one API key -- composing signals that already exist
// independently (item 5's per-key confidence calibration, item 6's
// shadow-promotion-readiness threshold, and the existing precedent-
// contradiction detection, precedent-advice.ts/precedent-citation.ts)
// into one real, readable answer. No new storage, no new detection --
// purely a read/aggregation layer over data this system already
// computes and records elsewhere.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { summarizeShadowObservations, evaluateShadowPromotionReadiness, type ShadowObservationRow, type ShadowPolicySummary, type ShadowPromotionReadiness } from "./api-key-policy.ts";

/** How far back to look for this key's own recent decisions/citations -- same order of magnitude as calibrate-confidence's own lookback, since both are judging "is this key's recent, real behavior trustworthy." */
export const READINESS_LOOKBACK_DAYS = 90;

/** Real decisions logged for this key at all -- below this, every other signal is too thin a sample to trust either way. */
export const MIN_SAMPLE_FOR_READINESS = 20;
/** Below this many recorded precedent citations, "no contradictions yet" just means not enough volume, not a real clean bill of health. */
export const MIN_CITATIONS_FOR_PRECEDENT_SIGNAL = 5;
/** Reuses precedent-advice.ts's own CONTRADICTORY_LOWER_BOUND value, but as its own named constant: that one judges a SINGLE decision's own non-allow share, this judges the RATE of this key's own recorded citations that were specifically "contradictory" rather than a clean non-allow majority. */
export const CONTRADICTORY_CITATION_RATE_BLOCKER = 0.4;
/** "Knowledge & autonomy" plan, item 10: once a key's most recent REAL decision (any window, not just the 90-day lookback the other signals use) is older than this, the evidence backing its current trust is going stale -- worth a flag even when the sample-size signal itself still reads "ok" (e.g. 20 decisions, but all of them weeks ago). */
export const STALE_EVIDENCE_DAYS = 14;

export type AutomationReadinessSignal =
  | { name: "sample_size"; status: "insufficient" | "ok"; detail: string }
  | { name: "confidence_calibration"; status: "flagged" | "ok"; detail: string }
  | { name: "shadow_policy"; status: "not_configured" | "not_ready" | "ready"; detail: string }
  | { name: "precedent_consistency"; status: "not_enough_data" | "contradictory" | "ok"; detail: string }
  | { name: "evidence_recency"; status: "no_data" | "stale" | "ok"; detail: string };

export type AutomationReadinessReport = {
  ready: boolean;
  signals: AutomationReadinessSignal[];
  blockers: string[];
};

export type AutomationReadinessInput = {
  /** Total real decisions logged for this api key in the lookback window. */
  decidedSampleSize: number;
  /** Whether this key currently has an ACTIVE (uncleared) confidence-miscalibration flag of its own -- item 5's per-key confidence_bucket_flags. */
  hasActiveCalibrationFlag: boolean;
  /** null when this key has no shadow_on_uncertain configured at all -- there is simply nothing to judge readiness of. */
  shadowSummary: ShadowPolicySummary | null;
  /** How many of this key's real decisions recorded a precedent citation (item 9's precedent_citations column) in the lookback window, and how many of those were specifically "contradictory" (a genuine mixed bag) rather than a clean non-allow majority. */
  totalPrecedentCitations: number;
  contradictoryPrecedentCitations: number;
  /** Days since this key's single most recent real decision, EVER (not bounded to the 90-day lookback the other signals use) -- null means this key has never logged a real decision at all. */
  daysSinceLastDecision: number | null;
};

/**
 * Pure -- composes the four independent signals above into one real
 * readiness answer. `ready` is true only when EVERY signal that actually
 * had something to say came back clean -- a signal with too little data
 * to judge (insufficient sample, too few citations, no shadow policy
 * configured) is never treated as a pass OR a fail, it just isn't
 * counted against readiness either way.
 */
export function evaluateAutomationReadiness(input: AutomationReadinessInput): AutomationReadinessReport {
  const signals: AutomationReadinessSignal[] = [];
  const blockers: string[] = [];

  if (input.decidedSampleSize < MIN_SAMPLE_FOR_READINESS) {
    const detail = `Only ${input.decidedSampleSize} real decisions logged for this key so far -- needs at least ${MIN_SAMPLE_FOR_READINESS} before any of these signals can be trusted.`;
    signals.push({ name: "sample_size", status: "insufficient", detail });
    blockers.push(detail);
  } else {
    signals.push({ name: "sample_size", status: "ok", detail: `${input.decidedSampleSize} real decisions logged for this key.` });
  }

  if (input.hasActiveCalibrationFlag) {
    const detail = "This key's own confidence scoring is currently flagged as miscalibrated in at least one confidence range -- a human needs to clear that flag before trusting this key's automation more.";
    signals.push({ name: "confidence_calibration", status: "flagged", detail });
    blockers.push(detail);
  } else {
    signals.push({ name: "confidence_calibration", status: "ok", detail: "No active confidence-miscalibration flag for this key." });
  }

  if (!input.shadowSummary) {
    signals.push({
      name: "shadow_policy",
      status: "not_configured",
      detail: "This key isn't currently testing a candidate on_uncertain policy in shadow mode -- consider configuring one to build real evidence before promoting it.",
    });
  } else {
    const readiness: ShadowPromotionReadiness = evaluateShadowPromotionReadiness(input.shadowSummary);
    if (readiness.ready) {
      signals.push({
        name: "shadow_policy",
        status: "ready",
        detail: `The shadow policy this key is testing has earned promotion (${Math.round(readiness.agreementRate * 100)}% agreement across ${readiness.decided} decided outcomes).`,
      });
    } else {
      const detail = readiness.reason === "insufficient_sample"
        ? `The shadow policy this key is testing doesn't have enough decided outcomes yet (${readiness.decided} of ${readiness.required} needed) to judge.`
        : `The shadow policy this key is testing still disagrees with what actually happened too often (${Math.round(readiness.agreementRate * 100)}% agreement, needs ${Math.round(readiness.required * 100)}%).`;
      signals.push({ name: "shadow_policy", status: "not_ready", detail });
      blockers.push(detail);
    }
  }

  if (input.totalPrecedentCitations < MIN_CITATIONS_FOR_PRECEDENT_SIGNAL) {
    signals.push({
      name: "precedent_consistency",
      status: "not_enough_data",
      detail: `Only ${input.totalPrecedentCitations} recorded precedent citation(s) for this key so far -- not enough yet to judge how consistent precedent has been.`,
    });
  } else {
    const rate = Math.round((input.contradictoryPrecedentCitations / input.totalPrecedentCitations) * 100) / 100;
    if (rate >= CONTRADICTORY_CITATION_RATE_BLOCKER) {
      const detail = `${Math.round(rate * 100)}% of this key's ${input.totalPrecedentCitations} recorded precedent citations were genuinely contradictory (no clear pattern either way), not just a clean non-allow majority -- that's its own reason for caution before trusting more automation here.`;
      signals.push({ name: "precedent_consistency", status: "contradictory", detail });
      blockers.push(detail);
    } else {
      signals.push({
        name: "precedent_consistency",
        status: "ok",
        detail: `${input.totalPrecedentCitations} recorded precedent citation(s) for this key, only ${Math.round(rate * 100)}% genuinely contradictory.`,
      });
    }
  }

  // "Knowledge & autonomy" plan, item 10: a genuinely SEPARATE dimension
  // from sample_size above -- a key can clear the sample-size bar (enough
  // decisions in the 90-day window) while every one of them happened
  // weeks ago, which is exactly the "trust assumed to hold forever" gap
  // this item closes. "no_data" (never logged a real decision at all) is
  // deliberately never pushed as its own blocker -- sample_size already
  // covers that root cause; adding a second blocker for the same reason
  // would just be noise.
  if (input.daysSinceLastDecision === null) {
    signals.push({
      name: "evidence_recency",
      status: "no_data",
      detail: "This key has never logged a real decision, so there's no evidence to judge the freshness of.",
    });
  } else if (input.daysSinceLastDecision > STALE_EVIDENCE_DAYS) {
    const detail =
      `This key's most recent real decision was ${input.daysSinceLastDecision} day(s) ago -- past the ` +
      `${STALE_EVIDENCE_DAYS}-day mark, so the evidence behind its current trust is going stale. Worth ` +
      `confirming this key's automation still behaves the way it used to before relying on it further.`;
    signals.push({ name: "evidence_recency", status: "stale", detail });
    blockers.push(detail);
  } else {
    signals.push({
      name: "evidence_recency",
      status: "ok",
      detail: `This key's most recent real decision was ${input.daysSinceLastDecision} day(s) ago -- recent enough to trust.`,
    });
  }

  return { ready: blockers.length === 0, signals, blockers };
}

/**
 * Gathers the four real signals evaluateAutomationReadiness needs for one
 * api key, straight from the tables each already lives in -- no new
 * storage. The shadow-observation join here deliberately duplicates the
 * small query GET /api-keys/:id/shadow-summary already runs (rather than
 * both calling into a shared DB-touching helper) so api-key-policy.ts can
 * stay a pure, I/O-free module, its own established contract. Never
 * throws -- any single lookup failing degrades that one signal to its own
 * "nothing to report" state rather than failing the whole readiness
 * check.
 */
export async function gatherAutomationReadinessInput(
  admin: SupabaseClient,
  apiKeyId: string,
  lookbackDays: number = READINESS_LOOKBACK_DAYS,
): Promise<AutomationReadinessInput> {
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

  let decidedSampleSize = 0;
  try {
    const { count } = await admin
      .from("agent_decisions")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", apiKeyId)
      // "Knowledge & autonomy" plan, item 7: defensive -- a sandbox key is
      // always a distinct row from any real key, so this filter is a
      // no-op in practice, but it keeps this signal explicitly scoped to
      // real evidence rather than relying on that isolation implicitly.
      .eq("is_test", false)
      .gte("created_at", since);
    decidedSampleSize = count ?? 0;
  } catch { /* falls back to 0 -- correctly reads as "insufficient sample" rather than crashing the whole report */ }

  let hasActiveCalibrationFlag = false;
  try {
    const { data } = await admin
      .from("confidence_bucket_flags")
      .select("id")
      .eq("api_key_id", apiKeyId)
      .is("cleared_at", null)
      .limit(1);
    hasActiveCalibrationFlag = Boolean(data && data.length);
  } catch { /* falls back to false -- an unreadable flag table reads as "nothing flagged," never blocks unfairly on a lookup hiccup */ }

  let shadowSummary: ShadowPolicySummary | null = null;
  try {
    const { data: keyRow } = await admin.from("api_keys").select("shadow_on_uncertain").eq("id", apiKeyId).maybeSingle();
    const shadowPolicy = (keyRow as { shadow_on_uncertain?: string | null } | null)?.shadow_on_uncertain ?? null;
    if (shadowPolicy) {
      const { data: obs } = await admin
        .from("api_key_shadow_observations")
        .select("shadow_resolution, action_type, provider, created_at, pending_approvals(status)")
        .eq("api_key_id", apiKeyId)
        .order("created_at", { ascending: false })
        .limit(500);
      type ObsRow = { shadow_resolution: "approved" | "rejected"; action_type: string; provider: string | null; created_at: string; pending_approvals: { status: string | null } | null };
      const rows: ShadowObservationRow[] = ((obs ?? []) as ObsRow[]).map((r) => ({
        shadow_resolution: r.shadow_resolution,
        actual_status: r.pending_approvals?.status ?? null,
        action_type: r.action_type,
        provider: r.provider,
        created_at: r.created_at,
      }));
      shadowSummary = summarizeShadowObservations(rows);
    }
  } catch { /* falls back to null -- reads as "not configured," never blocks unfairly on a lookup hiccup */ }

  let totalPrecedentCitations = 0;
  let contradictoryPrecedentCitations = 0;
  try {
    const { data } = await admin
      .from("agent_decisions")
      .select("precedent_citations")
      .eq("api_key_id", apiKeyId)
      .eq("is_test", false)
      .not("precedent_citations", "is", null)
      .gte("created_at", since)
      .limit(5000);
    const rows = (data ?? []) as { precedent_citations: { reason?: string } | null }[];
    totalPrecedentCitations = rows.length;
    contradictoryPrecedentCitations = rows.filter((r) => r.precedent_citations?.reason === "contradictory").length;
  } catch { /* falls back to 0/0 -- correctly reads as "not enough data" rather than crashing the whole report */ }

  // "Knowledge & autonomy" plan, item 10: deliberately NOT bounded by
  // `since` (the 90-day lookback every other signal above uses) -- a key
  // whose last real decision was 91+ days ago is exactly the "gone
  // stale" case this signal exists to catch, and a lookback-bounded query
  // would silently miss it (an empty result reading identically to "never
  // had one at all").
  let daysSinceLastDecision: number | null = null;
  try {
    const { data: lastRow } = await admin
      .from("agent_decisions")
      .select("created_at")
      .eq("api_key_id", apiKeyId)
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastCreatedAt = (lastRow as { created_at?: string } | null)?.created_at ?? null;
    if (lastCreatedAt) {
      daysSinceLastDecision = Math.floor((Date.now() - new Date(lastCreatedAt).getTime()) / 86400_000);
    }
  } catch { /* falls back to null -- reads as "no data," never blocks unfairly on a lookup hiccup */ }

  return {
    decidedSampleSize, hasActiveCalibrationFlag, shadowSummary,
    totalPrecedentCitations, contradictoryPrecedentCitations, daysSinceLastDecision,
  };
}
