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
import { flagBucketIfNew } from "../_shared/confidence-bucket-flags.ts";

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
      .select("decision_id, direction, user_id, agent_decisions!inner(confidence_score, created_at, user_id, api_key_id)")
      .gte("agent_decisions.created_at", periodStart.toISOString());
    if (scopedUserId) q = q.eq("user_id", scopedUserId);

    const { data: rows, error } = await q.limit(5000);
    if (error) throw error;

    type Agg = { total: number; success: number; failure: number; neutral: number; conf: number[] };
    // "Policy autonomy" plan, item 5: grouped by (user, api_key_id) instead
    // of just user -- an external-api decision (api_key_id set) is tracked
    // under its OWN key, never blended into the account-wide group
    // internal-agent decisions (api_key_id null) still use, exactly as
    // before this change. Keyed by a composite string since Map can't key
    // on a (string, string|null) pair directly.
    const groupKey = (userId: string, apiKeyId: string | null) => `${userId}::${apiKeyId ?? ""}`;
    const perGroup = new Map<string, { userId: string; apiKeyId: string | null; byBucket: Map<number, Agg> }>();
    // De-dup: one decision may have several measured outcomes (7d + 30d).
    const seen = new Map<string, { user: string; apiKeyId: string | null; conf: number; dir: string }>();

    for (const r of (rows || []) as Array<Record<string, any>>) {
      const dec = r.agent_decisions;
      if (!dec) continue;
      const userId: string = r.user_id || dec.user_id;
      const apiKeyId: string | null = dec.api_key_id ?? null;
      const conf = Number(dec.confidence_score);
      if (!userId || !Number.isFinite(conf)) continue;
      const dir = String(r.direction || "unknown").toLowerCase();
      if (dir === "unknown") continue;
      const prev = seen.get(r.decision_id);
      // Prefer a decisive outcome over a neutral one.
      if (prev && !SUCCESS.test(dir) && !FAILURE.test(dir)) continue;
      seen.set(r.decision_id, { user: userId, apiKeyId, conf, dir });
    }

    for (const { user, apiKeyId, conf, dir } of seen.values()) {
      const bucket = BUCKETS.find((b) => conf >= b.min && conf < b.max) ?? BUCKETS[BUCKETS.length - 1];
      const key = groupKey(user, apiKeyId);
      if (!perGroup.has(key)) perGroup.set(key, { userId: user, apiKeyId, byBucket: new Map() });
      const group = perGroup.get(key)!;
      const agg = group.byBucket.get(bucket.min) ?? { total: 0, success: 0, failure: 0, neutral: 0, conf: [] };
      agg.total += 1;
      agg.conf.push(conf);
      if (SUCCESS.test(dir)) agg.success += 1;
      else if (FAILURE.test(dir)) agg.failure += 1;
      else agg.neutral += 1;
      group.byBucket.set(bucket.min, agg);
    }

    const upserts: Record<string, unknown>[] = [];
    let flagged = 0;
    const keyPrefixCache = new Map<string, string>();
    async function keyPrefixFor(apiKeyId: string): Promise<string> {
      if (keyPrefixCache.has(apiKeyId)) return keyPrefixCache.get(apiKeyId)!;
      const { data } = await supabase.from("api_keys").select("key_prefix").eq("id", apiKeyId).maybeSingle();
      const prefix = (data as { key_prefix?: string } | null)?.key_prefix ?? "(unknown)";
      keyPrefixCache.set(apiKeyId, prefix);
      return prefix;
    }

    for (const { userId, apiKeyId, byBucket } of perGroup.values()) {
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
          const scope = apiKeyId ? `Control API key ${await keyPrefixFor(apiKeyId)}'s` : "Your";
          note =
            `${scope} decisions scored ${label(b.min, b.max)} confidence (avg ${expected.toFixed(0)}%) ` +
            `only succeeded ${successRate.toFixed(0)}% of the time across ${decisive} measured outcomes. ` +
            `The scoring prompt is overconfident in this range and needs review.`;
          flagged += 1;
        }

        // High-severity miscalibration is a real "something is actually
        // wrong with the model's judgement" signal -- surface it the same
        // way any other critical control-system event does (Slack/log +
        // an auto-opened incident), not just as a row nobody looks at.
        if (severity === "severe") {
          const beforeAlert = new Date().toISOString();
          await sendCriticalAlert(supabase, userId, {
            event: "confidence_miscalibrated",
            summary: note!,
          });
          // Best-effort: find the incident sendCriticalAlert just opened, to
          // link it on the flag row. Matched on kind + exact summary + opened
          // since this call started, since sendCriticalAlert doesn't return
          // the incident id it created. A miss here just means incident_id
          // stays null -- the flag (and the threshold widening it drives)
          // still gets created either way.
          const { data: incRow } = await supabase
            .from("incidents")
            .select("id")
            .eq("user_id", userId)
            .eq("kind", "confidence_miscalibrated")
            .eq("summary", note!.slice(0, 2000))
            .gte("opened_at", beforeAlert)
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const incidentId = (incRow as { id?: string } | null)?.id ?? null;
          await flagBucketIfNew(supabase, userId, b.min, Math.min(b.max, 100), incidentId, apiKeyId);
        }

        upserts.push({
          user_id: userId,
          api_key_id: apiKeyId,
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
        .upsert(upserts, { onConflict: "user_id,period_end,bucket_min,api_key_id" });
      if (upErr) throw upErr;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        users: new Set([...perGroup.values()].map((g) => g.userId)).size,
        groups: perGroup.size,
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
