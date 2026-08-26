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
import { runControlGate, recordBreakerAttempt, AGENT_DECISION_SOURCES, createPendingApproval } from "./control-gate.ts";

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
  // Filters applied via .eq()/.is() on this particular query chain, keyed
  // by column name — lets a test assert e.g. that an agent-scoped read
  // actually filtered on agent_id, not just that the table was touched.
  filters: Record<string, unknown> = {};
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq(col: string, val: unknown) { this.filters[col] = val; return this; }
  is(col: string, val: unknown) { this.filters[col] = val; return this; }
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
  const calls: { table?: string; rpc?: string; filters?: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown[]> = {};
  const updates: Record<string, unknown[]> = {};
  const client = {
    from(table: string) {
      const q = new FakeQuery(() => tables[table] ?? { data: null, error: null });
      calls.push({ table, filters: q.filters });
      // deno-lint-ignore no-explicit-any
      (q as any).insert = (row?: unknown) => { (inserts[table] ??= []).push(row); return q; };
      // deno-lint-ignore no-explicit-any
      (q as any).update = (row?: unknown) => { (updates[table] ??= []).push(row); return q; };
      return q;
    },
    rpc(name: string) {
      calls.push({ rpc: name });
      return new FakeQuery(() => rpcs[name] ?? { data: null, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, calls, inserts, updates };
}

const baseCtx = {
  userId: "user-1",
  actionType: "send_email",
  provider: "Gmail",
  description: "Reply to a customer.",
  params: { to: "a@b.com" },
  origin: "control-engine" as const,
};

// ---- layer 0.5: platform-wide kill switch (must short-circuit even before
// the per-account spend cap / kill switch) -------------------------------

Deno.test("the platform kill switch blocks every account outright, before the per-account kill switch is even checked", async () => {
  const { client, calls } = fakeSupabase({
    platform_settings: { data: { kill_switch: true }, error: null },
    // If the account-level kill switch were read first (or at all, once
    // the platform one already stopped everything), this would trip too --
    // configuring it as OFF here means a false pass could only happen by
    // the platform check failing to actually short-circuit.
    profiles: { data: { kill_switch: false }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "platform_kill_switch");
  assert(result.killSwitch);
  assert(
    !calls.some((c) => c.table === "profiles"),
    "the platform-wide stop must short-circuit before the per-account kill switch is even read",
  );
});

Deno.test("the platform kill switch off (the default) lets normal per-account gating proceed", async () => {
  const { client } = fakeSupabase({
    platform_settings: { data: { kill_switch: false }, error: null },
    profiles: { data: { kill_switch: false }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok, "with both kill switches off, the action must be allowed through this layer");
});

Deno.test("no platform_settings row at all (not yet configured) behaves the same as it being off, not a crash", async () => {
  // Mirrors how every other table in this fake defaults to { data: null,
  // error: null } for anything not explicitly configured -- asserts the
  // gate treats a missing/null row as "not killed," not an exception.
  const { client } = fakeSupabase({
    profiles: { data: { kill_switch: false }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok);
});

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

Deno.test("a logged block carries apiKeyId onto the agent_decisions row, for tracing an external-api-sourced decision back to its key ('Outer NazAI' plan item 8)", async () => {
  const { client, inserts } = fakeSupabase({
    profiles: { data: { kill_switch: true }, error: null },
    agent_decisions: { data: { id: "decision-1" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, origin: "external-api", apiKeyId: "key-1" });
  assertFalse(result.ok);
  const logged = (inserts.agent_decisions ?? [])[0] as { api_key_id?: string | null } | undefined;
  assertEquals(logged?.api_key_id, "key-1");
});

Deno.test("a logged block has a null api_key_id when the request didn't come through the public Control API", async () => {
  const { client, inserts } = fakeSupabase({
    profiles: { data: { kill_switch: true }, error: null },
    agent_decisions: { data: { id: "decision-1" }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok);
  const logged = (inserts.agent_decisions ?? [])[0] as { api_key_id?: string | null } | undefined;
  assertEquals(logged?.api_key_id ?? null, null);
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

// ---- agent-scoped kill switch / spend cap (2026-08-23 regression guard) ---
// 20260821020000_per_agent_spend_cap.sql (Wave 5 session 1) started writing
// source: "agent_kill_switch" / "agent_ai_spend_cap" from these branches,
// but agent_decisions_source_check's CHECK constraint was never extended to
// allow them -- three days after it was last touched. Since supabase-js
// doesn't throw on a constraint violation and logStop() only destructures
// `data`, every per-agent kill-switch/spend-cap block silently produced NO
// agent_decisions row at all from 2026-08-21 until the fix in
// 20260823010000_fix_agent_decisions_source_check_per_agent.sql.
//
// control-gate.ts now exports AGENT_DECISION_SOURCES as the real source of
// truth (logStop's `source` param and every direct agent_decisions insert
// are typed against it, so a NEW source string used without extending that
// list is now a compile error, not a silent audit-trail gap). This test
// checks that exported list against the exact set the current migration
// allows -- there's still no live DB in this sandbox to check the real
// constraint, so this one list-vs-list comparison is the one place drift
// between code and migration can still slip through undetected.
const CURRENT_MIGRATION_ALLOWS = new Set([
  "model", "human_override",
  "kill_switch", "ai_spend_cap",
  "agent_kill_switch", "agent_ai_spend_cap",
  "hard_rule", "circuit_breaker", "circuit_breaker_trip",
  "safety_scanner", "anomaly_detector", "gate_error",
  "external_api", "platform_kill_switch",
  "kill_switch_flip", "platform_kill_switch_flip",
]);

Deno.test("an agent's own kill switch blocks only that agent, source is a constraint-valid value, and a real decisionId is produced", async () => {
  const { client, inserts } = fakeSupabase({
    profiles: { data: { kill_switch: false }, error: null },
    agents: { data: { kill_switch: true }, error: null },
    agent_decisions: { data: { id: "decision-agent-1" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, agentId: "agent-1" });
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "agent_kill_switch");
  assert(result.decisionId, "a per-agent kill-switch block must produce a real decisionId, not a silently-dropped insert");
  const logged = (inserts.agent_decisions ?? [])[0] as { source?: string } | undefined;
  assert(
    logged?.source !== undefined && CURRENT_MIGRATION_ALLOWS.has(logged.source),
    `source "${logged?.source}" must be a member of agent_decisions_source_check's allowed list, or the insert will silently fail against the real constraint`,
  );
  assertEquals(logged?.source, "agent_kill_switch");
});

Deno.test("AGENT_DECISION_SOURCES (control-gate.ts's real source of truth) matches the current agent_decisions_source_check migration exactly", () => {
  for (const source of AGENT_DECISION_SOURCES) {
    assert(CURRENT_MIGRATION_ALLOWS.has(source), `"${source}" is a valid AgentDecisionSource in code but missing from the migration's allowed list`);
  }
  for (const source of CURRENT_MIGRATION_ALLOWS) {
    assert((AGENT_DECISION_SOURCES as readonly string[]).includes(source), `"${source}" is allowed by the migration but missing from AGENT_DECISION_SOURCES -- either update the migration list here or add it to control-gate.ts`);
  }
});

// ---- gate observability: total latency (2026-08-23) ------------------------

Deno.test("runControlGate: a blocking result carries a non-negative gateDurationMs and persists it onto the logged decision", async () => {
  const { client, updates } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r1", rule_text: "blocks", action_type_pattern: "*", effect: "always_block", enabled: true }],
      error: null,
    },
    agent_decisions: { data: { id: "decision-1" }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assert(typeof result.gateDurationMs === "number" && result.gateDurationMs >= 0, "gateDurationMs must be a non-negative number");
  const updated = (updates.agent_decisions ?? [])[0] as { gate_duration_ms?: number } | undefined;
  assert(updated !== undefined, "expected an UPDATE on agent_decisions to persist gate_duration_ms");
  assertEquals(updated?.gate_duration_ms, result.gateDurationMs);
});

Deno.test("runControlGate: an allow verdict (no decisionId) still reports gateDurationMs but issues no update", async () => {
  const { client, updates } = fakeSupabase();
  const result = await runControlGate(client, baseCtx);
  assertEquals(result.verdict, "allow");
  assertEquals(result.decisionId, null);
  assert(typeof result.gateDurationMs === "number" && result.gateDurationMs >= 0, "gateDurationMs must be a non-negative number");
  assertEquals(updates.agent_decisions ?? [], []);
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

Deno.test("a hard-rule enforcement checks for a decision_logged webhook subscriber (SIEM export)", async () => {
  // No webhooks table configured -> triggerWebhooks sees zero hooks and
  // never calls fetch, so this stays a pure, network-free test while
  // still proving the gate actually queries for one.
  const { client, calls } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r1", rule_text: "Never post to #general", action_type_pattern: "slack_post_message", effect: "always_block", provider: "Slack", enabled: true }],
      error: null,
    },
    // logStop only checks for webhook subscribers once the decision itself
    // was actually logged (has a real id) -- without this, decisionId
    // comes back null and the webhook check is correctly skipped.
    agent_decisions: { data: { id: "decision-1" }, error: null },
  });
  await runControlGate(client, { ...baseCtx, actionType: "slack_post_message", provider: "Slack" });
  assert(calls.some((c) => c.table === "webhooks"), "expected the gate to check for a decision_logged webhook subscriber");
});

Deno.test("a hard-rule enforcement records which rule fired (hard_rule_id), for the dead-rule finder", async () => {
  const { client, inserts } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r1", rule_text: "Never post to #general", action_type_pattern: "slack_post_message", effect: "always_block", provider: "Slack", enabled: true }],
      error: null,
    },
  });
  await runControlGate(client, { ...baseCtx, actionType: "slack_post_message", provider: "Slack" });
  const logged = (inserts.agent_decisions ?? [])[0] as { hard_rule_id?: string | null } | undefined;
  assertEquals(logged?.hard_rule_id, "r1");
});

Deno.test("a decision NOT enforced by a hard rule records hard_rule_id as null", async () => {
  const { client, inserts } = fakeSupabase({
    profiles: { data: { kill_switch: true }, error: null },
  });
  await runControlGate(client, baseCtx);
  const logged = (inserts.agent_decisions ?? [])[0] as { hard_rule_id?: string | null } | undefined;
  assertEquals(logged?.hard_rule_id ?? null, null);
});

Deno.test("a hard-rule BLOCK captures ctx.params, for a possible break-glass override later (2026-08-23)", async () => {
  const { client, inserts } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r1", rule_text: "Never post to #general", action_type_pattern: "slack_post_message", effect: "always_block", provider: "Slack", enabled: true }],
      error: null,
    },
  });
  await runControlGate(client, { ...baseCtx, actionType: "slack_post_message", provider: "Slack" });
  const logged = (inserts.agent_decisions ?? [])[0] as { params?: unknown } | undefined;
  assertEquals(logged?.params, baseCtx.params);
});

Deno.test("a hard-rule BLOCK also captures ctx.description, for a possible real-traffic policy replay later (2026-08-23)", async () => {
  const { client, inserts } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r1", rule_text: "Never post to #general", action_type_pattern: "slack_post_message", effect: "always_block", provider: "Slack", enabled: true }],
      error: null,
    },
  });
  await runControlGate(client, { ...baseCtx, actionType: "slack_post_message", provider: "Slack" });
  const logged = (inserts.agent_decisions ?? [])[0] as { description?: string } | undefined;
  assertEquals(logged?.description, baseCtx.description);
});

Deno.test("a hard-rule APPROVAL_REQUIRED does NOT capture params on the decision row -- the pending_approvals row already carries it", async () => {
  const { client, inserts } = fakeSupabase({
    hard_rules: {
      data: [{ id: "r2", rule_text: "High-value orders need a human", action_type_pattern: "shopify_create_draft_order", effect: "always_require_approval", provider: null, enabled: true }],
      error: null,
    },
    pending_approvals: { data: { id: "approval-1" }, error: null },
  });
  await runControlGate(client, { ...baseCtx, actionType: "shopify_create_draft_order", provider: "Shopify" });
  const logged = (inserts.agent_decisions ?? [])[0] as { params?: unknown } | undefined;
  assertEquals(logged?.params ?? null, null);
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

// ---- "zero human review" plan, item 1: per-API-key auto-resolve policy ----

const requireApprovalHardRuleTables = {
  hard_rules: {
    data: [{ id: "r2", rule_text: "High-value orders need a human", action_type_pattern: "shopify_create_draft_order", effect: "always_require_approval", provider: null, enabled: true }],
    error: null,
  },
  pending_approvals: { data: { id: "approval-1" }, error: null },
};

Deno.test("no apiKeyId (an internal, non-external-api call) never consults api_keys at all -- unchanged behavior", async () => {
  const { client, calls } = fakeSupabase(requireApprovalHardRuleTables);
  const result = await runControlGate(client, { ...baseCtx, actionType: "shopify_create_draft_order", provider: "Shopify" });
  assertEquals(result.verdict, "require_approval");
  assertFalse(result.autoResolved);
  assert(!calls.some((c) => c.table === "api_keys"), "no apiKeyId means no reason to ever look up a policy");
});

Deno.test("apiKeyId set but the key's policy is 'human_review' (or the row is missing) behaves exactly like today -- still queued, not resolved", async () => {
  const { client } = fakeSupabase({ ...requireApprovalHardRuleTables, api_keys: { data: { on_uncertain: "human_review" }, error: null } });
  const result = await runControlGate(client, { ...baseCtx, origin: "external-api", apiKeyId: "key-1", actionType: "shopify_create_draft_order", provider: "Shopify" });
  assertFalse(result.ok);
  assertEquals(result.verdict, "require_approval");
  assertFalse(result.autoResolved);
  assertEquals(result.autoResolutionReason, null);
});

Deno.test("apiKeyId with on_uncertain='auto_allow' resolves a non-blocking hard-rule match to an outright allow, automatically", async () => {
  const { client, inserts } = fakeSupabase({ ...requireApprovalHardRuleTables, api_keys: { data: { on_uncertain: "auto_allow" }, error: null } });
  const result = await runControlGate(client, { ...baseCtx, origin: "external-api", apiKeyId: "key-1", actionType: "shopify_create_draft_order", provider: "Shopify" });
  assert(result.ok, "auto_allow must flip a non-blocking match to ok:true");
  assertEquals(result.verdict, "allow");
  assert(result.autoResolved);
  assert(result.autoResolutionReason?.includes("approved"));
  const inserted = (inserts.pending_approvals ?? [])[0] as { status?: string; resolved_at?: string | null } | undefined;
  assertEquals(inserted?.status, "auto_approved");
  assert(inserted?.resolved_at, "an auto-resolved row must carry a real resolved_at, not sit as 'pending' forever");
});

Deno.test("apiKeyId with on_uncertain='auto_deny' resolves a non-blocking hard-rule match to a block, automatically", async () => {
  const { client, inserts } = fakeSupabase({ ...requireApprovalHardRuleTables, api_keys: { data: { on_uncertain: "auto_deny" }, error: null } });
  const result = await runControlGate(client, { ...baseCtx, origin: "external-api", apiKeyId: "key-1", actionType: "shopify_create_draft_order", provider: "Shopify" });
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assert(result.autoResolved);
  const inserted = (inserts.pending_approvals ?? [])[0] as { status?: string } | undefined;
  assertEquals(inserted?.status, "auto_rejected");
});

Deno.test("SAFETY BOUNDARY: an outright BLOCKING hard rule is never auto-overridden by any policy, even auto_allow", async () => {
  const { client } = fakeSupabase({
    hard_rules: { data: [{ id: "r1", rule_text: "never send this", action_type_pattern: "*", effect: "always_block", provider: null, enabled: true }], error: null },
    api_keys: { data: { on_uncertain: "auto_allow" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, origin: "external-api", apiKeyId: "key-1" });
  assertFalse(result.ok, "a real block must never be overridden by an auto-resolve policy meant only for 'needs a second look' outcomes");
  assertEquals(result.verdict, "block");
  assertFalse(result.autoResolved, "createPendingApproval (and therefore any policy) is never even consulted on the blocking path");
});

// ---- item 3: createPendingApproval's forcedResolution (control-engine's auto_narrow flow) ----

const pendingApprovalBaseInput = {
  userId: "user-1",
  decisionId: "decision-1",
  actionType: "send_email",
  provider: "Gmail",
  description: "Reply to a customer.",
  params: { to: "a@b.com" },
  reason: "Needs a second look.",
  riskTier: "high",
  origin: "external-api",
};

Deno.test("createPendingApproval: forcedResolution bypasses the apiKeyId policy lookup entirely, even if one is also set", async () => {
  const { client, calls, inserts } = fakeSupabase({
    // If forcedResolution didn't take priority, this policy would resolve
    // to auto_allow instead of the forced "rejected" -- proves precedence.
    api_keys: { data: { on_uncertain: "auto_allow" }, error: null },
    pending_approvals: { data: { id: "approval-1" }, error: null },
  });
  const outcome = await createPendingApproval(client, {
    ...pendingApprovalBaseInput,
    apiKeyId: "key-1",
    forcedResolution: { resolution: "rejected", note: "narrowed version still failed" },
  });
  assert(outcome.autoResolved);
  assertEquals(outcome.resolution, "rejected");
  assert(!calls.some((c) => c.table === "api_keys"), "forcedResolution must skip the api_keys lookup entirely");
  const inserted = (inserts.pending_approvals ?? [])[0] as { status?: string; comment?: string } | undefined;
  assertEquals(inserted?.status, "auto_rejected");
  assertEquals(inserted?.comment, "narrowed version still failed");
});

Deno.test("createPendingApproval: forcedResolution 'approved' inserts an already-resolved, auto_approved row", async () => {
  const { client, inserts } = fakeSupabase({ pending_approvals: { data: { id: "approval-1" }, error: null } });
  const outcome = await createPendingApproval(client, {
    ...pendingApprovalBaseInput,
    forcedResolution: { resolution: "approved", note: "narrowed version passed cleanly" },
  });
  assert(outcome.autoResolved);
  assertEquals(outcome.resolution, "approved");
  const inserted = (inserts.pending_approvals ?? [])[0] as { status?: string; resolved_at?: string | null } | undefined;
  assertEquals(inserted?.status, "auto_approved");
  assert(inserted?.resolved_at);
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

Deno.test("a tripped circuit breaker blocks the matching action type (still within cooldown)", async () => {
  const { client } = fakeSupabase({
    circuit_breakers: {
      // Recent trip, well within BREAKER_COOLDOWN_MS -- must still block outright.
      data: { id: "b1", recent_outcomes: ["fail", "fail", "fail", "ok"], tripped: true, trip_count: 1, tripped_at: new Date().toISOString(), failure_rate: 0.75, last_reason: "x" },
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok);
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "circuit_breaker");
  assertFalse(result.circuitBreakerHalfOpenTrial, "still within cooldown -- this is a real block, not a trial");
});

Deno.test("a NOT-tripped circuit breaker does not block", async () => {
  const { client } = fakeSupabase({
    circuit_breakers: { data: { id: "b2", recent_outcomes: ["ok", "ok"], tripped: false, trip_count: 0, tripped_at: null, failure_rate: 0, last_reason: null }, error: null },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok);
  assertFalse(result.circuitBreakerHalfOpenTrial);
});

// ---- half-open cooldown auto-recovery (2026-08-24) -------------------------
// A tripped breaker never cleared itself before this -- manual reset only.
// Once tripped_at is old enough, the NEXT attempt is let through as a single
// trial rather than blocked outright.

Deno.test("a tripped breaker past its cooldown lets the next attempt through as a half-open trial", async () => {
  const staleTrip = new Date(Date.now() - 20 * 60_000).toISOString(); // 20 min ago > 15 min cooldown
  const { client } = fakeSupabase({
    circuit_breakers: {
      data: { id: "b1", recent_outcomes: ["fail", "fail", "fail", "fail"], tripped: true, trip_count: 1, tripped_at: staleTrip, failure_rate: 1, last_reason: "x" },
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  assert(result.ok, "the trial attempt must be let through, not blocked");
  assertEquals(result.verdict, "allow");
  assert(result.circuitBreakerHalfOpenTrial, "must be flagged as a half-open trial so the caller records its outcome decisively");
});

Deno.test("half-open trial: a successful outcome clears the breaker outright, even with a mostly-failed window", async () => {
  const staleTrip = new Date(Date.now() - 20 * 60_000).toISOString();
  const { client, updates } = fakeSupabase({
    circuit_breakers: {
      data: { id: "b1", recent_outcomes: ["fail", "fail", "fail", "fail", "fail", "fail", "fail", "fail", "fail"], tripped: true, trip_count: 1, tripped_at: staleTrip, failure_rate: 1, last_reason: "x" },
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  await result.recordAttempt(false, "ok");
  const updated = (updates.circuit_breakers ?? [])[0] as { tripped?: boolean; tripped_at?: string | null; recent_outcomes?: string[] } | undefined;
  assertEquals(updated?.tripped, false, "one successful trial must clear the breaker even though the raw window is still mostly failed");
  assertEquals(updated?.tripped_at, null);
  assertEquals(updated?.recent_outcomes, ["ok"], "the window resets on a successful trial so leftover stale failures can't immediately re-trip it");
});

Deno.test("half-open trial: a failed outcome re-trips immediately and restarts the cooldown", async () => {
  const staleTrip = new Date(Date.now() - 20 * 60_000).toISOString();
  const { client, updates } = fakeSupabase({
    circuit_breakers: {
      data: { id: "b1", recent_outcomes: ["ok", "ok", "ok"], tripped: true, trip_count: 1, tripped_at: staleTrip, failure_rate: 1, last_reason: "x" },
      error: null,
    },
  });
  const result = await runControlGate(client, baseCtx);
  await result.recordAttempt(true, "still broken");
  const updated = (updates.circuit_breakers ?? [])[0] as { tripped?: boolean; tripped_at?: string | null; trip_count?: number } | undefined;
  assertEquals(updated?.tripped, true, "a failed trial must re-trip immediately, not wait for a fresh window to confirm a pattern");
  assert(!!updated?.tripped_at, "tripped_at must be restamped so the cooldown restarts from now");
  assertEquals(updated?.trip_count, 2, "a re-trip after a failed trial counts as a new trip");
});

// ---- per-agent circuit breaker scoping (2026-08-22) ------------------------
// A breaker is inherently "have MY recent attempts failed" -- when an
// agentId is known it must live entirely on that agent's own row, never
// shared with the account-wide row or another agent's row.

Deno.test("an agent-scoped gate check reads that agent's own breaker row, not the account-wide one", async () => {
  const { client, calls } = fakeSupabase({
    circuit_breakers: { data: { id: "b1", recent_outcomes: [], tripped: false, trip_count: 0, tripped_at: null, failure_rate: 0, last_reason: null }, error: null },
  });
  await runControlGate(client, { ...baseCtx, agentId: "agent-1" });
  const breakerRead = calls.find((c) => c.table === "circuit_breakers");
  assertEquals(breakerRead?.filters?.agent_id, "agent-1");
});

Deno.test("an agent-less gate check reads the account-wide breaker row (agent_id IS NULL)", async () => {
  const { client, calls } = fakeSupabase({
    circuit_breakers: { data: { id: "b1", recent_outcomes: [], tripped: false, trip_count: 0, tripped_at: null, failure_rate: 0, last_reason: null }, error: null },
  });
  await runControlGate(client, baseCtx); // no agentId
  const breakerRead = calls.find((c) => c.table === "circuit_breakers");
  assertEquals(breakerRead?.filters?.agent_id, null);
});

Deno.test("recordBreakerAttempt for a known agent inserts a new row scoped to that agent, not account-wide", async () => {
  const { client, inserts, calls } = fakeSupabase({}); // no existing breaker row anywhere
  await recordBreakerAttempt(client, {
    userId: "user-1", actionType: "send_email", provider: "Gmail", failed: true, why: "boom", agentId: "agent-1",
  });
  const inserted = (inserts.circuit_breakers ?? [])[0] as { agent_id?: string | null } | undefined;
  assertEquals(inserted?.agent_id, "agent-1");
  const reads = calls.filter((c) => c.table === "circuit_breakers");
  assertEquals(reads[0]?.filters?.agent_id, "agent-1", "the initial lookup must be scoped to this agent's own row");
});

Deno.test("recordBreakerAttempt with no agent inserts a new row scoped account-wide (agent_id null)", async () => {
  const { client, inserts } = fakeSupabase({});
  await recordBreakerAttempt(client, {
    userId: "user-1", actionType: "send_email", provider: "Gmail", failed: true, why: "boom",
  });
  const inserted = (inserts.circuit_breakers ?? [])[0] as { agent_id?: string | null } | undefined;
  assertEquals(inserted?.agent_id ?? null, null);
});

Deno.test("recordBreakerAttempt updates the existing agent-scoped row by id instead of blindly upserting", async () => {
  // Two partial unique indexes now back circuit_breakers (account-wide vs.
  // per-agent), so a plain upsert can't infer the right conflict target --
  // this proves the find-then-update-by-id fallback actually runs.
  const { client, updates, calls } = fakeSupabase({
    circuit_breakers: { data: { id: "existing-row", recent_outcomes: ["ok"], tripped: false, trip_count: 0 }, error: null },
  });
  await recordBreakerAttempt(client, {
    userId: "user-1", actionType: "send_email", provider: "Gmail", failed: true, why: "boom", agentId: "agent-1",
  });
  const updated = (updates.circuit_breakers ?? [])[0] as { agent_id?: string | null } | undefined;
  assert(updated !== undefined, "expected an update, not an insert, when a row already exists");
  assertEquals(updated?.agent_id, "agent-1");
  const updateCall = calls.filter((c) => c.table === "circuit_breakers")[1];
  assertEquals(updateCall?.filters?.id, "existing-row", "must target the found row by id, not a blind upsert");
});

Deno.test("recordBreakerAttempt re-reads the same agent-scoped row it just wrote, not the account-wide row", async () => {
  const { client, calls } = fakeSupabase({
    circuit_breakers: { data: { id: "existing-row", recent_outcomes: ["ok"], tripped: false, trip_count: 0 }, error: null },
  });
  await recordBreakerAttempt(client, {
    userId: "user-1", actionType: "send_email", provider: "Gmail", failed: true, why: "boom", agentId: "agent-1",
  });
  const breakerCalls = calls.filter((c) => c.table === "circuit_breakers");
  assertEquals(breakerCalls.length, 3, "read, then update, then a final re-read");
  assertEquals(breakerCalls[2]?.filters?.agent_id, "agent-1", "the final re-read must stay scoped to this agent");
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

Deno.test("a safety-scanner BLOCK captures ctx.params, for a possible break-glass override later (2026-08-23)", async () => {
  const { client, inserts } = fakeSupabase();
  await runControlGate(client, { ...baseCtx, description: "delete all customer records" });
  const logged = (inserts.agent_decisions ?? [])[0] as { params?: unknown } | undefined;
  assertEquals(logged?.params, baseCtx.params);
});

Deno.test("a safety-scanner BLOCK also captures ctx.description, for a possible real-traffic policy replay later (2026-08-23)", async () => {
  const { client, inserts } = fakeSupabase();
  await runControlGate(client, { ...baseCtx, description: "delete all customer records" });
  const logged = (inserts.agent_decisions ?? [])[0] as { description?: string } | undefined;
  assertEquals(logged?.description, "delete all customer records");
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

Deno.test("item 1: an auto_allow policy also resolves a safety-scanner require_approval match automatically", async () => {
  const { client } = fakeSupabase({
    pending_approvals: { data: { id: "approval-2" }, error: null },
    api_keys: { data: { on_uncertain: "auto_allow" }, error: null },
  });
  const result = await runControlGate(client, {
    ...baseCtx, origin: "external-api", apiKeyId: "key-1",
    description: "send this update to all customers on the list",
  });
  assert(result.ok);
  assertEquals(result.verdict, "allow");
  assert(result.autoResolved);
});

// ---- safety rule shadow-mode parity (2026-08-22) ---------------------------

const shadowSafetyRules = {
  safety_rules: {
    data: [{ id: "sr-1", name: "Trial rule", category: "custom", pattern: "shadow-trigger", severity: "block", enabled: true, shadow_mode: true }],
    error: null,
  },
};

Deno.test("a shadow-mode custom safety rule never blocks; it's surfaced in safety.shadowMatches instead", async () => {
  const { client } = fakeSupabase(shadowSafetyRules);
  const result = await runControlGate(client, { ...baseCtx, description: "contains shadow-trigger text" });
  assert(result.ok, "a shadow-mode safety rule must never actually block");
  assertEquals(result.safety.shadowMatches.length, 1);
  assertEquals(result.safety.shadowMatches[0].rule_id, "sr-1");
});

Deno.test("recordSafetyShadowHits, called by the caller once the real final decision is known, inserts a row", async () => {
  const { client, inserts } = fakeSupabase(shadowSafetyRules);
  const result = await runControlGate(client, { ...baseCtx, description: "contains shadow-trigger text" });
  await result.recordSafetyShadowHits("decision-99", "allow");
  // insert() is called once with an ARRAY of rows (one per shadow match),
  // so each push into `inserts` is itself that array.
  const calls = (inserts.safety_rule_shadow_hits ?? []) as Record<string, unknown>[][];
  assertEquals(calls.length, 1);
  const rows = calls[0];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].rule_id, "sr-1");
  assertEquals(rows[0].decision_id, "decision-99");
  assertEquals(rows[0].actual_decision, "allow");
  assertEquals(rows[0].would_have, "block");
});

Deno.test("a live safety-scanner block also auto-records any shadow-mode safety rule that ALSO matched", async () => {
  const { client, inserts } = fakeSupabase(shadowSafetyRules);
  // "delete all" trips the builtin (live) block rule; "shadow-trigger" in
  // the same description also matches the shadow-mode custom rule.
  const result = await runControlGate(client, { ...baseCtx, description: "delete all customer records, ref shadow-trigger" });
  assertFalse(result.ok);
  assertEquals(result.source, "safety_scanner");
  const calls = (inserts.safety_rule_shadow_hits ?? []) as Record<string, unknown>[][];
  assertEquals(calls.length, 1);
  assertEquals(calls[0].length, 1);
  assertEquals(calls[0][0].rule_id, "sr-1");
  assertEquals(calls[0][0].actual_decision, "block");
});

Deno.test("a live (non-shadow) custom safety rule match is recorded to safety_rule_matches for the dead-rule finder", async () => {
  const { client, inserts } = fakeSupabase({
    safety_rules: {
      data: [{ id: "sr-live-1", name: "Live rule", category: "custom", pattern: "live-flag-word", severity: "block", enabled: true, shadow_mode: false }],
      error: null,
    },
  });
  const result = await runControlGate(client, { ...baseCtx, description: "contains live-flag-word" });
  assertFalse(result.ok);
  assertEquals(result.source, "safety_scanner");
  const calls = (inserts.safety_rule_matches ?? []) as Record<string, unknown>[][];
  assertEquals(calls.length, 1);
  assertEquals(calls[0].length, 1);
  assertEquals(calls[0][0].rule_id, "sr-live-1");
});

Deno.test("a builtin-only safety match never writes to safety_rule_matches (builtin ids aren't real safety_rules rows)", async () => {
  const { client, inserts } = fakeSupabase();
  const result = await runControlGate(client, { ...baseCtx, description: "delete all customer records" });
  assertFalse(result.ok);
  assertEquals(result.source, "safety_scanner");
  assertEquals(inserts.safety_rule_matches ?? [], []);
});

Deno.test("a kill-switch block never reaches the safety scanner, so no shadow safety hit is recorded even with a matching shadow rule configured", async () => {
  const { client, inserts } = fakeSupabase({
    profiles: { data: { kill_switch: true }, error: null },
    ...shadowSafetyRules,
  });
  await runControlGate(client, { ...baseCtx, description: "contains shadow-trigger text" });
  assertEquals(inserts.safety_rule_shadow_hits ?? [], []);
});

Deno.test("nothing trips: the gate allows, safety scan still returned but unmatched", async () => {
  const result = await runControlGate(fakeSupabase().client, baseCtx);
  assert(result.ok);
  assertEquals(result.verdict, "allow");
  assertFalse(result.safety.matched);
});

Deno.test("trace: a clean allow (no agentId) shows every layer ok except anomaly, which is skipped", async () => {
  const result = await runControlGate(fakeSupabase().client, baseCtx); // baseCtx has no agentId
  assertEquals(result.trace.length, 6);
  const byLayer = Object.fromEntries(result.trace.map((e) => [e.layer, e.status]));
  assertEquals(byLayer.spend_cap, "ok");
  assertEquals(byLayer.kill_switch, "ok");
  assertEquals(byLayer.hard_rules, "ok");
  assertEquals(byLayer.circuit_breaker, "ok");
  assertEquals(byLayer.safety_scanner, "ok");
  assertEquals(byLayer.anomaly_detector, "skipped");
});

Deno.test("trace: a clean allow WITH an agentId and enough history shows anomaly as ok too, not skipped", async () => {
  // The fake client can't distinguish "last 14 days" from "today" (both
  // queries hit the same canned rows), so if EVERY row were send_email,
  // today's raw count would equal the whole baseline total and always look
  // like a spike. To get a genuine non-anomalous "known action_type, normal
  // volume" case: pad daysObserved with a DIFFERENT action_type (doesn't
  // affect send_email's today-count, since that's filtered by type), and
  // give send_email just one prior occurrence so its threshold (floor 3)
  // comfortably covers today's count of 2 (1 prior + 1 this one).
  const { client } = fakeSupabase({
    agent_events: {
      data: [
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-01T10:00:00Z" },
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-02T10:00:00Z" },
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-03T10:00:00Z" },
        { payload: { type: "send_email", ok: true }, created_at: "2026-08-04T10:00:00Z" },
      ],
      error: null,
    },
  });
  const result = await runControlGate(client, { ...baseCtx, agentId: "agent-trace-1" }); // actionType is send_email
  const anomalyEntry = result.trace.find((e) => e.layer === "anomaly_detector")!;
  assertEquals(anomalyEntry.status, "ok");
});

Deno.test("trace: a kill-switch block leaves hard_rules/circuit_breaker/safety_scanner/anomaly as not_reached", async () => {
  const { client } = fakeSupabase({ profiles: { data: { kill_switch: true }, error: null } });
  const result = await runControlGate(client, baseCtx);
  assertEquals(result.trace.length, 6);
  const byLayer = Object.fromEntries(result.trace.map((e) => [e.layer, e.status]));
  assertEquals(byLayer.spend_cap, "ok");
  assertEquals(byLayer.kill_switch, "stopped");
  assertEquals(byLayer.hard_rules, "not_reached");
  assertEquals(byLayer.circuit_breaker, "not_reached");
  assertEquals(byLayer.safety_scanner, "not_reached");
  assertEquals(byLayer.anomaly_detector, "not_reached");
});

Deno.test("trace: a hard-rule block leaves circuit_breaker/safety_scanner/anomaly as not_reached, spend/kill/hard_rules ok or stopped", async () => {
  const { client } = fakeSupabase({
    hard_rules: { data: [{ id: "rt1", rule_text: "blocks", action_type_pattern: "*", effect: "always_block", enabled: true }], error: null },
  });
  const result = await runControlGate(client, baseCtx);
  const byLayer = Object.fromEntries(result.trace.map((e) => [e.layer, e.status]));
  assertEquals(byLayer.spend_cap, "ok");
  assertEquals(byLayer.kill_switch, "ok");
  assertEquals(byLayer.hard_rules, "stopped");
  assertEquals(byLayer.circuit_breaker, "not_reached");
  assertEquals(byLayer.safety_scanner, "not_reached");
  assertEquals(byLayer.anomaly_detector, "not_reached");
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

Deno.test("anomaly: the org's strictness dial (profiles.control_strictness) is actually read and applied", async () => {
  // 2 distinct days of history — the balanced default (min 3 days) would
  // skip this entirely (already covered by the previous test); Strict only
  // needs 2 days, so this is the case that proves strictness is genuinely
  // threaded through, not just accepted and ignored.
  const { client } = fakeSupabase({
    profiles: { data: { control_strictness: "strict" }, error: null },
    agent_events: {
      data: [
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-01T10:00:00Z" },
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-02T10:00:00Z" },
      ],
      error: null,
    },
    pending_approvals: { data: { id: "approval-anomaly-strict" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, agentId: "agent-3" });
  assertFalse(result.ok, "Strict mode needs only 2 days of history — this must be caught, not skipped");
  assertEquals(result.source, "anomaly_detector");
});

Deno.test("anomaly: this agent's OWN strictness override is used, not just the account default (regression: agentId was previously dropped)", async () => {
  // Account default is balanced (no profiles.control_strictness row at
  // all) -- balanced needs 3 days of history to ever flag anything, so with
  // only 2 days this would stay silent UNLESS the agent's own "strict"
  // override (which only needs 2 days) is actually read. Proves
  // loadStrictness is called with agentId, not just userId.
  const { client } = fakeSupabase({
    agent_strictness_overrides: { data: { strictness: "strict" }, error: null },
    agent_events: {
      data: [
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-01T10:00:00Z" },
        { payload: { type: "slack_post_message", ok: true }, created_at: "2026-08-02T10:00:00Z" },
      ],
      error: null,
    },
    pending_approvals: { data: { id: "approval-anomaly-override" }, error: null },
  });
  const result = await runControlGate(client, { ...baseCtx, agentId: "agent-4" });
  assertFalse(result.ok, "the agent's own strict override must be honored, not silently ignored in favor of the account default");
  assertEquals(result.source, "anomaly_detector");
});

// ---- fail-closed on unexpected errors --------------------------------------

Deno.test("an unexpected DB error mid-gate fails CLOSED (blocked), never open (allowed)", async () => {
  // profiles is read directly (not just via the resilient, never-throws
  // spend-guard helpers) for the kill-switch check. Make that one query
  // throw, simulating a transient DB/network failure, and confirm the gate
  // still comes back blocked instead of letting the exception escape and
  // (if a future caller isn't as careful as today's three are) letting the
  // action run ungated.
  const client = {
    from(table: string) {
      if (table === "profiles") {
        return new FakeQuery(() => { throw new Error("simulated connection reset"); });
      }
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    rpc() {
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const result = await runControlGate(client, baseCtx);
  assertFalse(result.ok, "an unexpected error must never resolve to an allowed action");
  assertEquals(result.verdict, "block");
  assertEquals(result.source, "gate_error");
  assert(typeof result.reason === "string" && result.reason.length > 0, "must explain why it blocked");
});

Deno.test("an unexpected DB error mid-gate opens a real incident, not just a decision row and an alert", async () => {
  // gate_error is a real, listed IncidentKind (incidents.ts explicitly
  // calls out "the gate itself failing closed" as incident-worthy) -- this
  // asserts the fail-closed block actually opens one, not just logs a
  // decision and fires a Slack alert.
  const insertedTables: string[] = [];
  const client = {
    from(table: string) {
      const q = new FakeQuery(() => {
        if (table === "profiles") throw new Error("simulated connection reset");
        return { data: null, error: null };
      });
      // deno-lint-ignore no-explicit-any
      (q as any).insert = (row?: unknown) => { insertedTables.push(table); return q; };
      return q;
    },
    rpc() {
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  await runControlGate(client, baseCtx);
  assert(insertedTables.includes("incidents"), `expected an incidents insert, got tables: ${insertedTables.join(", ")}`);
});

Deno.test("an unexpected error mid-gate still returns safe no-op recordShadowHits/recordAttempt closures", async () => {
  // Callers unconditionally call gate.recordShadowHits(...) / gate.recordAttempt(...)
  // after checking gate.ok — the fail-closed branch must hand back real,
  // safe functions here too, not leave callers to null-check first.
  const client = {
    from(table: string) {
      if (table === "profiles") {
        return new FakeQuery(() => { throw new Error("simulated connection reset"); });
      }
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    rpc() {
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const result = await runControlGate(client, baseCtx);
  await result.recordShadowHits("decision-x", "block");
  const attempt = await result.recordAttempt(true, "test");
  assertEquals(attempt, null);
});
