// Pure helpers for resolving a raw auth uid (from pending_approvals.approvals[].by
// or incidents.resolved_by) to something readable: "You", an invited
// teammate's email (from account_members), or a short id fallback for
// anyone else not in the team list (e.g. a global admin/owner acting via
// the platform-staff role).

export type MemberRow = { member_id: string | null; email: string };

export function buildActorNameMap(currentUserId: string, members: MemberRow[]): Record<string, string> {
  const map: Record<string, string> = { [currentUserId]: "You" };
  for (const m of members) {
    if (m.member_id) map[m.member_id] = m.email;
  }
  return map;
}

export function actorName(names: Record<string, string>, uid: string): string {
  return names[uid] ?? `${uid.slice(0, 8)}…`;
}
