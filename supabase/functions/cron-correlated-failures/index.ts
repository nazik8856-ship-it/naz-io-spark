// Scheduled (pg_cron, every 15 min): looks for a FLEET-WIDE circuit-breaker
// signal that per-agent breakers can't see on their own -- two or more
// DIFFERENT agents on the same account independently tripping a breaker
// for the same (action_type, provider) within the lookback window. That
// pattern looks a lot more like "Gmail is down" than "one agent has a bad
// prompt", and per-agent breaker scoping (2026-08-22) means nothing today
// correlates across agents to surface it.
//
// circuit_breakers itself has no provider column, and every gate/breaker
// query is deliberately siloed per account/agent post-2026-08-22 -- neither
// is the right place to run a cross-cutting join. incidents already has
// user_id/action_type/provider/decision_id for every circuit_breaker_trip,
// so this reads THAT (via a SECURITY DEFINER RPC that also joins in the
// tripping agent_id) instead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  findCorrelatedFailures,
  groupsNeedingNewAlert,
  summarizeCorrelatedFailure,
  type BreakerTripRow,
} from "../_shared/correlated-failures.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOOKBACK_MINUTES = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data: rows, error: rpcErr } = await admin.rpc("get_recent_breaker_trips", { _since: since });
  if (rpcErr) return json({ error: rpcErr.message }, 500);

  const trips: BreakerTripRow[] = ((rows ?? []) as {
    user_id: string; action_type: string; provider: string | null; agent_id: string | null;
    decision_id: string | null; opened_at: string;
  }[]).map((r) => ({
    userId: r.user_id,
    actionType: r.action_type,
    provider: r.provider,
    agentId: r.agent_id,
    decisionId: r.decision_id,
    openedAt: r.opened_at,
  }));

  const groups = findCorrelatedFailures(trips);
  if (groups.length === 0) {
    return json({ ok: true, checkedTrips: trips.length, correlatedGroups: 0, alertsSent: 0 });
  }

  // Only skip a group if it ALREADY has an unresolved incident for the same
  // (user_id, action_type, provider) -- an ongoing outage shouldn't spam a
  // fresh alert on every 15-minute run.
  const { data: openIncidents } = await admin
    .from("incidents")
    .select("user_id, action_type, provider")
    .eq("kind", "correlated_breaker_trip")
    .eq("status", "open");
  const openKeys = ((openIncidents ?? []) as { user_id: string; action_type: string | null; provider: string | null }[])
    .map((i) => ({ userId: i.user_id, actionType: i.action_type ?? "", provider: i.provider }));

  const toAlert = groupsNeedingNewAlert(groups, openKeys);
  let alertsSent = 0;
  for (const g of toAlert) {
    await sendCriticalAlert(admin, g.userId, {
      event: "correlated_breaker_trip",
      summary: summarizeCorrelatedFailure(g),
      decisionId: g.latestDecisionId,
      actionType: g.actionType,
      provider: g.provider,
    });
    alertsSent++;
  }

  return json({
    ok: true,
    checkedTrips: trips.length,
    correlatedGroups: groups.length,
    alertsSent,
  });
});
