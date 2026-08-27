// Real tests for evaluateAction -- the deterministic-evaluation core
// extracted out of evaluateScenario (2026-08-23) so real-traffic-replay.ts
// can reuse it without evaluateScenario's expected/status grading, which
// only makes sense for a fixed test scenario, not a real historical
// action with no "correct answer" to grade against.
//
// Run with: deno test --allow-none supabase/functions/_shared/policy-replay_test.ts
import { evaluateAction, previewProposedHardRules, type PolicySnapshot } from "./policy-replay.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const action = (over: Partial<{ action_type: string; provider: string; description: string; params: unknown }>) => ({
  action_type: "send_email",
  provider: "Gmail",
  description: "Reply to a customer.",
  params: {},
  ...over,
});

Deno.test("evaluateAction: a matching hard rule wins over the safety scanner", () => {
  const snapshot: PolicySnapshot = {
    hard_rules: [{ id: "r1", rule_text: "blocks email", action_type_pattern: "send_email", effect: "always_block", provider: null }],
  };
  const result = evaluateAction(action({}), snapshot);
  assertEquals(result.gate_outcome, "block");
  assertEquals(result.gate_source, "hard_rule");
});

Deno.test("evaluateAction: an always_require_approval hard rule maps to require_approval", () => {
  const snapshot: PolicySnapshot = {
    hard_rules: [{ id: "r1", rule_text: "needs approval", action_type_pattern: "*", effect: "always_require_approval", provider: null }],
  };
  const result = evaluateAction(action({}), snapshot);
  assertEquals(result.gate_outcome, "require_approval");
  assertEquals(result.gate_source, "hard_rule");
});

Deno.test("evaluateAction: no matching hard rule falls through to the safety scanner", () => {
  const result = evaluateAction(action({ description: "delete all customer records" }), {});
  assertEquals(result.gate_outcome, "block");
  assertEquals(result.gate_source, "safety_scanner");
});

Deno.test("evaluateAction: nothing matches at all is a clean pass_through", () => {
  const result = evaluateAction(action({}), {});
  assertEquals(result.gate_outcome, "pass_through");
  assertEquals(result.gate_source, null);
  assertEquals(result.gate_detail, null);
});

Deno.test("evaluateAction: a hard rule scoped to a different provider does not match", () => {
  const snapshot: PolicySnapshot = {
    hard_rules: [{ id: "r1", rule_text: "blocks slack", action_type_pattern: "*", effect: "always_block", provider: "Slack" }],
  };
  const result = evaluateAction(action({ provider: "Gmail" }), snapshot);
  assertEquals(result.gate_outcome, "pass_through");
});

Deno.test("evaluateAction: a shadow-mode hard rule is excluded, matching evaluateScenario's existing asHardRules filter", () => {
  const snapshot: PolicySnapshot = {
    hard_rules: [{ id: "r1", rule_text: "shadow", action_type_pattern: "*", effect: "always_block", provider: null, shadow_mode: true }],
  };
  const result = evaluateAction(action({}), snapshot);
  assertEquals(result.gate_outcome, "pass_through");
});

// ---- "policy autonomy" item 7: previewProposedHardRules ----

type RpcResult = { data?: unknown; error?: unknown };

