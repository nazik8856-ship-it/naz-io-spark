// Scheduled daily digest (pg_cron): open incidents, pending approvals, and
// spend status for every org with an active policy version. Only actually
// sends when there's real signal (_shared/digest.ts) — an empty digest
// every day trains people to ignore it. Service-role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSpendStatus } from "../_shared/spend-guard.ts";
import { digestHasContent } from "../_shared/digest.ts";
import { resolveNotificationRecipients, type MemberRow, type PreferenceRow } from "../_shared/notification-preferences.ts";

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

  const { data: activeOrgs, error: orgsErr } = await admin
    .from("policy_versions")
    .select("user_id")
    .eq("status", "active");
  if (orgsErr) return json({ error: orgsErr.message }, 500);
  const userIds = [...new Set(((activeOrgs ?? []) as { user_id: string }[]).map((r) => r.user_id))];

  const outcomes: { userId: string; sent: boolean; reason: string }[] = [];

  for (const userId of userIds) {
    try {
      const [{ data: incidents }, { data: approvals }, spend] = await Promise.all([
        admin.from("incidents").select("summary").eq("user_id", userId).eq("status", "open").order("opened_at", { ascending: false }).limit(5),
        admin.from("pending_approvals").select("created_at").eq("user_id", userId).eq("status", "pending"),
        getSpendStatus(admin, userId),
      ]);

      const openIncidents = (incidents ?? []).length;
      const pendingRows = (approvals ?? []) as { created_at: string }[];
      const pendingApprovals = pendingRows.length;
      const oldestPendingHours = pendingRows.length
        ? Math.max(...pendingRows.map((r) => (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60)))
        : 0;

      const signal = { openIncidents, pendingApprovals, spendPct: spend.pct };
      if (!digestHasContent(signal)) {
        outcomes.push({ userId, sent: false, reason: "nothing to report" });
        continue;
      }

      const [{ data: authUser, error: authErr }, { data: members }, { data: prefs }] = await Promise.all([
        admin.auth.admin.getUserById(userId),
        admin.from("account_members").select("member_id, email, status").eq("account_owner_id", userId),
        admin.from("notification_preferences").select("recipient_id, digest_enabled, weekly_trend_enabled").eq("account_owner_id", userId),
      ]);
      const ownerEmail = authErr ? null : authUser?.user?.email ?? null;
      const recipients = resolveNotificationRecipients(
        userId, ownerEmail, (members ?? []) as MemberRow[], (prefs ?? []) as PreferenceRow[], "digest_enabled",
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
            templateName: "control-digest",
            recipientEmail: r.email,
            idempotencyKey: `control-digest-${userId}-${r.recipientId}-${dateStamp}`,
            templateData: {
              openIncidents,
              incidentSummaries: ((incidents ?? []) as { summary: string }[]).map((i) => i.summary),
              pendingApprovals,
              oldestPendingHours,
              spendPct: spend.pct,
              spendUsd: spend.spent_usd,
              capUsd: spend.cap_usd,
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
