// Scheduled self-audit — turns control-test-suite from "something a human
// has to remember to run" into an actual safety net.
//
// Two call modes:
//
// 1. Service-role (no body / no target user) — the weekly cron entry point.
//    Iterates every org with an ACTIVE policy version and runs the 30-scenario
//    suite against each of them internally (no human session token), diffs
//    each result against that org's last stored run, and sends a critical
//    alert (Slack, or a prominent log) for any org whose pass rate drops
//    below 100% or whose regressions list is non-empty. Every run — clean or
//    not — is persisted to control_test_runs so the next run has something
//    to diff against and so the Policy page can show real audit history.
//
// 2. A real user JWT — runs the suite for just that one caller (used by a
//    "run self-audit now" button), same persistence and alerting logic.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONTROL_SCENARIOS } from "../_shared/control-scenarios.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { findRegressions } from "../_shared/self-audit-diff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type SuiteReport = {
  ok: boolean;
  summary: { total: number; pass: number; soft_pass: number; fail: number; error: number };
  pass_rate_pct: number;
  results: { id: string; status: string }[];
};

/** Runs the full scenario suite for one org via control-test-suite, internally. */
async function runSuiteFor(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<SuiteReport | { error: string }> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/control-test-suite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "x-internal-user-id": userId,
      },
      // Dry run — a self-audit must never carry out a real provider write.
      body: JSON.stringify({ dry_run: true, concurrency: 4 }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { error: `control-test-suite returned ${resp.status}: ${JSON.stringify(data).slice(0, 300)}` };
    return data as SuiteReport;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "unknown error" };
  }
}

/** Audits one org: runs the suite, diffs against its last run, persists, alerts on regression. */
async function auditOrg(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  triggeredBy: "manual" | "scheduled",
): Promise<{ userId: string; ok: boolean; pass_rate_pct: number | null; regressions: string[]; error: string | null }> {
  const report = await runSuiteFor(supabaseUrl, serviceKey, userId);
  if ("error" in report) {
    return { userId, ok: false, pass_rate_pct: null, regressions: [], error: report.error };
  }

  const scenarioStatus: Record<string, string> = {};
  for (const r of report.results) scenarioStatus[r.id] = r.status;

  const { data: prevRow } = await admin
    .from("control_test_runs")
    .select("scenario_status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevStatus = ((prevRow as { scenario_status?: Record<string, string> } | null)?.scenario_status) ?? {};

  const regressions = findRegressions(CONTROL_SCENARIOS.map((s) => s.id), prevStatus, scenarioStatus);

  let policyVersion: number | null = null;
  let policyVersionId: string | null = null;
  try {
    const { data: pv } = await admin.rpc("get_active_policy_version", { _user_id: userId });
    const row = (Array.isArray(pv) ? pv[0] : pv) as { id?: string; version?: number } | null;
    policyVersion = typeof row?.version === "number" ? row.version : null;
    policyVersionId = row?.id ?? null;
  } catch { /* not fatal — the run itself still gets recorded */ }

  await admin.from("control_test_runs").insert({
    user_id: userId,
    policy_version: policyVersion,
    policy_version_id: policyVersionId,
    triggered_by: triggeredBy,
    pass_rate_pct: report.pass_rate_pct,
    summary: report.summary,
    scenario_status: scenarioStatus,
    regressions,
  });

  const hasRegression = regressions.length > 0;
  const belowFull = report.pass_rate_pct < 100;
  if (hasRegression || belowFull) {
    const parts = [
      `Weekly control-system self-audit: ${report.pass_rate_pct}% pass rate ` +
        `(${report.summary.pass} pass, ${report.summary.soft_pass} soft-pass, ${report.summary.fail} fail, ${report.summary.error} error).`,
    ];
    if (hasRegression) {
      parts.push(`${regressions.length} scenario(s) regressed since the last run: ${regressions.join(", ")}.`);
    }
    await sendCriticalAlert(admin, userId, {
      event: "self_audit_regression",
      summary: parts.join(" "),
    });
  }

  return { userId, ok: report.ok, pass_rate_pct: report.pass_rate_pct, regressions, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);

  const isServiceRole = authHeader === `Bearer ${serviceKey}`;
  if (isServiceRole) {
    // Scheduled entry point: audit every org with an active policy version.
    const { data: rows, error } = await admin
      .from("policy_versions")
      .select("user_id")
      .eq("status", "active");
    if (error) return json({ error: error.message }, 500);
    const userIds = [...new Set(((rows ?? []) as { user_id: string }[]).map((r) => r.user_id))];

    const outcomes = [];
    for (const userId of userIds) {
      outcomes.push(await auditOrg(admin, supabaseUrl, serviceKey, userId, "scheduled"));
    }
    return json({
      ok: outcomes.every((o) => o.ok && !o.error),
      audited: outcomes.length,
      outcomes,
    });
  }

  // Real user JWT: run the self-audit for just that caller ("run now" button).
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const outcome = await auditOrg(admin, supabaseUrl, serviceKey, userData.user.id, "manual");
  return json(outcome, outcome.error ? 502 : 200);
});
