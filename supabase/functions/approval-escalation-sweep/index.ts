// Scheduled sweep (pg_cron): finds pending approvals left untouched past a
// risk-scaled threshold (_shared/escalation.ts) and fires a stronger alert
// + opens an incident for each. Service-role only — this is a cron entry
// point, not something a client ever calls directly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isOverdueForEscalation, hoursSince, type PendingApprovalLike } from "../_shared/escalation.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = PendingApprovalLike & {
  id: string;
  user_id: string;
  action_type: string;
  provider: string;
  decision_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: rows, error } = await admin
    .from("pending_approvals")
    .select("id, user_id, action_type, provider, risk_tier, created_at, escalated_at, status, decision_id")
    .eq("status", "pending")
    .is("escalated_at", null);
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  let escalated = 0;
  for (const row of (rows ?? []) as Row[]) {
    if (!isOverdueForEscalation(row, now)) continue;

    // Atomic: only the sweep that actually flips escalated_at gets to
    // alert — a second sweep racing on the same row (unlikely at a 30-min
    // cadence, but cheap to guard) sees no row back and skips.
    const { data: claimed } = await admin
      .from("pending_approvals")
      .update({ escalated_at: now.toISOString() })
      .eq("id", row.id)
      .is("escalated_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const waitedHours = Math.round(hoursSince(row.created_at, now));
    await sendCriticalAlert(admin, row.user_id, {
      event: "approval_escalated",
      summary: `A ${row.risk_tier} risk "${row.action_type}" approval has been waiting ${waitedHours}h with no response.`,
      decisionId: row.decision_id,
      actionType: row.action_type,
      provider: row.provider,
    });
    escalated++;
  }

  return json({ ok: true, checked: (rows ?? []).length, escalated });
});
