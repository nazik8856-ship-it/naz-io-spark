// Approver workload balancing (Wave 5, session 3) — when a pending
// approval needs a human, suggest the least-loaded eligible approver
// instead of defaulting to "whoever happens to notice". This only ever
// PRE-FILLS a suggestion in the reassignment UI — the actual out-of-office
// redirect guarantee lives server-side in reassign_pending_approval (SQL),
// not here, so a stale or wrong suggestion here can never misroute an
// approval the way a missed server-side check could.

export type AssigneeCandidate = {
  memberId: string;
  openCount: number;
  oooUntil?: string | null;
};

/**
 * Pure — the least-loaded candidate not currently out of office, ties
 * broken by memberId so the result is deterministic. Null if every
 * candidate is OOO (nobody is currently a safe default to suggest).
 */
export function suggestAssignee(candidates: AssigneeCandidate[], now: Date = new Date()): string | null {
  const available = candidates.filter((c) => !isOutOfOffice(c.oooUntil, now));
  if (!available.length) return null;
  return available
    .slice()
    .sort((a, b) => a.openCount - b.openCount || a.memberId.localeCompare(b.memberId))[0].memberId;
}

/** Pure — is this OOO date still in effect right now? */
export function isOutOfOffice(oooUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!oooUntil) return false;
  return new Date(oooUntil).getTime() > now.getTime();
}
