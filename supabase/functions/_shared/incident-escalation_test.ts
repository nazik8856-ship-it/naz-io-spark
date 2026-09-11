// Real tests for incident-escalation.ts's pure overdue check.
//
// Run with: deno test --allow-none supabase/functions/_shared/incident-escalation_test.ts
import { isIncidentOverdueForEscalation, INCIDENT_ESCALATION_HOURS } from "./incident-escalation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

const now = new Date("2026-01-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

Deno.test("isIncidentOverdueForEscalation: a fresh open incident is not overdue", () => {
  assertFalse(isIncidentOverdueForEscalation({ status: "open", opened_at: hoursAgo(0), escalation_alerted_at: null }, now));
});

Deno.test("isIncidentOverdueForEscalation: open past the threshold is overdue", () => {
  assert(isIncidentOverdueForEscalation({ status: "open", opened_at: hoursAgo(INCIDENT_ESCALATION_HOURS), escalation_alerted_at: null }, now));
});

Deno.test("isIncidentOverdueForEscalation: an acknowledged incident is never escalated, however long it's been open", () => {
  assertFalse(isIncidentOverdueForEscalation({ status: "acknowledged", opened_at: hoursAgo(100), escalation_alerted_at: null }, now));
});

Deno.test("isIncidentOverdueForEscalation: a resolved incident is never escalated", () => {
  assertFalse(isIncidentOverdueForEscalation({ status: "resolved", opened_at: hoursAgo(100), escalation_alerted_at: null }, now));
});

Deno.test("isIncidentOverdueForEscalation: already escalated once is never escalated again", () => {
  assertFalse(isIncidentOverdueForEscalation({ status: "open", opened_at: hoursAgo(100), escalation_alerted_at: hoursAgo(1) }, now));
});
