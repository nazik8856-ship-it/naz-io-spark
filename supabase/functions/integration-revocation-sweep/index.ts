// Scheduled (pg_cron, every 30 min): proactively alerts when a connected
// integration's token has been revoked or expired.
//
// gmail.ts/figma.ts/canva.ts already correctly catch invalid_grant and flip
// agent_integrations.status to "error" with a human-readable last_error --
// but until this sweep existed nothing pushed that out. recordIssue() is
// only ever called from agent-runtime/index.ts, so a dormant agent's dead
// integration was discovered only the next time something happened to hit
// it. This sweep closes that out-of-band gap: it queries every "error"-
// status integration, alerts on the ones this sweep hasn't already alerted
// on since their last break, then stamps revoked_alerted_at so the same
// break isn't re-alerted every 30 minutes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { newlyBrokenIntegrations, summarizeRevokedIntegration, type ErroredIntegrationRow } from "../_shared/integration-revocation.ts";
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

  const { data, error } = await admin
    .from("agent_integrations")
    .select("id, user_id, agent_id, provider, last_error, updated_at, revoked_alerted_at")
    .eq("status", "error");
  if (error) return json({ error: error.message }, 500);

  const rows: ErroredIntegrationRow[] = ((data ?? []) as {
    id: string; user_id: string; agent_id: string | null; provider: string;
    last_error: string | null; updated_at: string; revoked_alerted_at: string | null;
  }[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    agentId: r.agent_id,
    provider: r.provider,
    lastError: r.last_error,
    updatedAt: r.updated_at,
    revokedAlertedAt: r.revoked_alerted_at,
  }));

  const toAlert = newlyBrokenIntegrations(rows);
  const alerted: string[] = [];
  for (const r of toAlert) {
    try {
      await sendCriticalAlert(admin, r.userId, {
        event: "integration_revoked",
        summary: summarizeRevokedIntegration(r),
        actionType: "integration_connection",
        provider: r.provider,
      });
      const { error: updErr } = await admin
        .from("agent_integrations")
        .update({ revoked_alerted_at: new Date().toISOString() })
        .eq("id", r.id);
      if (updErr) console.error(`[INTEGRATION REVOCATION SWEEP] failed to stamp ${r.id}: ${updErr.message}`);
      else alerted.push(r.id);
    } catch (e) {
      console.error(`[INTEGRATION REVOCATION SWEEP] alert failed for ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (alerted.length > 0) {
    console.error(`[INTEGRATION REVOCATION SWEEP] alerted on ${alerted.length} newly-broken integration(s)`);
  }

  return json({ ok: true, checked: rows.length, alerted: alerted.length });
});
