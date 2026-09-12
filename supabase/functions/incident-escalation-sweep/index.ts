// Scheduled sweep (pg_cron): finds incidents left open and unacknowledged
// past INCIDENT_ESCALATION_HOURS (_shared/incident-escalation.ts) and fires
// a re-notification alert for each -- mirrors approval-escalation-sweep's
// exact shape for the same underlying problem (a real signal sitting
// untouched with nobody watching). Deliberately does NOT open a new
// incident for the escalation itself (see the "incident_stale_unacknowledged"
// event's own doc comment in critical-alerts.ts) -- this re-notifies about
// the SAME incident, it never spawns a duplicate. Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isIncidentOverdueForEscalation, INCIDENT_ESCALATION_HOURS, type IncidentLike } from "../_shared/incident-escalation.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = IncidentLike & {
  id: string;
  user_id: string;
  kind: string;
  summary: string;
  action_type: string | null;
  provider: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: rows, error } = await admin
    .from("incidents")
    .select("id, user_id, kind, summary, action_type, provider, opened_at, status, escalation_alerted_at")
    .eq("status", "open")
    .is("escalation_alerted_at", null);
  if (error) return json({ error: error.message }, 500);

  // Per-account configurable threshold (incident_thresholds), falling back
  // to the flat default for any account that's never set one -- fetched
  // once for the whole batch rather than per-row, since this sweep spans
  // every account with a stale-open incident.
  const userIds = [...new Set(((rows ?? []) as Row[]).map((r) => r.user_id))];
  const { data: thresholdRows } = userIds.length
    ? await admin.from("incident_thresholds").select("user_id, escalation_hours").in("user_id", userIds)
    : { data: [] as { user_id: string; escalation_hours: number }[] };
  const escalationHoursByUser = new Map(
    ((thresholdRows ?? []) as { user_id: string; escalation_hours: number }[]).map((t) => [t.user_id, t.escalation_hours]),
  );

  const now = new Date();
  let escalated = 0;
  for (const row of (rows ?? []) as Row[]) {
    const escalationHours = escalationHoursByUser.get(row.user_id) ?? INCIDENT_ESCALATION_HOURS;
    if (!isIncidentOverdueForEscalation(row, now, escalationHours)) continue;

    // Atomic: only the sweep that actually flips escalation_alerted_at
    // gets to alert -- a second sweep racing on the same row sees no row
    // back and skips.
    const { data: claimed } = await admin
      .from("incidents")
      .update({ escalation_alerted_at: now.toISOString() })
      .eq("id", row.id)
      .is("escalation_alerted_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const waitedHours = Math.round((now.getTime() - new Date(row.opened_at).getTime()) / (1000 * 60 * 60));
    await sendCriticalAlert(admin, row.user_id, {
      event: "incident_stale_unacknowledged",
      summary: `An incident has been open ${waitedHours}h with no acknowledgment (≥${escalationHours}h threshold): ${row.summary}`,
      actionType: row.action_type,
      provider: row.provider,
    });
    await triggerWebhooks(admin, row.user_id, "incident_escalated", {
      incident_id: row.id, kind: row.kind, waited_hours: waitedHours,
    });
    escalated++;
  }

  return json({ ok: true, checked: (rows ?? []).length, escalated });
});
