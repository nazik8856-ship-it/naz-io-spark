// Real tests for evaluateAction -- the deterministic-evaluation core
// extracted out of evaluateScenario (2026-08-23) so real-traffic-replay.ts
// can reuse it without evaluateScenario's expected/status grading, which
// only makes sense for a fixed test scenario, not a real historical
// action with no "correct answer" to grade against.
//
// Run with: deno test --allow-none supabase/functions/_shared/policy-replay_test.ts
import { evaluateAction, type PolicySnapshot } from "./policy-replay.ts";

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
