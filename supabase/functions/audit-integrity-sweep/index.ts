// Scheduled (pg_cron, weekly) — turns the existing manual "Verify
// signatures" button (ControlAuditVerify.tsx, verify_decision_signatures_batch)
// into an actual automatic safety net, the same way control-self-audit
// turned the manual control-test-suite button into one.
//
// verify_decision_signatures_batch reads auth.uid() internally, which is
// NULL under a service-role cron call -- it would fail closed on every org
// if called as-is from here. Uses the new
// verify_decision_signatures_batch_for(_user_id, ...) service-role-gated
// overload instead (see the migration) -- same verification logic,
// delegated to a shared private helper so the two can never drift.
//
// Two call modes, mirroring control-self-audit/index.ts exactly:
//
// 1. Service-role (no body / no target user) — the weekly cron entry
//    point. Verifies every org with at least one agent_decisions row in
//    the lookback window, persists every run (clean or not) to
//    audit_integrity_runs, and sends a critical alert for any org with a
//    mismatched signature or an unsigned decision in range.
//
// 2. A real user JWT — runs the sweep for just that one caller.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { isAuditIntegrityFailure, summarizeAuditIntegrityFailure, type SignatureVerifyResult } from "../_shared/audit-integrity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// A bit more than a week so a slightly-delayed run never leaves a gap
// between what this sweep last covered and what it covers now.
const LOOKBACK_DAYS = 8;

async function sweepOrg(
  admin: ReturnType<typeof createClient>,
  userId: string,
  from: string,
  to: string,
  triggeredBy: "manual" | "scheduled",
): Promise<{ userId: string; ok: boolean; error: string | null } & Partial<SignatureVerifyResult>> {
  const { data, error } = await admin.rpc("verify_decision_signatures_batch_for", {
    _user_id: userId, _from: from, _to: to, _limit: 20000,
  });
  if (error) return { userId, ok: false, error: error.message };
  const result = data as SignatureVerifyResult;

  await admin.from("audit_integrity_runs").insert({
    user_id: userId,
    triggered_by: triggeredBy,
    checked: result.checked,
    verified: result.verified,
    unsigned: result.unsigned,
    mismatched_count: result.mismatched_count,
    range_from: from,
    range_to: to,
  });

  const failed = isAuditIntegrityFailure(result);
  if (failed) {
    await sendCriticalAlert(admin, userId, {
      event: "audit_integrity_failure",
      summary: summarizeAuditIntegrityFailure(result),
    });
  }

  return { userId, ok: !failed, error: null, ...result };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const to = new Date().toISOString();
  const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const isServiceRole = authHeader === `Bearer ${serviceKey}`;
  if (isServiceRole) {
    // Scheduled entry point: sweep every org with at least one decision in
    // the lookback window.
    const { data: rows, error } = await admin.rpc("get_recent_decision_user_ids", { _since: from });
    if (error) return json({ error: error.message }, 500);
    const userIds = ((rows ?? []) as { user_id: string }[]).map((r) => r.user_id);

    const outcomes = [];
    for (const userId of userIds) {
      outcomes.push(await sweepOrg(admin, userId, from, to, "scheduled"));
    }
    return json({
      ok: outcomes.every((o) => o.ok && !o.error),
      swept: outcomes.length,
      outcomes,
    });
  }

  // Real user JWT: sweep just that one caller ("verify now" equivalent).
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const outcome = await sweepOrg(admin, userData.user.id, from, to, "manual");
  return json(outcome, outcome.error ? 502 : 200);
});
