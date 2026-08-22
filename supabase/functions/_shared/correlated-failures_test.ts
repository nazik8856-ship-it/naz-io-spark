// Real tests for cron-correlated-failures' pure classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/correlated-failures_test.ts
import {
  findCorrelatedFailures,
  groupsNeedingNewAlert,
  summarizeCorrelatedFailure,
  type BreakerTripRow,
} from "./correlated-failures.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const trip = (over: Partial<BreakerTripRow>): BreakerTripRow => ({
  userId: "user-1",
  actionType: "send_email",
  provider: "Gmail",
  agentId: "agent-1",
  decisionId: "decision-1",
  openedAt: "2026-08-23T10:00:00Z",
  ...over,
});

Deno.test("findCorrelatedFailures: two different agents tripping the same action/provider IS correlated", () => {
  const rows = [trip({ agentId: "agent-1" }), trip({ agentId: "agent-2", decisionId: "decision-2" })];
  const groups = findCorrelatedFailures(rows);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].distinctAgentIds.length, 2);
  assertEquals(groups[0].tripCount, 2);
});

Deno.test("findCorrelatedFailures: the SAME agent tripping twice is NOT correlated -- that's the per-agent breaker's own signal", () => {
  const rows = [trip({ agentId: "agent-1" }), trip({ agentId: "agent-1", decisionId: "decision-2" })];
  assertEquals(findCorrelatedFailures(rows), []);
});

Deno.test("findCorrelatedFailures: a single agent-less (account-wide) trip plus one real agent is NOT correlated -- null never counts toward distinct agents", () => {
  const rows = [trip({ agentId: null }), trip({ agentId: "agent-1" })];
  assertEquals(findCorrelatedFailures(rows), []);
});

Deno.test("findCorrelatedFailures: different action_type or provider never merges into the same group", () => {
  const rows = [
    trip({ agentId: "agent-1", actionType: "send_email", provider: "Gmail" }),
    trip({ agentId: "agent-2", actionType: "send_email", provider: "Outlook" }),
  ];
  assertEquals(findCorrelatedFailures(rows), []);
});

Deno.test("findCorrelatedFailures: different accounts never merge into the same group", () => {
  const rows = [
    trip({ userId: "user-1", agentId: "agent-1" }),
    trip({ userId: "user-2", agentId: "agent-2" }),
  ];
  assertEquals(findCorrelatedFailures(rows), []);
});

Deno.test("findCorrelatedFailures: minDistinctAgents is configurable", () => {
  const rows = [
    trip({ agentId: "agent-1" }),
    trip({ agentId: "agent-2", decisionId: "decision-2" }),
    trip({ agentId: "agent-3", decisionId: "decision-3" }),
  ];
  assertEquals(findCorrelatedFailures(rows, 3).length, 1);
  assertEquals(findCorrelatedFailures(rows, 4).length, 0);
});

Deno.test("findCorrelatedFailures: the group reports the MOST RECENT trip's decision id and timestamp", () => {
  const rows = [
    trip({ agentId: "agent-1", decisionId: "decision-old", openedAt: "2026-08-23T09:00:00Z" }),
    trip({ agentId: "agent-2", decisionId: "decision-new", openedAt: "2026-08-23T11:00:00Z" }),
  ];
  const [group] = findCorrelatedFailures(rows);
  assertEquals(group.latestDecisionId, "decision-new");
  assertEquals(group.latestOpenedAt, "2026-08-23T11:00:00Z");
});

Deno.test("groupsNeedingNewAlert: a group with no matching open incident needs a new alert", () => {
  const groups = findCorrelatedFailures([trip({ agentId: "agent-1" }), trip({ agentId: "agent-2", decisionId: "decision-2" })]);
  assertEquals(groupsNeedingNewAlert(groups, []), groups);
});

Deno.test("groupsNeedingNewAlert: a group already alerted on (same user/action_type/provider) is skipped", () => {
  const groups = findCorrelatedFailures([trip({ agentId: "agent-1" }), trip({ agentId: "agent-2", decisionId: "decision-2" })]);
  const already = [{ userId: "user-1", actionType: "send_email", provider: "Gmail" }];
  assertEquals(groupsNeedingNewAlert(groups, already), []);
});

Deno.test("groupsNeedingNewAlert: an open incident for a DIFFERENT provider does not suppress this group", () => {
  const groups = findCorrelatedFailures([trip({ agentId: "agent-1" }), trip({ agentId: "agent-2", decisionId: "decision-2" })]);
  const already = [{ userId: "user-1", actionType: "send_email", provider: "Outlook" }];
  assertEquals(groupsNeedingNewAlert(groups, already), groups);
});

Deno.test("summarizeCorrelatedFailure: mentions the agent count, action type, provider, and trip count", () => {
  const [group] = findCorrelatedFailures([trip({ agentId: "agent-1" }), trip({ agentId: "agent-2", decisionId: "decision-2" })]);
  const summary = summarizeCorrelatedFailure(group);
  assert(summary.includes("2 different agents"));
  assert(summary.includes("send_email"));
  assert(summary.includes("Gmail"));
  assert(summary.includes("2 trip"));
});
