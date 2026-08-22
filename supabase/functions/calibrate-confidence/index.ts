// Weekly calibration job.
//
// Compares the confidence_score recorded on each agent_decision against the
// real measured outcome in decision_outcomes, buckets decisions by confidence
// range (0-20, 20-40, ...) and stores the real success rate per bucket in
// `confidence_calibration`. A bucket is flagged as miscalibrated when the real
// success rate falls meaningfully short of the confidence the model claimed —
// a signal that the scoring prompt needs review.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKETS = [
  { min: 0, max: 20 },
  { min: 20, max: 40 },
  { min: 40, max: 60 },
  { min: 60, max: 80 },
  { min: 80, max: 101 }, // 80-100 inclusive
] as const;

/** Lookback window for decisions considered in a weekly run. */
const LOOKBACK_DAYS = 90;
/** Minimum decisions with a measured outcome before a bucket can be flagged. */
const MIN_SAMPLE = 5;
/** Real success rate may trail expected confidence by this much before flagging. */
const TOLERANCE_PCT = 20;

const SUCCESS = /^(positive|up|improved|success)$/i;
const FAILURE = /^(negative|down|worse|failed|failure)$/i;

function label(min: number, max: number) {
  return `${min}-${Math.min(max, 100)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let scopedUserId: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.user_id === "string") scopedUserId = body.user_id;
    } catch { /* cron sends no body */ }

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - LOOKBACK_DAYS * 86400_000);

    // Outcomes measured for decisions in the window, joined with the decision's
    // confidence at the time it was made.
    let q = supabase
      .from("decision_outcomes")
      .select("decision_id, direction, user_id, agent_decisions!inner(confidence_score, created_at, user_id)")
      .gte("agent_decisions.created_at", periodStart.toISOString());
    if (scopedUserId) q = q.eq("user_id", scopedUserId);

    const { data: rows, error } = await q.limit(5000);
    if (error) throw error;

    type Agg = { total: number; success: number; failure: number; neutral: number; conf: number[] };
    const perUser = new Map<string, Map<number, Agg>>();
    // De-dup: one decision may have several measured outcomes (7d + 30d).
    const seen = new Map<string, { user: string; conf: number; dir: string }>();

    for (const r of (rows || []) as Array<Record<string, any>>) {
      const dec = r.agent_decisions;
      if (!dec) continue;
      const userId: string = r.user_id || dec.user_id;
      const conf = Number(dec.confidence_score);
      if (!userId || !Number.isFinite(conf)) continue;
      const dir = String(r.direction || "unknown").toLowerCase();
      if (dir === "unknown") continue;
      const prev = seen.get(r.decision_id);
      // Prefer a decisive outcome over a neutral one.
      if (prev && !SUCCESS.test(dir) && !FAILURE.test(dir)) continue;
      seen.set(r.decision_id, { user: userId, conf, dir });
    }

    for (const { user, conf, dir } of seen.values()) {
      const bucket = BUCKETS.find((b) => conf >= b.min && conf < b.max) ?? BUCKETS[BUCKETS.length - 1];
      if (!perUser.has(user)) perUser.set(user, new Map());
      const byBucket = perUser.get(user)!;
      const agg = byBucket.get(bucket.min) ?? { total: 0, success: 0, failure: 0, neutral: 0, conf: [] };
      agg.total += 1;
      agg.conf.push(conf);
      if (SUCCESS.test(dir)) agg.success += 1;
      else if (FAILURE.test(dir)) agg.failure += 1;
      else agg.neutral += 1;
      byBucket.set(bucket.min, agg);
    }

    const upserts: Record<string, unknown>[] = [];
    let flagged = 0;

    for (const [userId, byBucket] of perUser) {
      for (const b of BUCKETS) {
        const agg = byBucket.get(b.min);
        if (!agg) continue;
        const decisive = agg.success + agg.failure;
        const successRate = decisive > 0 ? (agg.success / decisive) * 100 : null;
        const expected = agg.conf.reduce((a, c) => a + c, 0) / agg.conf.length;
        const gap = successRate === null ? null : Number((successRate - expected).toFixed(1));

        let miscalibrated = false;
        let severity = "ok";
        let note: string | null = null;
        if (successRate !== null && decisive >= MIN_SAMPLE && gap !== null && gap < -TOLERANCE_PCT) {
          miscalibrated = true;
          severity = gap < -35 ? "severe" : "warning";
          note =
            `Decisions scored ${label(b.min, b.max)} confidence (avg ${expected.toFixed(0)}%) ` +
            `only succeeded ${successRate.toFixed(0)}% of the time across ${decisive} measured outcomes. ` +
            `The scoring prompt is overconfident in this range and needs review.`;
          flagged += 1;
        }

        // High-severity miscalibration is a real "something is actually
        // wrong with the model's judgement" signal -- surface it the same
        // way any other critical control-system event does (Slack/log +
        // an auto-opened incident), not just as a row nobody looks at.
        if (severity === "severe") {
          await sendCriticalAlert(supabase, userId, {
            event: "confidence_miscalibrated",
            summary: note!,
          });
        }

        upserts.push({
          user_id: userId,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          bucket_min: b.min,
          bucket_max: Math.min(b.max, 100),
          bucket_label: label(b.min, b.max),
          decision_count: agg.total,
          success_count: agg.success,
          failure_count: agg.failure,
          neutral_count: agg.neutral,
          success_rate: successRate === null ? null : Number(successRate.toFixed(1)),
          expected_rate: Number(expected.toFixed(1)),
          calibration_gap: gap,
          miscalibrated,
          severity,
          note,
        });
      }
    }

    if (upserts.length) {
      const { error: upErr } = await supabase
        .from("confidence_calibration")
        .upsert(upserts, { onConflict: "user_id,period_end,bucket_min" });
      if (upErr) throw upErr;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        users: perUser.size,
        buckets_written: upserts.length,
        decisions_measured: seen.size,
        miscalibrated_buckets: flagged,
        period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("calibrate-confidence failed:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