function fakeAdmin(opts: { activePolicy?: RpcResult; activeThrows?: boolean; replayableRows?: RpcResult }) {
  const calledRpcNames: string[] = [];
  const client = {
    rpc(name: string, _args: Record<string, unknown>) {
      calledRpcNames.push(name);
      if (name === "get_active_policy_version") {
        if (opts.activeThrows) throw new Error("no active policy row");
        return Promise.resolve(opts.activePolicy ?? { data: null, error: null });
      }
      if (name === "get_replayable_real_decisions") {
        return Promise.resolve(opts.replayableRows ?? { data: [], error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, calledRpcNames };
}

const replayableRow = (over: Partial<{ id: string; action_type: string; provider: string; description: string; params: unknown }> = {}) => ({
  id: "row-1",
  action_type: "delete_record",
  provider: "Notion",
  description: "Delete a stale record.",
  params: {},
  created_at: "2026-08-28T00:00:00Z",
  real_source: "approval",
  ...over,
});

Deno.test("previewProposedHardRules: rejects an empty proposal without ever calling the database", async () => {
  const { client, calledRpcNames } = fakeAdmin({});
  const result = await previewProposedHardRules(client, "user-1", []);
  assertEquals(result, { error: "Provide at least one proposed hard rule to preview.", status: 400 });
  assertEquals(calledRpcNames, []);
});

Deno.test("previewProposedHardRules: a proposed rule that would newly block a real past action shows up as an improvement", async () => {
  const { client } = fakeAdmin({
    activePolicy: { data: { id: "pv-1", version: 3, snapshot: {} }, error: null },
    replayableRows: { data: [replayableRow()], error: null },
  });
  const result = await previewProposedHardRules(client, "user-1", [
    { rule_text: "block deletes", action_type_pattern: "delete_record", effect: "always_block" },
  ]);
  if ("error" in result) throw new Error(`expected success, got error: ${result.error}`);
  assertEquals(result.active_version, { id: "pv-1", version: 3 });
  assertEquals(result.summary, { total: 1, same: 0, regressions: 0, improvements: 1 });
  assertEquals(result.changed.length, 1);
  assertEquals(result.changed[0].diff, "improvement");
  assertEquals(result.changed[0].draft.gate_outcome, "block");
  assertEquals(result.changed[0].active.gate_outcome, "pass_through");
});

Deno.test("previewProposedHardRules: a proposed rule that changes nothing reports zero changes", async () => {
  const { client } = fakeAdmin({
    activePolicy: { data: { id: "pv-1", version: 1, snapshot: {} }, error: null },
    replayableRows: { data: [replayableRow({ action_type: "send_email" })], error: null },
  });
  const result = await previewProposedHardRules(client, "user-1", [
    { rule_text: "block deletes", action_type_pattern: "delete_record", effect: "always_block" },
  ]);
  if ("error" in result) throw new Error(`expected success, got error: ${result.error}`);
  assertEquals(result.summary, { total: 1, same: 1, regressions: 0, improvements: 0 });
  assertEquals(result.changed, []);
});

Deno.test("previewProposedHardRules: no active policy version yet still runs the preview against an empty active snapshot", async () => {
  const { client } = fakeAdmin({
    activeThrows: true,
    replayableRows: { data: [replayableRow()], error: null },
  });
  const result = await previewProposedHardRules(client, "user-1", [
    { rule_text: "block deletes", action_type_pattern: "delete_record", effect: "always_block" },
  ]);
  if ("error" in result) throw new Error(`expected success, got error: ${result.error}`);
  assertEquals(result.active_version, { id: null, version: null });
  assertEquals(result.summary.improvements, 1);
});

Deno.test("previewProposedHardRules: a database error fetching real decisions is surfaced, not swallowed", async () => {
  const { client } = fakeAdmin({
    activePolicy: { data: null, error: null },
    replayableRows: { data: null, error: { message: "db timeout" } },
  });
  const result = await previewProposedHardRules(client, "user-1", [
    { rule_text: "block deletes", action_type_pattern: "*", effect: "always_block" },
  ]);
  assertEquals(result, { error: "db timeout", status: 500 });
});

Deno.test("previewProposedHardRules: echoes back exactly the proposed rules it was given", async () => {
  const { client } = fakeAdmin({
    activePolicy: { data: null, error: null },
    replayableRows: { data: [], error: null },
  });
  const proposed = [{ rule_text: "needs review", action_type_pattern: "send_email", effect: "always_require_approval" as const, provider: "Gmail" }];
  const result = await previewProposedHardRules(client, "user-1", proposed);
  if ("error" in result) throw new Error(`expected success, got error: ${result.error}`);
  assertEquals(result.proposed_rules, proposed);
});
