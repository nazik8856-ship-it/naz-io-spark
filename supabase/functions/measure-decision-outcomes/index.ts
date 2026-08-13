// Phase 3 — outcome tracking.
//
// Scheduled job: takes agent decisions made ~7 and ~30 days ago, finds the
// integration snapshot metrics that existed *around the decision* and compares
// them with the most recent snapshot for the same provider/metric. The measured
// move is written to `decision_outcomes` and, when meaningful, surfaced as a
// learned pattern in the existing `org_insights` table (linked, not duplicated).
//
// This job never changes agent behaviour — it only collects and surfaces data.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WINDOWS = [7, 30];
/** Below this relative move a metric is treated as noise -> neutral. */
const NEUTRAL_BAND_PCT = 3;
/** Metrics where "up" is bad. */
const INVERSE_METRICS = /(overdue|bounce|churn|error|failed|unread|refund|cancel)/i;

type Json = Record<string, unknown>;

/** Flatten a snapshot payload into `path -> number` metric pairs. */
function numericMetrics(data: unknown, prefix = "", out: Record<string, number> = {}) {
  if (!data || typeof data !== "object") return out;
  for (const [k, v] of Object.entries(data as Json)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) out[path] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) numericMetrics(v, path, out);
    else if (Array.isArray(v)) out[`${path}.count`] = v.length;
  }
  return out;
}

function classify(metric: string, deltaPct: number): "positive" | "negative" | "neutral" {
  if (!Number.isFinite(deltaPct) || Math.abs(deltaPct) < NEUTRAL_BAND_PCT) return "neutral";
  const up = deltaPct > 0;
  const inverse = INVERSE_METRICS.test(metric);
  return up !== inverse ? "positive" : "negative";
}

function humanMetric(provider: string, metric: string) {
  return `${provider} ${metric.replace(/[._]/g, " ")}`.trim();
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
      if (body && typeof body.userId === "string") scopedUserId = body.userId;
    } catch { /* cron sends no body */ }

    const now = Date.now();
    const oldest = new Date(now - 31 * 86_400_000).toISOString();

    let q = supabase
      .from("agent_decisions")
      .select("id, user_id, agent_id, decision, reasoning, human_response, created_at")
      .gte("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(400);
    if (scopedUserId) q = q.eq("user_id", scopedUserId);

    const { data: decisions, error: decErr } = await q;
    if (decErr) throw decErr;

    let measured = 0;
    let insightsWritten = 0;

    for (const d of decisions ?? []) {
      const ageDays = (now - new Date(d.created_at).getTime()) / 86_400_000;
      // Only measure decisions that have just crossed a 7d or 30d checkpoint.
      const window = WINDOWS.find((w) => ageDays >= w && ageDays < w + 1.5);
      if (!window) continue;

      // Snapshots for this user, from the decision time onwards.
      const { data: snaps } = await supabase
        .from("integration_snapshots")
        .select("provider, kind, data, fetched_at, error")
        .eq("user_id", d.user_id)
        .gte("fetched_at", new Date(new Date(d.created_at).getTime() - 2 * 86_400_000).toISOString())
        .order("fetched_at", { ascending: true })
        .limit(500);
      if (!snaps?.length) continue;

      const decisionTs = new Date(d.created_at).getTime();
      // Fit/value learning loop: a "Deferred — not a fit" verdict the human
      // overrode is the most valuable outcome we can measure — it tells the fit
      // model whether its judgement of business value was actually right.
      const fitOverride =
        String(d.decision ?? "").toUpperCase().startsWith("DEFERRED") &&
        d.human_response === "allowed";

      // provider -> { baseline, latest } metric maps
      const byProvider = new Map<string, { baseline?: Record<string, number>; latest?: Record<string, number>; latestAt?: string }>();
      for (const s of snaps) {
        if (s.error) continue;
        const metrics = numericMetrics(s.data);
        if (!Object.keys(metrics).length) continue;
        const entry = byProvider.get(s.provider) ?? {};
        const ts = new Date(s.fetched_at).getTime();
        if (ts <= decisionTs + 86_400_000 && !entry.baseline) entry.baseline = metrics;
        entry.latest = { ...(entry.latest ?? {}), ...metrics };
        entry.latestAt = s.fetched_at;
        byProvider.set(s.provider, entry);
      }

      for (const [provider, entry] of byProvider) {
        if (!entry.baseline || !entry.latest) continue;
        for (const [metric, before] of Object.entries(entry.baseline)) {
          const after = entry.latest[metric];
          if (typeof after !== "number") continue;
          const delta = after - before;
          const deltaPct = before === 0 ? (delta === 0 ? 0 : 100) : (delta / Math.abs(before)) * 100;
          const direction = classify(metric, deltaPct);

          const { data: row, error: upErr } = await supabase
            .from("decision_outcomes")
            .upsert(
              {
                user_id: d.user_id,
                decision_id: d.id,
                agent_id: d.agent_id,
                provider,
                linked_metric: metric,
                baseline_value: before,
                result_value: after,
                delta,
                delta_pct: Number(deltaPct.toFixed(2)),
                direction,
                window_days: window,
                evidence: {
                  decision: d.decision,
                  reasoning: d.reasoning,
                  measured_from: d.created_at,
                  measured_to: entry.latestAt,
                  fit_override: fitOverride,
                  overridden_verdict: fitOverride ? "deferred_not_a_fit" : null,
                },
                measured_at: new Date().toISOString(),
              },
              { onConflict: "decision_id,linked_metric,window_days" },
            )
            .select("id, org_insight_id")
            .single();
          if (upErr) continue;
          measured++;

          // Surface only meaningful moves as a learned pattern in org_insights.
          if (direction === "neutral" || row?.org_insight_id) continue;

          const insightText = fitOverride
            ? `You overrode "not a fit" on "${String(d.decision).slice(0, 140)}" and ` +
              `${humanMetric(provider, metric)} ${delta >= 0 ? "rose" : "fell"} ` +
              `${Math.abs(deltaPct).toFixed(1)}% over ${window} days (${before} → ${after}). ` +
              `Fit judgement was ${direction === "positive" ? "too cautious" : "correct"}.`
            : `After "${String(d.decision).slice(0, 140)}", ${humanMetric(provider, metric)} ` +
            `${delta >= 0 ? "rose" : "fell"} ${Math.abs(deltaPct).toFixed(1)}% over ${window} days ` +
            `(${before} → ${after}). Outcome: ${direction}.`;

          const { data: existing } = await supabase
            .from("org_insights")
            .select("id, evidence_count, source_agent_ids")
            .eq("user_id", d.user_id)
            .eq("insight", insightText)
            .maybeSingle();

          let insightId = existing?.id as string | undefined;
          if (existing) {
            await supabase
              .from("org_insights")
              .update({
                evidence_count: (existing.evidence_count ?? 1) + 1,
                last_confirmed_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          } else {
            const { data: ins } = await supabase
              .from("org_insights")
              .insert({
                user_id: d.user_id,
                insight: insightText,
                kind: fitOverride ? "fit" : "outcome",
                confidence: Math.abs(deltaPct) > 15 ? "high" : "medium",
                evidence_count: 1,
                source_agent_ids: d.agent_id ? [d.agent_id] : [],
              })
              .select("id")
              .single();
            insightId = ins?.id;
            if (insightId) insightsWritten++;
          }

          if (insightId && row?.id) {
            await supabase.from("decision_outcomes").update({ org_insight_id: insightId }).eq("id", row.id);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, decisions_scanned: decisions?.length ?? 0, outcomes_measured: measured, insights_written: insightsWritten }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("measure-decision-outcomes failed:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
