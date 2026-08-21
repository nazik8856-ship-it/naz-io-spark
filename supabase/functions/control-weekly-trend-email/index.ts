// Scheduled weekly trend email (pg_cron, Mondays): decision volume,
// escalation rate, and AI spend this week vs last week, for every org
// with an active policy version. Distinct from the daily digest (which
// answers "what needs you right now") — this is the longer-horizon "is
// this getting better or worse" view. Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeTrend } from "../_shared/trend.ts";
import { resolveNotificationRecipients, type MemberRow, type PreferenceRow } from "../_shared/notification-preferences.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DAY_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: activeOrgs, error: orgsErr } = await admin
    .from("policy_versions")
    .select("user_id")
    .eq("status", "active");
  if (orgsErr) return json({ error: orgsErr.message }, 500);
  const userIds = [...new Set(((activeOrgs ?? []) as { user_id: string }[]).map((r) => r.user_id))];

  const now = Date.now();
  const thisWeekStart = new Date(now - 7 * DAY_MS).toISOString();
  const lastWeekStart = new Date(now - 14 * DAY_MS).toISOString();

  const outcomes: { userId: string; sent: boolean; reason: string }[] = [];

  for (const userId of userIds) {
    try {
      const [{ data: thisWeekDecisions }, { data: lastWeekDecisions }, { data: thisWeekSpend }, { data: lastWeekSpend }] = await Promise.all([
        admin.from("agent_decisions").select("escalated").eq("user_id", userId).gte("created_at", thisWeekStart),
        admin.from("agent_decisions").select("escalated").eq("user_id", userId).gte("created_at", lastWeekStart).lt("created_at", thisWeekStart),
        admin.from("ai_spend_daily").select("cost_usd").eq("user_id", userId).gte("day", thisWeekStart.slice(0, 10)),
        admin.from("ai_spend_daily").select("cost_usd").eq("user_id", userId).gte("day", lastWeekStart.slice(0, 10)).lt("day", thisWeekStart.slice(0, 10)),
      ]);

      const thisRows = (thisWeekDecisions ?? []) as { escalated: boolean }[];
      const lastRows = (lastWeekDecisions ?? []) as { escalated: boolean }[];
      const thisEscalationPct = thisRows.length ? Math.round((thisRows.filter((r) => r.escalated).length / thisRows.length) * 1000) / 10 : 0;
      const lastEscalationPct = lastRows.length ? Math.round((lastRows.filter((r) => r.escalated).length / lastRows.length) * 1000) / 10 : 0;
      const thisSpend = ((thisWeekSpend ?? []) as { cost_usd: number }[]).reduce((n, r) => n + Number(r.cost_usd || 0), 0);
      const lastSpend = ((lastWeekSpend ?? []) as { cost_usd: number }[]).reduce((n, r) => n + Number(r.cost_usd || 0), 0);

      // Nothing happened either week — skip, same "no empty digest" principle as the daily one.
      if (thisRows.length === 0 && lastRows.length === 0 && thisSpend === 0 && lastSpend === 0) {
        outcomes.push({ userId, sent: false, reason: "no activity either week" });
        continue;
      }

      const [{ data: authUser, error: authErr }, { data: members }, { data: prefs }] = await Promise.all([
        admin.auth.admin.getUserById(userId),
        admin.from("account_members").select("member_id, email, status").eq("account_owner_id", userId),
        admin.from("notification_preferences").select("recipient_id, digest_enabled, weekly_trend_enabled").eq("account_owner_id", userId),
      ]);
      const ownerEmail = authErr ? null : authUser?.user?.email ?? null;
      const recipients = resolveNotificationRecipients(
        userId, ownerEmail, (members ?? []) as MemberRow[], (prefs ?? []) as PreferenceRow[], "weekly_trend_enabled",
      );
      if (!recipients.length) {
        outcomes.push({ userId, sent: false, reason: "nobody wants this notification" });
        continue;
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      const sends = await Promise.all(recipients.map((r) =>
        fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            templateName: "control-weekly-trend",
            recipientEmail: r.email,
            idempotencyKey: `control-weekly-trend-${userId}-${r.recipientId}-${dateStamp}`,
            templateData: {
              decisions: computeTrend(thisRows.length, lastRows.length),
              escalationRatePct: computeTrend(thisEscalationPct, lastEscalationPct),
              spendUsd: computeTrend(Math.round(thisSpend * 100) / 100, Math.round(lastSpend * 100) / 100),
            },
          }),
        }),
      ));
      const allOk = sends.every((resp) => resp.ok);
      outcomes.push({ userId, sent: allOk, reason: allOk ? `sent to ${recipients.length} recipient(s)` : "one or more recipients failed" });
    } catch (e) {
      outcomes.push({ userId, sent: false, reason: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return json({ ok: true, checked: userIds.length, sent: outcomes.filter((o) => o.sent).length, outcomes });
});
