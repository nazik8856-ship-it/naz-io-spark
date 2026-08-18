// Real tests for the escalation-timer pure logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/escalation_test.ts
import { isOverdueForEscalation, hoursSince, ESCALATION_HOURS } from "./escalation.ts";

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

Deno.test("an already-escalated approval never escalates a second time", () => {
  assertFalse(isOverdueForEscalation({ created_at: hoursAgo(100), risk_tier: "high", status: "pending", escalated_at: hoursAgo(1) }, NOW));
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
