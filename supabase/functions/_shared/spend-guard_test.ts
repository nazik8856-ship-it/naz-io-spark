// Real tests for the daily AI spend cap — both the pre-existing account-wide
// mechanism and the new, parallel per-agent one (Wave 5 session 1). Exercises
// the actual exported functions against a minimal fake Supabase client, not a
// re-implementation of their logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/spend-guard_test.ts
import { estimateCostUsd, getAgentSpendStatus, getSpendStatus, shouldClearAutoSpendTrip, recordAiSpend } from "./spend-guard.ts";

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
// Same minimal fake Supabase client pattern as control-gate_test.ts: every
// query-builder method is chainable, the object itself is a thenable that
// resolves to a canned { data, error } configured per table for this test.
// ---------------------------------------------------------------------------
type Row = { data?: unknown; error?: unknown };

class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  maybeSingle() { return this; }
  // deno-lint-ignore no-explicit-any
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function fakeSupabase(tables: Record<string, Row> = {}) {
  const client = {
    from(table: string) {
      return new FakeQuery(() => tables[table] ?? { data: null, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return client as any;
}

// ---- estimateCostUsd --------------------------------------------------------

Deno.test("estimateCostUsd: a known model prices prompt and completion tokens separately", () => {
  const cost = estimateCostUsd("openai/gpt-5-mini", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
  assertEquals(cost, 0.25 + 2);
});

Deno.test("estimateCostUsd: an unknown model falls back to the default price", () => {
  const known = estimateCostUsd("default", { prompt_tokens: 1_000_000, completion_tokens: 0 });
  const unknown = estimateCostUsd("some/unheard-of-model", { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assertEquals(unknown, known);
});

Deno.test("estimateCostUsd: no usage at all costs nothing", () => {
  assertEquals(estimateCostUsd("openai/gpt-5-mini", undefined), 0);
  assertEquals(estimateCostUsd("openai/gpt-5-mini", null), 0);
});

Deno.test("estimateCostUsd: completion tokens derived from total_tokens when not given directly", () => {
  const cost = estimateCostUsd("openai/gpt-5-mini", { prompt_tokens: 1_000_000, total_tokens: 2_000_000 });
  assertEquals(cost, 0.25 + 2);
});

Deno.test("estimateCostUsd: agent-runtime's DEEP_MODEL is priced at its own pro-tier rate, not silently falling back to default", () => {
  const deepCost = estimateCostUsd("google/gemini-3.1-pro-preview", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
  const defaultCost = estimateCostUsd("default", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
  assertEquals(deepCost, 1.25 + 10);
  assert(deepCost > defaultCost, "the pro-tier model actually used for deep_analyze/audit_url/make_plan must not be under-priced as if it were the cheap default");
});

// ---- shouldClearAutoSpendTrip ----------------------------------------------

Deno.test("shouldClearAutoSpendTrip: no row at all -> nothing to clear", () => {
  assertFalse(shouldClearAutoSpendTrip(null, "2026-08-21"));
});

Deno.test("shouldClearAutoSpendTrip: kill switch off -> nothing to clear", () => {
  assertFalse(shouldClearAutoSpendTrip({ kill_switch: false, kill_switch_auto: true, kill_switch_source: "ai_spend_cap", kill_switch_at: "2026-08-20T10:00:00Z" }, "2026-08-21"));
});

Deno.test("shouldClearAutoSpendTrip: a manual (non-auto) kill switch is never auto-cleared", () => {
  assertFalse(shouldClearAutoSpendTrip({ kill_switch: true, kill_switch_auto: false, kill_switch_source: "ai_spend_cap", kill_switch_at: "2026-08-20T10:00:00Z" }, "2026-08-21"));
});

Deno.test("shouldClearAutoSpendTrip: auto-tripped but by something other than the spend cap is never cleared here", () => {
  assertFalse(shouldClearAutoSpendTrip({ kill_switch: true, kill_switch_auto: true, kill_switch_source: "manual_admin", kill_switch_at: "2026-08-20T10:00:00Z" }, "2026-08-21"));
});

Deno.test("shouldClearAutoSpendTrip: tripped today (same UTC day) is NOT cleared", () => {
  assertFalse(shouldClearAutoSpendTrip({ kill_switch: true, kill_switch_auto: true, kill_switch_source: "ai_spend_cap", kill_switch_at: "2026-08-21T23:59:00Z" }, "2026-08-21"));
});

Deno.test("shouldClearAutoSpendTrip: tripped on a previous UTC day IS cleared", () => {
  assert(shouldClearAutoSpendTrip({ kill_switch: true, kill_switch_auto: true, kill_switch_source: "ai_spend_cap", kill_switch_at: "2026-08-20T10:00:00Z" }, "2026-08-21"));
});

Deno.test("shouldClearAutoSpendTrip: missing kill_switch_at is treated as not-today -> cleared", () => {
  assert(shouldClearAutoSpendTrip({ kill_switch: true, kill_switch_auto: true, kill_switch_source: "ai_spend_cap", kill_switch_at: null }, "2026-08-21"));
});

// ---- getSpendStatus (account-wide) -----------------------------------------

Deno.test("getSpendStatus: no cap row configured falls back to the $5 default, not over cap", async () => {
  const client = fakeSupabase({
    ai_spend_daily: { data: { cost_usd: 1, calls: 2 }, error: null },
  });
  const status = await getSpendStatus(client, "user-1");
  assertEquals(status.cap_usd, 5);
  assertFalse(status.over_cap);
});

Deno.test("getSpendStatus: spend at or above the cap is over_cap", async () => {
  const client = fakeSupabase({
    ai_spend_caps: { data: { daily_cap_usd: 5, enabled: true }, error: null },
    ai_spend_daily: { data: { cost_usd: 5.5, calls: 40 }, error: null },
  });
  const status = await getSpendStatus(client, "user-1");
  assert(status.over_cap);
});

Deno.test("getSpendStatus: a disabled cap is never over_cap regardless of spend", async () => {
  const client = fakeSupabase({
    ai_spend_caps: { data: { daily_cap_usd: 5, enabled: false }, error: null },
    ai_spend_daily: { data: { cost_usd: 999, calls: 500 }, error: null },
  });
  const status = await getSpendStatus(client, "user-1");
  assertFalse(status.over_cap);
});

// ---- getAgentSpendStatus (per-agent, new) ----------------------------------

Deno.test("getAgentSpendStatus: an agent with no cap row of its own has has_cap=false and is never over_cap", async () => {
  const client = fakeSupabase({
    ai_spend_caps: { data: null, error: null },
  });
  const status = await getAgentSpendStatus(client, "user-1", "agent-1");
  assertFalse(status.has_cap);
  assertFalse(status.over_cap);
});

Deno.test("getAgentSpendStatus: an agent with its own cap configured and spend over it is over_cap", async () => {
  const client = fakeSupabase({
    ai_spend_caps: { data: { daily_cap_usd: 2, enabled: true }, error: null },
    ai_spend_daily: { data: { cost_usd: 2.5, calls: 10 }, error: null },
  });
  const status = await getAgentSpendStatus(client, "user-1", "agent-1");
  assert(status.has_cap);
  assert(status.over_cap);
});

Deno.test("getAgentSpendStatus: an agent with its own cap but under spend is not over_cap", async () => {
  const client = fakeSupabase({
    ai_spend_caps: { data: { daily_cap_usd: 2, enabled: true }, error: null },
    ai_spend_daily: { data: { cost_usd: 0.5, calls: 3 }, error: null },
  });
  const status = await getAgentSpendStatus(client, "user-1", "agent-1");
  assert(status.has_cap);
  assertFalse(status.over_cap);
});

// ---- recordAiSpend's kill-switch-trip logging (regression: this insert
// bypassed logStop/logDecision entirely and never checked for a
// decision_logged webhook subscriber, unlike every other decision-logging
// chokepoint) -----------------------------------------------------------

class RichFakeQuery implements PromiseLike<Row> {
  filters: Record<string, unknown> = {};
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq(col: string, val: unknown) { this.filters[col] = val; return this; }
  is(col: string, val: unknown) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  insert(_row?: unknown) { return this; }
  update(_row?: unknown) { return this; }
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

function fakeSupabaseWithCalls(tables: Record<string, Row> = {}) {
  const calls: { table: string }[] = [];
  const client = {
    from(table: string) {
      calls.push({ table });
      return new RichFakeQuery(() => tables[table] ?? { data: null, error: null });
    },
    rpc(_name: string) {
      return new RichFakeQuery(() => ({ data: null, error: null }));
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, calls };
}

Deno.test("recordAiSpend: tripping the account-wide kill switch checks for a decision_logged webhook subscriber", async () => {
  const { client, calls } = fakeSupabaseWithCalls({
    ai_spend_caps: { data: { daily_cap_usd: 5, enabled: true }, error: null },
    ai_spend_daily: { data: { id: "d1", cost_usd: 10, calls: 40, warned_at: null, capped_at: null }, error: null },
    agent_decisions: { data: { id: "decision-1" }, error: null },
  });
  await recordAiSpend(client, "user-1", "openai/gpt-5-mini", { prompt_tokens: 100, completion_tokens: 100 }, "test", null);
  assert(calls.some((c) => c.table === "webhooks"), "expected the kill-switch trip to check for a decision_logged webhook subscriber");
});
