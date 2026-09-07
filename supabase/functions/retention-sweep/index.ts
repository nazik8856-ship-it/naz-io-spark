// Scheduled sweep (pg_cron, daily): deletes rows older than each account's
// retention_days window (profiles.retention_days, default 400, floor 30).
// Service-role only.
//
// "15 more items" plan, item 9: originally only covered agent_decisions and
// agent_events. incidents, critical_alerts, webhook_deliveries,
// pending_approvals, and config_changes can all contain real customer
// information (an incident summary or an approval request can include the
// actual action someone was trying to take) and previously accumulated
// forever, only ever removed via a full account-deletion request. Extended
// to cover all five, using the same per-account retention_days setting.
//
// Two tables carry an in-progress state that must never be swept just
// because it's old: an OPEN incident and a PENDING approval are still
// live work, not history, regardless of age -- only resolved/decided rows
// past the cutoff are eligible. critical_alerts, webhook_deliveries, and
// config_changes are pure point-in-time records with no such state, so
// they sweep on age alone, same as agent_decisions/agent_events already do.
//
// Item 13 (same round): policy_watch_observations (added by continuous
// whole-policy shadow watching) is the exact same "will accumulate
// forever" shape item 9 was built to close -- it didn't exist yet when
// item 9 landed, so item 9 couldn't have caught it. It's a pure
// point-in-time record like critical_alerts/webhook_deliveries/
// config_changes, so it sweeps on age alone too.
//
// "Own decision-making machine" plan, item 181: api_response_generations
// (one row per /respond call) is the exact same shape again, one layer
// further removed -- it didn't exist when items 9/13 landed either. It
// sweeps on the account's own retention_days window like every other
// table above, with one exception: a row that is STILL AN UNRESOLVED
// CONTENT GAP (grounding_check_intervened = true AND resolved_at IS
// NULL) is live work feeding items 169/179/180's gap-triage pipeline,
// not settled history -- same "an open incident is still live work
// regardless of age" rule this sweep already applies to incidents and
// pending_approvals above, just expressed as an .or() filter instead of
// a status column. api_response_cache is handled separately, once
// globally rather than per-account below: its expires_at is a real TTL
// completely independent of any account's retention_days setting, so
// looping per-profile to purge it would be both wrong and wasteful.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { retentionCutoffIso } from "../_shared/retention.ts";

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

  const { data: profiles, error } = await admin.from("profiles").select("id, retention_days");
  if (error) return json({ error: error.message }, 500);

  // Item 181: api_response_cache purges on its own explicit expires_at,
  // completely independent of any account's retention_days -- done once
  // globally rather than inside the per-profile loop below.
  let deletedExpiredCache = 0;
  let expiredCacheError: string | null = null;
  try {
    const { data: expiredCache, error: cacheErr } = await admin
      .from("api_response_cache").delete().lt("expires_at", new Date().toISOString()).select("id");
    if (cacheErr) expiredCacheError = cacheErr.message;
    deletedExpiredCache = (expiredCache ?? []).length;
  } catch (e) {
    expiredCacheError = e instanceof Error ? e.message : "unknown error";
  }

  const outcomes: {
    userId: string;
    deletedDecisions: number;
    deletedEvents: number;
    deletedIncidents: number;
    deletedAlerts: number;
    deletedWebhookDeliveries: number;
    deletedApprovals: number;
    deletedConfigChanges: number;
    deletedPolicyWatchObservations: number;
    deletedResponseGenerations: number;
    error: string | null;
  }[] = [];

  for (const p of (profiles ?? []) as { id: string; retention_days: number }[]) {
    const cutoff = retentionCutoffIso(p.retention_days);
    try {
      const [decisions, events, incidents, alerts, deliveries, approvals, changes, watchObs, responseGenerations] = await Promise.all([
        admin.from("agent_decisions").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        admin.from("agent_events").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        admin.from("incidents").delete().eq("user_id", p.id).eq("status", "resolved").lt("opened_at", cutoff).select("id"),
        admin.from("critical_alerts").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        admin.from("webhook_deliveries").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        admin.from("pending_approvals").delete().eq("user_id", p.id).neq("status", "pending").lt("created_at", cutoff).select("id"),
        admin.from("config_changes").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        admin.from("policy_watch_observations").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        // Item 181: same age cutoff as every other table here, except a
        // row that's still an unresolved content gap is live work for
        // items 169/179/180, not settled history -- kept regardless of
        // age, same as an open incident or a pending approval above.
        admin.from("api_response_generations").delete().eq("user_id", p.id).lt("created_at", cutoff)
          .or("grounding_check_intervened.eq.false,resolved_at.not.is.null").select("id"),
      ]);
      outcomes.push({
        userId: p.id,
        deletedDecisions: (decisions.data ?? []).length,
        deletedEvents: (events.data ?? []).length,
        deletedIncidents: (incidents.data ?? []).length,
        deletedAlerts: (alerts.data ?? []).length,
        deletedWebhookDeliveries: (deliveries.data ?? []).length,
        deletedApprovals: (approvals.data ?? []).length,
        deletedConfigChanges: (changes.data ?? []).length,
        deletedPolicyWatchObservations: (watchObs.data ?? []).length,
        deletedResponseGenerations: (responseGenerations.data ?? []).length,
        error: decisions.error?.message ?? events.error?.message ?? incidents.error?.message
          ?? alerts.error?.message ?? deliveries.error?.message ?? approvals.error?.message
          ?? changes.error?.message ?? watchObs.error?.message ?? responseGenerations.error?.message ?? null,
      });
    } catch (e) {
      outcomes.push({
        userId: p.id, deletedDecisions: 0, deletedEvents: 0, deletedIncidents: 0,
        deletedAlerts: 0, deletedWebhookDeliveries: 0, deletedApprovals: 0, deletedConfigChanges: 0,
        deletedPolicyWatchObservations: 0, deletedResponseGenerations: 0,
        error: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  return json({
    ok: true,
    checked: outcomes.length,
    totalDeletedDecisions: outcomes.reduce((n, o) => n + o.deletedDecisions, 0),
    totalDeletedEvents: outcomes.reduce((n, o) => n + o.deletedEvents, 0),
    totalDeletedIncidents: outcomes.reduce((n, o) => n + o.deletedIncidents, 0),
    totalDeletedAlerts: outcomes.reduce((n, o) => n + o.deletedAlerts, 0),
    totalDeletedWebhookDeliveries: outcomes.reduce((n, o) => n + o.deletedWebhookDeliveries, 0),
    totalDeletedApprovals: outcomes.reduce((n, o) => n + o.deletedApprovals, 0),
    totalDeletedConfigChanges: outcomes.reduce((n, o) => n + o.deletedConfigChanges, 0),
    totalDeletedPolicyWatchObservations: outcomes.reduce((n, o) => n + o.deletedPolicyWatchObservations, 0),
    totalDeletedResponseGenerations: outcomes.reduce((n, o) => n + o.deletedResponseGenerations, 0),
    deletedExpiredCache,
    expiredCacheError,
    outcomes,
  });
});
