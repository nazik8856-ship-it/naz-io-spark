// Real tests for seedStarterHardRuleIfNone (LOOP 2, 2026-10-10).
// Run with: deno test supabase/functions/_shared/starter-rules_test.ts
import { seedStarterHardRuleIfNone } from "./starter-rules.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Minimal fake chainable client: tracks every row ever inserted into
// hard_rules, and answers a count query filtered by agent_id/api_key_id
// from a seeded starting set.
function fakeAdmin(existingHardRules: { agent_id: string | null; api_key_id: string | null }[]) {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      assert(table === "hard_rules", `unexpected table ${table}`);
      const filters: { col: string; val: unknown }[] = [];
      const builder = {
        select(_cols: string, _opts?: unknown) { return builder; },
        eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
        insert(row: Record<string, unknown>) { inserted.push(row); return Promise.resolve({ data: null, error: null }); },
        then(resolve: (v: { count: number }) => void) {
          // Fixtures below only model agent_id/api_key_id -- user_id scoping
          // is exercised separately by every other _shared test's own fake
          // admin, so it's deliberately not re-modeled here.
          const rows = existingHardRules.filter((r) =>
            filters.filter((f) => f.col !== "user_id").every((f) => (r as Record<string, unknown>)[f.col] === f.val),
          );
          resolve({ count: rows.length });
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof seedStarterHardRuleIfNone>[0];
  return { admin, inserted };
}

Deno.test("agent with zero hard_rules gets exactly one starter rule", async () => {
  const { admin, inserted } = fakeAdmin([]);
  await seedStarterHardRuleIfNone(admin, "u1", { agentId: "a1" });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].agent_id, "a1");
  assertEquals(inserted[0].api_key_id, null);
  assertEquals(inserted[0].effect, "always_require_approval");
  assertEquals(inserted[0].enabled, true);
});

Deno.test("agent that already has a hard_rule (e.g. from guardrail reconciliation) gets nothing extra", async () => {
  const { admin, inserted } = fakeAdmin([{ agent_id: "a1", api_key_id: null }]);
  await seedStarterHardRuleIfNone(admin, "u1", { agentId: "a1" });
  assertEquals(inserted.length, 0);
});

Deno.test("a different agent's existing rule never blocks seeding for this agent", async () => {
  const { admin, inserted } = fakeAdmin([{ agent_id: "a2", api_key_id: null }]);
  await seedStarterHardRuleIfNone(admin, "u1", { agentId: "a1" });
  assertEquals(inserted.length, 1);
});

Deno.test("brand-new API key with zero hard_rules gets exactly one starter rule", async () => {
  const { admin, inserted } = fakeAdmin([]);
  await seedStarterHardRuleIfNone(admin, "u1", { apiKeyId: "k1" });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].api_key_id, "k1");
  assertEquals(inserted[0].agent_id, null);
  assert((inserted[0].rule_text as string).includes("this key"));
});

Deno.test("API key that already has a hard_rule gets nothing extra (idempotent)", async () => {
  const { admin, inserted } = fakeAdmin([{ agent_id: null, api_key_id: "k1" }]);
  await seedStarterHardRuleIfNone(admin, "u1", { apiKeyId: "k1" });
  assertEquals(inserted.length, 0);
});

Deno.test("neither agentId nor apiKeyId -- never seeds an account-wide rule", async () => {
  const { admin, inserted } = fakeAdmin([]);
  await seedStarterHardRuleIfNone(admin, "u1", {});
  assertEquals(inserted.length, 0);
});

Deno.test("a DB error on the count query never throws -- best-effort, same posture as reconcileGuardrailsToHardRules", async () => {
  const throwingAdmin = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        then() { throw new Error("db unreachable"); },
      };
    },
  } as unknown as Parameters<typeof seedStarterHardRuleIfNone>[0];
  await seedStarterHardRuleIfNone(throwingAdmin, "u1", { agentId: "a1" }); // must not throw
});
