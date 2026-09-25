// Per-user notification preferences: every scheduled email has only ever
// gone to the account owner's own auth email -- no opt-out, and no way
// for a team member to receive anything at all. Pure recipient-resolution
// logic, shared by every scheduled notification function (digest, weekly
// trend, monthly report).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type NotificationChannel = "digest_enabled" | "weekly_trend_enabled" | "critical_alert_email_enabled";

export type PreferenceRow = {
  recipient_id: string;
  digest_enabled: boolean;
  weekly_trend_enabled: boolean;
  critical_alert_email_enabled?: boolean;
};
export type MemberRow = { member_id: string | null; email: string; status: string };
export type Recipient = { recipientId: string; email: string };

/**
 * Pure — who should receive this notification channel right now. The
 * account owner defaults to enabled (no preference row = today's exact
 * behavior, unchanged for every account that's never touched this
 * setting) unless they've explicitly opted out. A team member defaults to
 * NOT receiving anything (today they get nothing at all) -- opt-in only,
 * so adding a team member never silently expands who gets emailed.
 */
export function resolveNotificationRecipients(
  ownerId: string,
  ownerEmail: string | null,
  members: MemberRow[],
  preferences: PreferenceRow[],
  channel: NotificationChannel,
): Recipient[] {
  const prefByRecipient: Record<string, PreferenceRow> = {};
  for (const p of preferences) prefByRecipient[p.recipient_id] = p;

  const recipients: Recipient[] = [];

  const ownerPref = prefByRecipient[ownerId];
  const ownerWants = ownerPref ? ownerPref[channel] : true;
  if (ownerWants && ownerEmail) recipients.push({ recipientId: ownerId, email: ownerEmail });

  for (const m of members) {
    if (m.status !== "active" || !m.member_id) continue;
    const pref = prefByRecipient[m.member_id];
    if (pref?.[channel]) recipients.push({ recipientId: m.member_id, email: m.email });
  }

  return recipients;
}

/**
 * Pillar 4: an approval's `assigned_to` is a real, human-set delegation
 * (reassign_pending_approval), but nothing that actually SENDS a
 * notification ever looked at it -- resolveNotificationRecipients above
 * only ever considers the general critical-alert subscriber list, so the
 * one person actually on the hook for a specific approval could easily not
 * be in it, and their OOO fallback (also real, also stored) was never
 * consulted at notification time either -- only at the moment of manual
 * (re)assignment, which can be long before an escalation fires.
 *
 * Redirects to the fallback using the SAME rule reassign_pending_approval's
 * own SQL already applies (ooo_until in the future, a real active fallback
 * member, falling back to the original assignee if the fallback itself
 * isn't a valid assignee) -- re-checked here rather than trusted from
 * assignment time, since OOO status can change after assignment and before
 * an escalation ever fires.
 */
export async function resolveAssignedRecipient(
  admin: SupabaseClient,
  accountOwnerId: string,
  assignedTo: string | null | undefined,
): Promise<Recipient | null> {
  if (!assignedTo) return null;
  try {
    if (assignedTo === accountOwnerId) {
      const { data } = await admin.auth.admin.getUserById(accountOwnerId);
      const email = data?.user?.email ?? null;
      return email ? { recipientId: accountOwnerId, email } : null;
    }

    const { data: memberRow } = await admin
      .from("account_members")
      .select("member_id, email, status, ooo_until, ooo_fallback_member_id")
      .eq("account_owner_id", accountOwnerId)
      .eq("member_id", assignedTo)
      .eq("status", "active")
      .maybeSingle();
    const member = memberRow as
      | { member_id: string; email: string; status: string; ooo_until: string | null; ooo_fallback_member_id: string | null }
      | null;
    if (!member) return null;

    const isOoo = !!member.ooo_until && new Date(member.ooo_until) > new Date();
    if (!isOoo || !member.ooo_fallback_member_id) {
      return { recipientId: member.member_id, email: member.email };
    }

    // Redirect to the fallback -- unless the fallback is itself no longer a
    // valid assignee, in which case fall back to the original (same posture
    // as reassign_pending_approval: never silently route to nobody).
    if (member.ooo_fallback_member_id === accountOwnerId) {
      const { data } = await admin.auth.admin.getUserById(accountOwnerId);
      const email = data?.user?.email ?? null;
      return email ? { recipientId: accountOwnerId, email } : { recipientId: member.member_id, email: member.email };
    }
    const { data: fallbackRow } = await admin
      .from("account_members")
      .select("member_id, email, status")
      .eq("account_owner_id", accountOwnerId)
      .eq("member_id", member.ooo_fallback_member_id)
      .eq("status", "active")
      .maybeSingle();
    const fallback = fallbackRow as { member_id: string; email: string; status: string } | null;
    if (!fallback) return { recipientId: member.member_id, email: member.email };
    return { recipientId: fallback.member_id, email: fallback.email };
  } catch {
    return null;
  }
}
