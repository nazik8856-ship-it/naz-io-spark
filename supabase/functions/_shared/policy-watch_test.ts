// Real tests for continuous whole-policy-version shadow watching.
//
// Run with: deno test --allow-none supabase/functions/_shared/policy-watch_test.ts
import { recordPolicyWatchObservations, summarizePolicyWatch } from "./policy-watch.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  insert(_rows?: unknown) { return this; }
  // deno-lint-ignore no-explicit-any
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function fakeClient(watchers: { id: string; snapshot: unknown }[] | null, inserted: Record<string, unknown>[][]) {
  return {
    from(table: string) {
      if (table === "policy_versions") {
        return new FakeQuery(() => ({ data: watchers, error: null }));
      }
      if (table === "policy_watch_observations") {
        return { insert(rows: Record<string, unknown>[]) { inserted.push(rows); return new FakeQuery(() => ({ data: null, error: null })); } };
      }
      throw new Error(`unexpected table ${table}`);
      // deno-lint-ignore no-explicit-any
    },
  } as any;
}

const ACTION = { action_type: "send_email", provider: "Gmail", description: "Reply to a customer.", params: {} };

Deno.test("recordPolicyWatchObservations: no watching drafts -> no insert at all", async () => {
  const inserted: Record<string, unknown>[][] = [];
  const client = fakeClient([], inserted);
  await recordPolicyWatchObservations(client, "user-1", ACTION, "pass_through", "decision-1");
  assertEquals(inserted.length, 0);
});

Deno.test("recordPolicyWatchObservations: null watchers result (e.g. query error) -> no insert, never throws", async () => {
  const inserted: Record<string, unknown>[][] = [];
  const client = fakeClient(null, inserted);
  await recordPolicyWatchObservations(client, "user-1", ACTION, "pass_through", "decision-1");
  assertEquals(inserted.length, 0);
});

Deno.test("recordPolicyWatchObservations: a watching draft with no matching hard rule records an unchanged pass_through observation", async () => {
  const inserted: Record<string, unknown>[][] = [];
  const client = fakeClient([{ id: "draft-1", snapshot: { hard_rules: [], safety_rules: [] } }], inserted);
  await recordPolicyWatchObservations(client, "user-1", ACTION, "pass_through", "decision-1");
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0], [{
    user_id: "user-1",
    policy_version_id: "draft-1",
    decision_id: "decision-1",
    action_type: "send_email",
    provider: "Gmail",
    active_outcome: "pass_through",
    draft_outcome: "pass_through",
    changed: false,
  }]);
});

Deno.test("recordPolicyWatchObservations: a draft with a NEW blocking hard rule the active gate didn't have records changed=true", async () => {
  const inserted: Record<string, unknown>[][] = [];
  const draftSnapshot = {
    hard_rules: [{ id: "r1", rule_text: "no emails", action_type_pattern: "send_email", effect: "always_block", provider: null, enabled: true }],
  };
  const client = fakeClient([{ id: "draft-1", snapshot: draftSnapshot }], inserted);
  await recordPolicyWatchObservations(client, "user-1", ACTION, "pass_through", "decision-1");
  assertEquals(inserted[0][0].draft_outcome, "block");
  assertEquals(inserted[0][0].changed, true);
});

Deno.test("recordPolicyWatchObservations: one row per watching draft when multiple drafts are watching", async () => {
  const inserted: Record<string, unknown>[][] = [];
  const client = fakeClient([
    { id: "draft-1", snapshot: {} },
    { id: "draft-2", snapshot: {} },
  ], inserted);
  await recordPolicyWatchObservations(client, "user-1", ACTION, "pass_through", null);
  assertEquals(inserted[0].length, 2);
  assertEquals(inserted[0].map((r) => r.policy_version_id), ["draft-1", "draft-2"]);
  assertEquals(inserted[0][0].decision_id, null);
});

Deno.test("summarizePolicyWatch: aggregates same/regression/improvement and caps changed_samples", () => {
  const rows = [
    { action_type: "a", provider: "Gmail", active_outcome: "pass_through" as const, draft_outcome: "pass_through" as const, created_at: "t1" },
    { action_type: "b", provider: "Slack", active_outcome: "pass_through" as const, draft_outcome: "block" as const, created_at: "t2" },
    { action_type: "c", provider: "Notion", active_outcome: "block" as const, draft_outcome: "pass_through" as const, created_at: "t3" },
  ];
  const summary = summarizePolicyWatch("draft-1", "2026-08-27T00:00:00Z", rows);
  assertEquals(summary.total, 3);
  assertEquals(summary.same, 1);
  assertEquals(summary.regressions, 1);
  assertEquals(summary.improvements, 1);
  assertEquals(summary.policy_version_id, "draft-1");
  assertEquals(summary.watching_since, "2026-08-27T00:00:00Z");
  assertEquals(summary.changed_samples.length, 2);
});

Deno.test("summarizePolicyWatch: caps changed_samples at 25 even with more changed rows", () => {
  // active=pass_through, draft=block for all 40 -- the draft is STRICTER
  // than active here (catches something active let through), which
  // diffRealAction classifies as "improvement", not "regression".
  const rows = Array.from({ length: 40 }, (_, i) => ({
    action_type: `a${i}`, provider: "Gmail",
    active_outcome: "pass_through" as const, draft_outcome: "block" as const,
    created_at: `t${i}`,
  }));
  const summary = summarizePolicyWatch("draft-1", null, rows);
  assertEquals(summary.total, 40);
  assertEquals(summary.improvements, 40);
  assertEquals(summary.changed_samples.length, 25);
});

Deno.test("summarizePolicyWatch: no observations yet -> zeroed summary, not a crash", () => {
  const summary = summarizePolicyWatch("draft-1", null, []);
  assertEquals(summary.total, 0);
  assertEquals(summary.same, 0);
  assertEquals(summary.changed_samples, []);
});
