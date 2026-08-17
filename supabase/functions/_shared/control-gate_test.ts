// Real tests for the unified control gate — the deterministic (no-LLM) path
// EVERY real action passes through before anything runs. Exercises
// `runControlGate` itself (the exact function control-engine and agent-runtime
// call), not a re-implementation of its logic, using a minimal fake Supabase
// client that returns canned per-table rows.
//
// Covers: each layer tripping in isolation, and the documented order —
// spend cap + kill switch must short-circuit BEFORE hard rules are even
// read, hard rules before the circuit breaker, circuit breaker before the
// safety scanner.
//
// Run with: deno test --allow-none supabase/functions/_shared/control-gate_test.ts
import { runControlGate } from "./control-gate.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Minimal fake Supabase client. Every query-builder method is chainable and
// the object is itself a thenable that resolves to a canned { data, error }
// per table name, configured per test. Defaults to `{ data: null, error: null }`
// for anything not configured, matching how a real "no row found" read behaves.
// ---------------------------------------------------------------------------
type Row = { data?: unknown; error?: unknown };

class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  gte() { return this; }
  in() { return this; }
  contains() { return this; }
  order() { return this; }
  limit() { return this; }
  insert(_row?: unknown) { return this; }
  update(_row?: unknown) { return this; }
  upsert(_row?: unknown, _opts?: unknown) { return this; }
  maybeSingle() { return this; }
  single() { return this; }
  // deno-lint-ignore no-explicit-any
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function fakeSupabase(tables: Record<string, Row> = {}, rpcs: Record<string, Row> = {}) {
  const calls: { table?: string; rpc?: string }[] = [];
  const client = {
    from(table: string) {
      calls.push({ table });
      return new FakeQuery(() => tables[table] ?? { data: null, error: null });
    },
    rpc(name: string) {
      calls.push({ rpc: name });
      return new FakeQuery(() => rpcs[name] ?? { data: null, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, calls };
}

const baseCtx = {
  userId: "user-1",
  actionType: "send_email",
  provider: "Gmail",
  description: "Reply to a customer.",
  params: { to: "a@b.com" },
  origin: "control-engine" as const,
};

// ---- layer 1/2: spend cap + kill switch (must short-circuit first) --------

Deno.test("kill switch on blocks outright, attributed to kill_switch even when a hard rule would ALSO match", async () => {
  // The gate reads hard_rules/circuit_breakers unconditionally up front (to
  // build shadow-rule info), so this does NOT assert those tables go
  // unread — it asserts the thing that actually matters for safety:
  // enforcement precedence. A hard rule that would also block this action
  // must never be what gets credited/enforced once the kill switch is on.
  const { client } = fakeSupabase({
    profiles: { data: { kill_switch: true }, error: null },
    hard_rules: { data: [{ id: "r1", rule_text: "also matches", action_type_pattern: "*", effect: "always_block", enabled: true }], error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "kill_switch");
  assert(result.killSwitch);
  assertEquals(result.hardRule, null, "the hard rule must not be the thing enforced once the kill switch trips first");
});

Deno.test("daily spend cap over budget blocks, same as the kill switch", async () => {
  const { client } = fakeSupabase({
    ai_spend_caps: { data: { daily_cap_usd: 5, enabled: true }, error: null },
    ai_spend_daily: { data: { cost_usd: 5.5, calls: 40 }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "ai_spend_cap");
});

Deno.test("spend under cap and kill switch off does not block at this layer", async () => {
  const { client } = fakeSupabase({
    ai_spend_caps: { data: { daily_cap_usd: 5, enabled: true }, error: null },
    ai_spend_daily: { data: { cost_usd: 1, calls: 3 }, error: null },
    profiles: { data: { kill_switch: false }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok);
  assertEquals(result.verdict, "allow");
});

// ---- layer 3: hard rules ----------------------------------------------------

Deno.test("a matching always_block hard rule blocks and is NOT judged by the model", async () => {
  const { client } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r1", rule_text: "Never post to #general", action_type_pattern: "slack_post_message", effect: "always_block", provider: "Slack", enabled: true }],
      error: null,
    },
  });
  const result = await runControlGate(client, { ...baseCtx, actionType: "slack_post_message", provider: "Slack" });
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "hard_rule");
  assertEquals(result.hardRule?.id, "r1");
});

Deno.test("a matching always_require_approval hard rule queues an approval instead of blocking outright", async () => {
  const { client } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r2", rule_text: "High-value orders need a human", action_type_pattern: "shopify_create_draft_order", effect: "always_require_approval", provider: null, enabled: true }],
      error: null,
    },
    pending_approvals: { data: { id: "approval-1" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, actionType: "shopify_create_draft_order", provider: "Shopify" });
  assertFalse(result.ok);
  assertEquals(result.verdict, "require_approval");
  assertEquals(result.approvalId, "approval-1");
});

Deno.test("a hard rule scoped to a different provider does not match", async () => {
  const { client } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r3", rule_text: "Only Shopify writes need approval", action_type_pattern: "*", effect: "always_block", provider: "Shopify", enabled: true }],
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx); // provider is Gmail
  assert(result.ok);
});

Deno.test("a hard rule with shadow_mode=true never blocks, only records what it would have done", async () => {
  const { client } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r4", rule_text: "Trial rule", action_type_pattern: "*", effect: "always_block", provider: null, enabled: true, shadow_mode: true }],
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok, "shadow-mode rules must never actually block");
  assertEquals(result.shadowRules.length, 1);
  assertEquals(result.shadowRules[0].would_have, "block");
  assertFalse(result.shadowRules[0].enforced);
});

Deno.test("a disabled hard rule is ignored", async () => {
  const { client } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r5", rule_text: "off", action_type_pattern: "*", effect: "always_block", enabled: false }],
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok);
});

// ---- layer 4: circuit breaker ----------------------------------------------

Deno.test("a tripped circuit breaker blocks the matching action type", async () => {
  const { client } = fakeSupabase({
    circuit_breakers: {
      data: { id: "b1", recent_outcomes: ["fail", "fail", "fail", "ok"], tripped: true, trip_count: 1, tripped_at: "2026-08-17T00:00:00Z", failure_rate: 0.75, last_reason: "x" },
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "circuit_breaker");
});

Deno.test("a NOT-tripped circuit breaker does not block", async () => {
  const { client } = fakeSupabase({
    circuit_breakers: { data: { id: "b2", recent_outcomes: ["ok", "ok"], tripped: false, trip_count: 0, tripped_at: null, failure_rate: 0, last_reason: null }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok);
});

// ---- layer 5: deterministic safety scanner (runs last, before any model) --

Deno.test("a safety-scanner block-severity match blocks", async () => {
  const result = await runControlGate(fakeSupabase().client, {
    ...baseCtx,
    description: "delete all customer records",
  });
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "safety_scanner");
});

Deno.test("a safety-scanner require_approval-severity match queues approval, does not hard-block", async () => {
  const { client } = fakeSupabase({ pending_approvals: { data: { id: "approval-2" }, error: null } });
  const result = await runControlGate(client, {
    ...baseCtx,
    description: "send this update to all customers on the list",
  });
  assertFalse(result.ok);
  assertEquals(result.verdict, "require_approval");
  assertEquals(result.approvalId, "approval-2");
});

Deno.test("nothing trips: the gate allows, safety scan still returned but unmatched", async () => {
  const result = await runControlGate(fakeSupabase().client, baseCtx);
  assert(result.ok);
  assertEquals(result.verdict, "allow");
  assertFalse(result.safety.matched);
});

// ---- ordering: layer precedence across the whole stack ---------------------

Deno.test("ordering: kill switch wins over a hard rule that would ALSO block", async () => {
  const { client } = fakeSupabase({
    profiles: { data: { kill_switch: true }, error: null },
    hard_rules: { data: [{ id: "r6", rule_text: "also blocks", action_type_pattern: "*", effect: "always_block", enabled: true }], error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assertEquals(result.source, "kill_switch", "kill switch must win the source attribution, not hard_rule");
});

Deno.test("ordering: a hard rule block wins over a circuit breaker that's ALSO tripped", async () => {
  const { client } = fakeSupabase({
    hard_rules: { data: [{ id: "r7", rule_text: "blocks first", action_type_pattern: "*", effect: "always_block", enabled: true }], error: null },
    circuit_breakers: { data: { id: "b3", recent_outcomes: ["fail", "fail", "fail", "fail"], tripped: true, trip_count: 1, tripped_at: "x", failure_rate: 1, last_reason: "x" }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assertEquals(result.source, "hard_rule", "hard rule must be attributed, not circuit_breaker, per the documented order");
});

Deno.test("ordering: a tripped circuit breaker wins over a safety-scanner match that would ALSO trigger", async () => {
  const { client } = fakeSupabase({
    circuit_breakers: { data: { id: "b4", recent_outcomes: ["fail", "fail", "fail", "fail"], tripped: true, trip_count: 1, tripped_at: "x", failure_rate: 1, last_reason: "x" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, description: "delete all customer records" });
  assertEquals(result.source, "circuit_breaker", "circuit breaker must be attributed before the safety scanner ever runs");
});

// ---- layer 6: per-agent behavioral-baseline anomaly detector --------------
// The anomaly-detector's own decision math (thresholds, multipliers, the
// insufficient-data skip) has its own dedicated, thorough test file
// (anomaly-detector_test.ts). These just verify control-gate WIRES it in
// correctly: forces require_approval, attributes the right source, and only
// runs at all when an agentId is present to baseline against.

Deno.test("anomaly: with no agentId in context, the anomaly layer is skipped entirely (nothing to baseline against)", async () => {
  const result = await runControlGate(fakeSupabase().client, baseCtx); // baseCtx has no agentId
  assert(result.ok);
  assertEquals(result.anomaly, null);
});

Deno.test("anomaly: an agent with 3+ days of history that never used this action_type is held for approval", async () => {
  const { client } = fakeSupabase({
    agent_events: {
      data: [
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-01T10:00:00Z" },
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-02T10:00:00Z" },
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-03T10:00:00Z" },
      ],
      error: null,
    },
    pending_approvals: { data: { id: "approval-anomaly-1" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, agentId: "agent-1" }); // baseCtx.actionType is send_email, never seen above
  assertFalse(result.ok);
  assertEquals(result.verdict, "require_approval");
  assertEquals(result.source, "anomaly_detector");
  assert(result.anomaly?.anomalous === true);
  assertEquals(result.approvalId, "approval-anomaly-1");
});

Deno.test("anomaly: an agent with fewer than 3 days of history is never held, even for a brand-new action_type", async () => {
  const { client } = fakeSupabase({
    agent_events: {
      data: [{ payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-01T10:00:00Z" }],
      error: null,
    },
  });
  const result = await runControlGate(client, { ...baseCtx, agentId: "agent-2" });
  assert(result.ok, "insufficient baseline data must never force an approval");
  assertEquals(result.anomaly, null);
});
