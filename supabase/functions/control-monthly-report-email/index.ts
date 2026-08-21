// Scheduled monthly report email (pg_cron, 1st of the month): a concise
// summary of last month's compliance and/or ROI numbers, for accounts
// that have opted in (profiles.compliance_report_monthly_enabled /
// roi_report_monthly_enabled). Distinct from the full click-to-generate
// compliance/ROI reports (Markdown documents) -- this is a short email
// with the headline numbers and a link to the full report, the same
// shape as the existing weekly trend email. Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { summarizeDecisionsForRoi, costPerAutonomousDecision, type DecisionForRoi } from "../_shared/roi-report.ts";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const now = new Date();
  // Last full calendar month, UTC.
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthStartIso = monthStart.toISOString();
  const monthEndIso = monthEnd.toISOString();
  const monthLabel = monthStart.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const { data: subscribers, error: subErr } = await admin
    .from("profiles")
    .select("id")
    .or("compliance_report_monthly_enabled.eq.true,roi_report_monthly_enabled.eq.true");
  if (subErr) return json({ error: subErr.message }, 500);

  const outcomes: { userId: string; sent: boolean; reason: string }[] = [];

  for (const row of (subscribers ?? []) as { id: string }[]) {
    const userId = row.id;
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("compliance_report_monthly_enabled, roi_report_monthly_enabled")
        .eq("id", userId)
        .maybeSingle();
      const wantsCompliance = !!(profile as { compliance_report_monthly_enabled?: boolean } | null)?.compliance_report_monthly_enabled;
      const wantsRoi = !!(profile as { roi_report_monthly_enabled?: boolean } | null)?.roi_report_monthly_enabled;
      if (!wantsCompliance && !wantsRoi) {
        outcomes.push({ userId, sent: false, reason: "neither report enabled" });
        continue;
      }

      let compliance: { passRatePct: number | null; openIncidents: number; resolvedIncidents: number; settingsChanges: number } | null = null;
      if (wantsCompliance) {
        const [runs, opened, resolved, changes] = await Promise.all([
          admin.from("control_test_runs").select("pass_rate_pct").eq("user_id", userId).gte("created_at", monthStartIso).lt("created_at", monthEndIso).order("created_at", { ascending: false }),
          admin.from("incidents").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("opened_at", monthStartIso).lt("opened_at", monthEndIso),
          admin.from("incidents").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("resolved_at", monthStartIso).lt("resolved_at", monthEndIso),
          admin.from("config_changes").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", monthStartIso).lt("created_at", monthEndIso),
        ]);
        const runRows = (runs.data ?? []) as { pass_rate_pct: number }[];
        const avgPassRate = runRows.length ? Math.round((runRows.reduce((n, r) => n + r.pass_rate_pct, 0) / runRows.length) * 10) / 10 : null;
        compliance = {
          passRatePct: avgPassRate,
          openIncidents: opened.count ?? 0,
          resolvedIncidents: resolved.count ?? 0,
          settingsChanges: changes.count ?? 0,
        };
      }

      let roi: { total: number; blocked: number; modified: number; autonomous: number; needsHuman: number; spendUsd: number; costPerDecision: number | null } | null = null;
      if (wantsRoi) {
        const [decisions, spend] = await Promise.all([
          admin.from("agent_decisions").select("decision, escalated").eq("user_id", userId).gte("created_at", monthStartIso).lt("created_at", monthEndIso),
          admin.from("ai_spend_daily").select("cost_usd").eq("user_id", userId).is("agent_id", null).gte("day", monthStartIso.slice(0, 10)).lt("day", monthEndIso.slice(0, 10)),
        ]);
        const counts = summarizeDecisionsForRoi((decisions.data ?? []) as DecisionForRoi[]);
        const spendUsd = ((spend.data ?? []) as { cost_usd: number }[]).reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
        roi = {
          total: counts.total, blocked: counts.blocked, modified: counts.modified,
          autonomous: counts.autonomous, needsHuman: counts.needsHuman,
          spendUsd: Math.round(spendUsd * 100) / 100,
          costPerDecision: costPerAutonomousDecision(spendUsd, counts.autonomous),
        };
      }

      // Nothing to report in ANY enabled section -- skip, same "no empty
      // email" principle as the daily digest. A section that's disabled
      // never blocks sending on its own (it's simply absent, not "empty").
      const complianceEmpty = !wantsCompliance ||
        (compliance?.openIncidents === 0 && compliance?.resolvedIncidents === 0 && compliance?.settingsChanges === 0 && compliance?.passRatePct === null);
      const roiEmpty = !wantsRoi || roi?.total === 0;
      if (complianceEmpty && roiEmpty) {
        outcomes.push({ userId, sent: false, reason: "no activity this month" });
        continue;
      }

      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
      const recipientEmail = authUser?.user?.email;
      if (authErr || !recipientEmail) {
        outcomes.push({ userId, sent: false, reason: "no email on file" });
        continue;
      }

      const resp = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          templateName: "control-monthly-report",
          recipientEmail,
          idempotencyKey: `control-monthly-report-${userId}-${now.toISOString().slice(0, 7)}`,
          templateData: { monthLabel, compliance, roi },
        }),
      });
      outcomes.push({ userId, sent: resp.ok, reason: resp.ok ? "sent" : `send-transactional-email ${resp.status}` });
    } catch (e) {
      outcomes.push({ userId, sent: false, reason: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return json({ ok: true, checked: (subscribers ?? []).length, sent: outcomes.filter((o) => o.sent).length, outcomes });
});
