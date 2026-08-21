// Per-user notification preferences: every scheduled email has only ever
// gone to the account owner's own auth email -- no opt-out, and no way
// for a team member to receive anything at all. Pure recipient-resolution
// logic, shared by every scheduled notification function (digest, weekly
// trend, monthly report).

export type NotificationChannel = "digest_enabled" | "weekly_trend_enabled";

export type PreferenceRow = { recipient_id: string; digest_enabled: boolean; weekly_trend_enabled: boolean };
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
