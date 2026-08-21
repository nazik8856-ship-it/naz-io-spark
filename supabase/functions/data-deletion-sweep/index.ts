// Scheduled sweep (pg_cron, daily): executes any data_deletion_requests
// whose 7-day grace period has elapsed, deleting the account's AI
// Control System governance data -- decisions, rules, incidents, spend
// history, audit trail, webhooks. Deliberately does NOT delete `agents`
// or `account_members` -- those are the customer's actual product
// configuration and team structure, not governance/audit data, and
// deleting them would be a much bigger, different action than what this
// request is asking for. Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Order doesn't matter for correctness (every FK here is ON DELETE
// CASCADE from its parent), but children first keeps each individual
// delete small and avoids relying on cascade alone.
const GOVERNANCE_TABLES = [
  "hard_rule_shadow_hits",
  "pending_approval_events",
  "pending_approvals",
  "agent_decisions",
  "incidents",
  "hard_rules",
  "safety_rules",
  "agent_strictness_overrides",
  "ai_spend_caps",
  "ai_spend_daily",
  "config_changes",
  "control_test_runs",
  "critical_alerts",
  "webhook_deliveries",
  "webhooks",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: due, error } = await admin
    .from("data_deletion_requests")
    .select("id, user_id")
    .eq("status", "pending")
    .lte("execute_at", new Date().toISOString());
  if (error) return json({ error: error.message }, 500);

  const outcomes: { requestId: string; userId: string; deletedByTable: Record<string, number>; error: string | null }[] = [];

  for (const dueReq of (due ?? []) as { id: string; user_id: string }[]) {
    const deletedByTable: Record<string, number> = {};
    try {
      for (const table of GOVERNANCE_TABLES) {
        const { data } = await admin.from(table).delete().eq("user_id", dueReq.user_id).select("id");
        deletedByTable[table] = (data ?? []).length;
      }
      await admin.from("data_deletion_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", dueReq.id);
      outcomes.push({ requestId: dueReq.id, userId: dueReq.user_id, deletedByTable, error: null });
    } catch (e) {
      outcomes.push({ requestId: dueReq.id, userId: dueReq.user_id, deletedByTable, error: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return json({ ok: true, checked: outcomes.length, outcomes });
});
