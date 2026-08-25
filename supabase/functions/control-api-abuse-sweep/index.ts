// Scheduled (pg_cron, every 15 min): abuse/cost-bomb alerting for the
// public control-api endpoint.
//
// control-api itself only rate-limits per minute -- nothing previously
// looked at a WIDER window to notice a key whose recent call volume or
// non-allow rate looks like a leaked key being probed with garbage, or a
// misbehaving external integration stuck retrying a rejected action. This
// sweep queries every agent_decisions row attributed to a control-api key
// (item 8's api_key_id column) in the last LOOKBACK_MINUTES, groups by
// key, and alerts on the ones crossing either threshold that this sweep
// hasn't already alerted on since the last time the key was healthy --
// abuse_alerted_at is cleared the moment a key's rolling-window activity
// drops back under both thresholds, so a later, independent spike still
// gets its own alert (same moving-window reasoning as
// webhooks.alerted_at / agent_integrations.revoked_alerted_at).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { summarizeKeyActivity, isVolumeAbuse, isBlockRateAbuse, summarizeAbuseReason, type DecisionRow } from "../_shared/control-api-abuse.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOOKBACK_MINUTES = 15;
// Deliberately generous defaults -- a legitimate high-volume integration
// can run hot; these are sized against a genuinely abnormal spike or a
// probing pattern, not normal heavy use. Tune once real traffic exists.
const VOLUME_THRESHOLD = 500;
const BLOCK_RATE_MIN_SAMPLE = 20;
const BLOCK_RATE_THRESHOLD = 0.5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("agent_decisions")
    .select("api_key_id, user_id, decision")
    .not("api_key_id", "is", null)
    .gte("created_at", since);
  if (error) return json({ error: error.message }, 500);

  const activity = summarizeKeyActivity((data ?? []) as DecisionRow[]);

  const alerted: string[] = [];
  const cleared: string[] = [];
  for (const a of activity) {
    const abusive =
      isVolumeAbuse(a.total, VOLUME_THRESHOLD) ||
      isBlockRateAbuse(a.total, a.nonAllow, BLOCK_RATE_MIN_SAMPLE, BLOCK_RATE_THRESHOLD);

    const { data: keyRow } = await admin
      .from("api_keys")
      .select("abuse_alerted_at, key_prefix")
      .eq("id", a.apiKeyId)
      .maybeSingle();
    const key = keyRow as { abuse_alerted_at?: string | null; key_prefix?: string } | null;
    const alreadyAlerted = !!key?.abuse_alerted_at;

    if (abusive && !alreadyAlerted) {
      try {
        await sendCriticalAlert(admin, a.userId, {
          event: "control_api_abuse",
          summary: `Your Control API key ${key?.key_prefix ?? "(unknown)"} shows ${summarizeAbuseReason(a, VOLUME_THRESHOLD, BLOCK_RATE_MIN_SAMPLE, BLOCK_RATE_THRESHOLD)}`,
        });
        const { error: updErr } = await admin
          .from("api_keys")
          .update({ abuse_alerted_at: new Date().toISOString() })
          .eq("id", a.apiKeyId);
        if (updErr) console.error(`[CONTROL API ABUSE SWEEP] failed to stamp ${a.apiKeyId}: ${updErr.message}`);
        else alerted.push(a.apiKeyId);
      } catch (e) {
        console.error(`[CONTROL API ABUSE SWEEP] alert failed for ${a.apiKeyId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (!abusive && alreadyAlerted) {
      const { error: clearErr } = await admin
        .from("api_keys")
        .update({ abuse_alerted_at: null })
        .eq("id", a.apiKeyId);
      if (!clearErr) cleared.push(a.apiKeyId);
    }
  }

  if (alerted.length > 0) {
    console.error(`[CONTROL API ABUSE SWEEP] alerted on ${alerted.length} key(s): ${alerted.join(", ")}`);
  }

  return json({ ok: true, keysChecked: activity.length, alerted: alerted.length, cleared: cleared.length });
});
