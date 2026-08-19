// Scheduled sweep (pg_cron, daily): deletes agent_decisions and
// agent_events rows older than each account's retention_days window
// (profiles.retention_days, default 400, floor 30). Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const outcomes: { userId: string; deletedDecisions: number; deletedEvents: number; error: string | null }[] = [];

  for (const p of (profiles ?? []) as { id: string; retention_days: number }[]) {
    const cutoff = new Date(Date.now() - Math.max(30, p.retention_days) * 24 * 60 * 60 * 1000).toISOString();
    try {
      const [decisions, events] = await Promise.all([
        admin.from("agent_decisions").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
        admin.from("agent_events").delete().eq("user_id", p.id).lt("created_at", cutoff).select("id"),
      ]);
      outcomes.push({
        userId: p.id,
        deletedDecisions: (decisions.data ?? []).length,
        deletedEvents: (events.data ?? []).length,
        error: decisions.error?.message ?? events.error?.message ?? null,
      });
    } catch (e) {
      outcomes.push({ userId: p.id, deletedDecisions: 0, deletedEvents: 0, error: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return json({
    ok: true,
    checked: outcomes.length,
    totalDeletedDecisions: outcomes.reduce((n, o) => n + o.deletedDecisions, 0),
    totalDeletedEvents: outcomes.reduce((n, o) => n + o.deletedEvents, 0),
    outcomes,
  });
});
