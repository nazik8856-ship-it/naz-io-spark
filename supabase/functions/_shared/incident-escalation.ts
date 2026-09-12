// "Incident lifecycle" plan, item 3: a pending_approval untouched for too
// long already fires a stronger alert (escalation.ts / approval-escalation-
// sweep) -- nothing equivalent watches an INCIDENT itself sitting
// unacknowledged. A flat threshold, not risk-tier-scaled like
// escalation.ts's own ESCALATION_HOURS -- an incident is already a
// "something went wrong" signal by construction (see incidents.ts's own
// doc comment on what does and doesn't become one), so it earns the
// fastest of those tiers uniformly rather than a second severity axis
// incidents don't otherwise have.
export const INCIDENT_ESCALATION_HOURS = 4;

export type IncidentLike = {
  status: string;
  opened_at: string;
  escalation_alerted_at: string | null;
};

/**
 * Pure -- is this incident overdue for an escalation nudge right now?
 * Only ever true for a still-OPEN incident: "acknowledged" already means a
 * human is actively on it (see the acknowledge endpoint), and a resolved
 * incident needs nothing further. Fires at most once per incident.
 *
 * `escalationHours` defaults to the flat constant above -- pass the
 * account's own incident_thresholds row (see the incident-escalation-sweep
 * caller) once one exists, so an account can tune how much slack it gives
 * itself before this fires.
 */
export function isIncidentOverdueForEscalation(
  row: IncidentLike,
  now: Date = new Date(),
  escalationHours: number = INCIDENT_ESCALATION_HOURS,
): boolean {
  if (row.status !== "open") return false;
  if (row.escalation_alerted_at) return false;
  const hoursOpen = (now.getTime() - new Date(row.opened_at).getTime()) / (1000 * 60 * 60);
  return hoursOpen >= escalationHours;
}
