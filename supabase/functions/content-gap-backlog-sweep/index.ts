// Scheduled sweep (pg_cron, every 30 min): notices when an api key's
// content-gap backlog (items 179-180) has quietly grown into a real
// problem -- the same question keeps recurring, unresolved, well past
// the point a reasonable person would already have added a rule or
// context entry for it. Nothing about any single occurrence looks wrong
// in the moment (that's exactly what the escalation webhook, item 170,
// already covers per-occurrence), so without this an account owner only
// finds out by manually polling GET /content-gap-clusters themselves.
//
// Same "notice quietly-stopped-working, alert once, clear on recovery"
// shape already proven by precedent-pipeline-health-sweep and
// auto-resolution-share-sweep, applied here to the content-gap pipeline.
// Simpler than precedent-pipeline-health-sweep in one respect: this
// checks every non-revoked key directly (not keys inferred from recent
// traffic), so there's no separate "dormant key stuck alerted forever"
// cleanup pass needed -- every key is re-evaluated every single tick.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isContentGapBacklogStale, summarizeStaleContentGapBacklog, type GapClusterForBacklogHealth,
} from "../_shared/content-gap-backlog-health.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: keys, error } = await admin
    .from("api_keys")
    .select("id, user_id, content_gap_backlog_alerted_at")
    .is("revoked_at", null);
  if (error) return json({ error: error.message }, 500);

  let alerted = 0;
  let cleared = 0;
  let checked = 0;

  for (const key of (keys ?? []) as { id: string; user_id: string; content_gap_backlog_alerted_at: string | null }[]) {
    checked++;
    try {
      const { data: clusterRows, error: clusterErr } = await admin
        .rpc("list_gap_clusters_ranked", { _api_key_id: key.id, _limit: 1 });
      if (clusterErr) {
        console.error(`[CONTENT GAP BACKLOG SWEEP] failed to rank clusters for ${key.id}: ${clusterErr.message}`);
        continue;
      }

      const top = ((clusterRows ?? [])[0] ?? null) as
        { cluster_id: string; representative_message: string; occurrence_count: number } | null;
      const topCluster: GapClusterForBacklogHealth | null = top ? { occurrenceCount: Number(top.occurrence_count) } : null;
      const stale = isContentGapBacklogStale(topCluster);
      const alreadyAlerted = !!key.content_gap_backlog_alerted_at;

      if (stale && top && !alreadyAlerted) {
        const summary = summarizeStaleContentGapBacklog(top.representative_message, Number(top.occurrence_count));
        await sendCriticalAlert(admin, key.user_id, { event: "content_gap_backlog_stale", summary });
        const { error: updErr } = await admin
          .from("api_keys").update({ content_gap_backlog_alerted_at: new Date().toISOString() }).eq("id", key.id);
        if (updErr) console.error(`[CONTENT GAP BACKLOG SWEEP] failed to stamp ${key.id}: ${updErr.message}`);
        else alerted++;
      } else if (!stale && alreadyAlerted) {
        const { error: clearErr } = await admin
          .from("api_keys").update({ content_gap_backlog_alerted_at: null }).eq("id", key.id);
        if (!clearErr) cleared++;
      }
    } catch (e) {
      console.error(`[CONTENT GAP BACKLOG SWEEP] failed for ${key.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({ ok: true, checked, alerted, cleared });
});
