// Real tests for the escalation-timer pure logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/escalation_test.ts
import { isOverdueForEscalation, hoursSince, ESCALATION_HOURS, isOverdueForExecution, EXECUTION_REMINDER_HOURS } from "./escalation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

const NOW = new Date("2026-08-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

Deno.test("hoursSince computes the elapsed hours correctly", () => {
  const diff = hoursSince(hoursAgo(5), NOW);
  assert(Math.abs(diff - 5) < 0.001, `expected ~5, got ${diff}`);
});

Deno.test("a high-risk approval escalates after 4 hours, not before", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(3.9), risk_tier: "high", status: "pending", escalated_at: null }, NOW));
  assert(isOverdueForEscalation({ created_at: hoursAgo(4), risk_tier: "high", status: "pending", escalated_at: null }, NOW));
});

Deno.test("a medium-risk approval escalates after 12 hours", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(11.9), risk_tier: "medium", status: "pending", escalated_at: null }, NOW));
  assert(isOverdueForEscalation({ created_at: hoursAgo(12), risk_tier: "medium", status: "pending", escalated_at: null }, NOW));
});

Deno.test("a low-risk approval escalates after 24 hours", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(23.9), risk_tier: "low", status: "pending", escalated_at: null }, NOW));
  assert(isOverdueForEscalation({ created_at: hoursAgo(24), risk_tier: "low", status: "pending", escalated_at: null }, NOW));
});

Deno.test("an unrecognized risk_tier value falls back to the medium threshold", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(11), risk_tier: "weird", status: "pending", escalated_at: null }, NOW));
  assert(isOverdueForEscalation({ created_at: hoursAgo(13), risk_tier: "weird", status: "pending", escalated_at: null }, NOW));
});

// Regression for Pillar 3 top-10 item 3: escalation alerts used to fire
// exactly once, ever, then go silent no matter how much longer the approval
// sat afterward. escalated_at now means "when was the last nudge," so the
// same risk-scaled threshold re-applies from that timestamp instead of from
// created_at, giving a genuine repeat cadence.
Deno.test("a recently re-escalated approval doesn't escalate again before its threshold elapses since the LAST nudge", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(100), risk_tier: "high", status: "pending", escalated_at: hoursAgo(1) }, NOW));
});

Deno.test("an approval escalates AGAIN once the threshold has elapsed since its last nudge, no matter how old the original escalation is", () => {
  assert(isOverdueForEscalation({ created_at: hoursAgo(1000), risk_tier: "high", status: "pending", escalated_at: hoursAgo(4) }, NOW));
  assert(isOverdueForEscalation({ created_at: hoursAgo(1000), risk_tier: "high", status: "pending", escalated_at: hoursAgo(100) }, NOW));
});

Deno.test("repeat escalation still scales by risk tier, measured from the last nudge", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(1000), risk_tier: "low", status: "pending", escalated_at: hoursAgo(23.9) }, NOW));
  assert(isOverdueForEscalation({ created_at: hoursAgo(1000), risk_tier: "low", status: "pending", escalated_at: hoursAgo(24) }, NOW));
});

Deno.test("a resolved (not pending) approval never escalates, no matter how old", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(1000), risk_tier: "high", status: "approved", escalated_at: null }, NOW));
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(1000), risk_tier: "high", status: "rejected", escalated_at: null }, NOW));
});

Deno.test("ESCALATION_HOURS has exactly the three documented tiers", () => {
  assert(ESCALATION_HOURS.high === 4);
  assert(ESCALATION_HOURS.medium === 12);
  assert(ESCALATION_HOURS.low === 24);
});

// ---- GAP 5 (Action Execution Feedback Loop, 2026-10-10): isOverdueForExecution
// -- a separate, shorter clock for an APPROVED row still sitting un-executed.
// ---------------------------------------------------------------------------

Deno.test("isOverdueForExecution: a high-risk approved action is overdue after 1h since resolution, not before", () => {
  assertFalse(isOverdueForExecution({ status: "approved", risk_tier: "high", resolved_at: hoursAgo(0.9), executed_at: null, escalated_at: null }, NOW));
  assert(isOverdueForExecution({ status: "approved", risk_tier: "high", resolved_at: hoursAgo(1), executed_at: null, escalated_at: null }, NOW));
});

Deno.test("isOverdueForExecution: a low-risk approved action uses the longer 4h threshold, not the high-risk 1h one", () => {
  assertFalse(isOverdueForExecution({ status: "approved", risk_tier: "low", resolved_at: hoursAgo(2), executed_at: null, escalated_at: null }, NOW));
  assert(isOverdueForExecution({ status: "approved", risk_tier: "low", resolved_at: hoursAgo(5), executed_at: null, escalated_at: null }, NOW));
});

Deno.test("isOverdueForExecution: a row that was already executed is never overdue, regardless of timing", () => {
  assertFalse(isOverdueForExecution({ status: "approved", risk_tier: "high", resolved_at: hoursAgo(100), executed_at: hoursAgo(1), escalated_at: null }, NOW));
});

Deno.test("isOverdueForExecution: a row still 'pending' is never covered here -- that's isOverdueForEscalation's job", () => {
  assertFalse(isOverdueForExecution({ status: "pending", risk_tier: "high", resolved_at: null, executed_at: null, escalated_at: null }, NOW));
});

Deno.test("isOverdueForExecution: repeat nudges measure from escalated_at (last nudge), not resolved_at, once one has fired", () => {
  assertFalse(isOverdueForExecution({ status: "approved", risk_tier: "high", resolved_at: hoursAgo(10), executed_at: null, escalated_at: hoursAgo(0.5) }, NOW));
  assert(isOverdueForExecution({ status: "approved", risk_tier: "high", resolved_at: hoursAgo(10), executed_at: null, escalated_at: hoursAgo(1.5) }, NOW));
});

Deno.test("isOverdueForExecution: a row with no resolved_at is never overdue (defensive -- shouldn't happen for a real 'approved' row)", () => {
  assertFalse(isOverdueForExecution({ status: "approved", risk_tier: "high", resolved_at: null, executed_at: null, escalated_at: null }, NOW));
});

Deno.test("EXECUTION_REMINDER_HOURS is strictly faster than ESCALATION_HOURS at every tier -- an already-approved action deserves a faster nudge, never a slower one", () => {
  for (const tier of ["low", "medium", "high"] as const) {
    assert(EXECUTION_REMINDER_HOURS[tier] < ESCALATION_HOURS[tier], `${tier}: ${EXECUTION_REMINDER_HOURS[tier]} must be < ${ESCALATION_HOURS[tier]}`);
  }
});
