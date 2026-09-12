// Pure helpers for resolving a raw auth uid (from pending_approvals.approvals[].by
// or incidents.resolved_by) to something readable: "You", an invited
// teammate's email (from account_members), or a short id fallback for
// anyone else not in the team list (e.g. a global admin/owner acting via
// the platform-staff role).

export type MemberRow = { member_id: string | null; email: string };

/**
 * `owner` resolves the account owner's own real name/email -- without it,
 * a team member viewing another account's incidents/approvals always sees
 * the owner's own actions attributed to a shortened uuid, since
 * account_members never contains a row for the owner themselves. Fetch it
 * via the get_account_owner_contact RPC (SECURITY DEFINER, checks the
 * caller is an active member of that account) and pass it through here.
 */
export function buildActorNameMap(
  currentUserId: string,
  members: MemberRow[],
  owner?: { id: string; label: string } | null,
): Record<string, string> {
  const map: Record<string, string> = { [currentUserId]: "You" };
  for (const m of members) {
    if (m.member_id) map[m.member_id] = m.email;
  }
  if (owner && owner.id !== currentUserId) map[owner.id] = owner.label;
  return map;
}

export function actorName(names: Record<string, string>, uid: string): string {
  return names[uid] ?? `${uid.slice(0, 8)}…`;
}
