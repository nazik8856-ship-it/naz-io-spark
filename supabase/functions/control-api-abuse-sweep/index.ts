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
import { summarizeKeyActivity, isVolumeAbuse, isBlockRateAbuse, summarizeAbuseReason, computePauseUntil, summarizeAccountActivity, isCoordinatedAccountAbuse, summarizeCoordinatedAbuse, type DecisionRow } from "../_shared/control-api-abuse.ts";
import { isRepeatedPauseTrouble, summarizePolicyDowngrade } from "../_shared/policy-downgrade.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { openIncident } from "../_shared/incidents.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

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
      .select("abuse_alerted_at, key_prefix, pause_count, last_pause_at, on_uncertain_downgraded_at")
      .eq("id", a.apiKeyId)
      .maybeSingle();
    const key = keyRow as {
      abuse_alerted_at?: string | null; key_prefix?: string; pause_count?: number;
      last_pause_at?: string | null; on_uncertain_downgraded_at?: string | null;
    } | null;
    const alreadyAlerted = !!key?.abuse_alerted_at;

    if (abusive && !alreadyAlerted) {
      // "Zero human review" plan, item 7: alerting alone only ever reaches
      // a human -- exactly the wrong answer for a fully-automated
      // integration where nobody may be watching alerts at all. Pause the
      // key itself for a bounded cooldown at the same moment it's
      // alerted, so a leaked/misbehaving key stops actually running the
      // instant this sweep notices it, not whenever a person gets to it.
      const now = new Date();
      const pausedUntil = computePauseUntil(now);
      const reason = summarizeAbuseReason(a, VOLUME_THRESHOLD, BLOCK_RATE_MIN_SAMPLE, BLOCK_RATE_THRESHOLD);
      const summary = `Your Control API key ${key?.key_prefix ?? "(unknown)"} shows ${reason} It has been automatically paused and will resume accepting requests on its own at ${pausedUntil}.`;
      // "Policy autonomy" plan, item 4: a key needing this safety net more
      // than once in a short window is real repeated trouble, not an
      // isolated incident -- pulls its own on_uncertain policy back to
      // human_review too, not just another pause. Checked against the
      // PREVIOUS last_pause_at, before it gets overwritten below.
      const repeatedTrouble = isRepeatedPauseTrouble(key?.last_pause_at, now) && !key?.on_uncertain_downgraded_at;
      try {
        await sendCriticalAlert(admin, a.userId, { event: "control_api_abuse", summary });
        const updates: Record<string, unknown> = {
          abuse_alerted_at: now.toISOString(),
          paused_until: pausedUntil,
          pause_count: (key?.pause_count ?? 0) + 1,
          last_pause_at: now.toISOString(),
        };
        let downgradeSummary: string | null = null;
        if (repeatedTrouble) {
          downgradeSummary = summarizePolicyDowngrade("repeated_pause", "");
          updates.on_uncertain = "human_review";
          updates.on_uncertain_downgraded_at = now.toISOString();
          updates.on_uncertain_downgrade_reason = downgradeSummary;
        }
        const { error: updErr } = await admin
          .from("api_keys")
          .update(updates)
          .eq("id", a.apiKeyId);
        if (updErr) console.error(`[CONTROL API ABUSE SWEEP] failed to stamp/pause ${a.apiKeyId}: ${updErr.message}`);
        else {
          alerted.push(a.apiKeyId);
          // A real, auditable automated intervention (not just an alert) --
          // same tier as kill_switch_auto / circuit_breaker_trip, both of
          // which also open an incident the moment the SYSTEM itself takes
          // an action, not only when it merely notices something.
          await openIncident(admin, a.userId, { kind: "control_api_abuse", summary });
          // "Knowledge & autonomy" plan, item 6: tell the account's own
          // systems the moment this happens, instead of making them
          // keep polling for it.
          await triggerWebhooks(admin, a.userId, "api_key_auto_paused", {
            api_key_id: a.apiKeyId, key_prefix: key?.key_prefix ?? null, paused_until: pausedUntil, reason: summary,
          });
          if (downgradeSummary) {
            await sendCriticalAlert(admin, a.userId, { event: "on_uncertain_auto_downgraded", summary: downgradeSummary });
            await openIncident(admin, a.userId, { kind: "on_uncertain_auto_downgraded", summary: downgradeSummary });
            await triggerWebhooks(admin, a.userId, "api_key_on_uncertain_downgraded", {
              api_key_id: a.apiKeyId, key_prefix: key?.key_prefix ?? null, reason: downgradeSummary,
            });
          }
        }
      } catch (e) {
        console.error(`[CONTROL API ABUSE SWEEP] alert/pause failed for ${a.apiKeyId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (!abusive && alreadyAlerted) {
      const { error: clearErr } = await admin
        .from("api_keys")
        .update({ abuse_alerted_at: null })
        .eq("id", a.apiKeyId);
      if (!clearErr) cleared.push(a.apiKeyId);
    }
  }

  // "Policy autonomy" plan, item 2: the SAME rows already fetched above,
  // summed by account instead of by key -- catches traffic spread across
  // multiple keys to stay under each key's own threshold while the
  // account as a whole looks clearly abnormal. Alert-and-flag only,
  // never an automatic pause: unlike the per-key case above, a key
  // caught up in a coordinated pattern may look completely clean on its
  // own, so there is no single key here that's safe to act on
  // automatically -- a human decides which key(s), if any, to pause.
  const accountActivity = summarizeAccountActivity((data ?? []) as DecisionRow[]);
  const coordinatedAlerted: string[] = [];
  const coordinatedCleared: string[] = [];
  for (const acc of accountActivity) {
    const coordinated = isCoordinatedAccountAbuse(acc, VOLUME_THRESHOLD, BLOCK_RATE_MIN_SAMPLE, BLOCK_RATE_THRESHOLD);
    const { data: profileRow } = await admin
      .from("profiles").select("coordinated_abuse_alerted_at").eq("id", acc.userId).maybeSingle();
    const alreadyAlerted = !!(profileRow as { coordinated_abuse_alerted_at?: string | null } | null)?.coordinated_abuse_alerted_at;

    if (coordinated && !alreadyAlerted) {
      const summary = summarizeCoordinatedAbuse(acc, VOLUME_THRESHOLD, BLOCK_RATE_MIN_SAMPLE, BLOCK_RATE_THRESHOLD);
      try {
        await sendCriticalAlert(admin, acc.userId, { event: "control_api_coordinated_abuse", summary });
        const { error: updErr } = await admin
          .from("profiles").update({ coordinated_abuse_alerted_at: new Date().toISOString() }).eq("id", acc.userId);
        if (updErr) console.error(`[CONTROL API ABUSE SWEEP] failed to stamp coordinated abuse for ${acc.userId}: ${updErr.message}`);
        else {
          coordinatedAlerted.push(acc.userId);
          await openIncident(admin, acc.userId, { kind: "control_api_coordinated_abuse", summary });
        }
      } catch (e) {
        console.error(`[CONTROL API ABUSE SWEEP] coordinated-abuse alert failed for ${acc.userId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (!coordinated && alreadyAlerted) {
      const { error: clearErr } = await admin
        .from("profiles").update({ coordinated_abuse_alerted_at: null }).eq("id", acc.userId);
      if (!clearErr) coordinatedCleared.push(acc.userId);
    }
  }
  // Same "zero activity is, by definition, not abusive" reconciliation
  // as the per-key case below -- an account that goes quiet across all
  // its keys would otherwise stay flagged forever.
  const { data: flaggedAccounts } = await admin
    .from("profiles").select("id").not("coordinated_abuse_alerted_at", "is", null);
  const activeAccountIds = new Set(accountActivity.map((a) => a.userId));
  for (const row of (flaggedAccounts ?? []) as { id: string }[]) {
    if (activeAccountIds.has(row.id)) continue;
    const { error: clearErr } = await admin
      .from("profiles").update({ coordinated_abuse_alerted_at: null }).eq("id", row.id);
    if (!clearErr) coordinatedCleared.push(row.id);
  }
  if (coordinatedAlerted.length > 0) {
    console.error(`[CONTROL API ABUSE SWEEP] flagged ${coordinatedAlerted.length} account(s) for coordinated abuse: ${coordinatedAlerted.join(", ")}`);
  }

  // A paused key stops producing agent_decisions rows at all (rejected at
  // auth, before the gate ever runs) -- so once genuinely paused, it can
  // vanish from `activity` entirely and the clearing branch above would
  // never see it again to clear abuse_alerted_at, even long after its
  // pause naturally expired and it went back to being healthy. Separately
  // reconsider every key still flagged (alerted or currently paused) that
  // had ZERO activity in this window at all -- zero traffic is, by
  // definition, not abusive.
  const { data: flaggedRows } = await admin
    .from("api_keys")
    .select("id")
    .or(`abuse_alerted_at.not.is.null,paused_until.gt.${new Date().toISOString()}`);
  const activeIds = new Set(activity.map((a) => a.apiKeyId));
  for (const row of (flaggedRows ?? []) as { id: string }[]) {
    if (activeIds.has(row.id)) continue; // already handled above
    const { error: clearErr } = await admin
      .from("api_keys")
      .update({ abuse_alerted_at: null })
      .eq("id", row.id);
    if (!clearErr) cleared.push(row.id);
  }

  if (alerted.length > 0) {
    console.error(`[CONTROL API ABUSE SWEEP] alerted/paused ${alerted.length} key(s): ${alerted.join(", ")}`);
  }

  return json({
    ok: true,
    keysChecked: activity.length,
    alerted: alerted.length,
    cleared: cleared.length,
    accountsChecked: accountActivity.length,
    coordinatedAlerted: coordinatedAlerted.length,
    coordinatedCleared: coordinatedCleared.length,
  });
});
