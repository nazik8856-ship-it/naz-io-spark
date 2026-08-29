// Real tests for opt-in coarse cross-account precedent sharing.
//
// Run with: deno test --allow-none supabase/functions/_shared/cross-account-precedent_test.ts
import {
  aggregateCrossAccountStats,
  evaluateCoarsePrecedentLookup,
  summarizeCoarsePrecedentLookup,
  MIN_CONTRIBUTING_ACCOUNTS,
  MIN_TOTAL_SAMPLE,
  type CrossAccountDecisionRow,
  type CrossAccountStat,
} from "./cross-account-precedent.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (over: Partial<CrossAccountDecisionRow> = {}): CrossAccountDecisionRow => ({
  user_id: "account-1",
  action_type: "send_email",
  provider: "Gmail",
  decision: "ALLOW send it",
  ...over,
});

// ---- aggregateCrossAccountStats ----

Deno.test("aggregateCrossAccountStats: groups by exact (action_type, provider) shape", () => {
  const stats = aggregateCrossAccountStats([
    row({ action_type: "send_email", provider: "Gmail" }),
    row({ action_type: "delete_record", provider: "Notion" }),
  ]);
  assertEquals(stats.length, 2);
});

Deno.test("aggregateCrossAccountStats: counts non-allow decisions correctly", () => {
  const stats = aggregateCrossAccountStats([
    row({ decision: "ALLOW send it" }),
    row({ decision: "BLOCK too risky", user_id: "account-2" }),
    row({ decision: "MODIFY narrow it", user_id: "account-3" }),
  ]);
  assertEquals(stats[0].total_count, 3);
  assertEquals(stats[0].non_allow_count, 2);
});

Deno.test("aggregateCrossAccountStats: contributing_account_count is a DISTINCT count of accounts, not total decisions", () => {
  const stats = aggregateCrossAccountStats([
    row({ user_id: "account-1" }),
    row({ user_id: "account-1" }),
    row({ user_id: "account-2" }),
  ]);
  assertEquals(stats[0].total_count, 3);
  assertEquals(stats[0].contributing_account_count, 2);
});

Deno.test("aggregateCrossAccountStats: a null provider is its own distinct group", () => {
  const stats = aggregateCrossAccountStats([row({ provider: null }), row({ provider: "Gmail" })]);
  assertEquals(stats.length, 2);
});

Deno.test("aggregateCrossAccountStats: rows with a blank action_type or missing user_id are ignored", () => {
  const stats = aggregateCrossAccountStats([row({ action_type: "" }), row({ user_id: "" })]);
  assertEquals(stats, []);
});

// ---- evaluateCoarsePrecedentLookup ----

const stat = (over: Partial<CrossAccountStat> = {}): CrossAccountStat => ({
  action_type: "send_email",
  provider: "Gmail",
  total_count: 10,
  non_allow_count: 3,
  contributing_account_count: 3,
  ...over,
});

Deno.test("evaluateCoarsePrecedentLookup: no stat at all is unavailable with reason no_data", () => {
  assertEquals(evaluateCoarsePrecedentLookup(null), { available: false, reason: "no_data" });
});

Deno.test("evaluateCoarsePrecedentLookup: below MIN_CONTRIBUTING_ACCOUNTS is unavailable, even with plenty of volume", () => {
  const result = evaluateCoarsePrecedentLookup(stat({ contributing_account_count: MIN_CONTRIBUTING_ACCOUNTS - 1, total_count: 1000 }));
  assertEquals(result, { available: false, reason: "too_few_contributing_accounts" });
});

Deno.test("evaluateCoarsePrecedentLookup: enough accounts but too small a sample is unavailable", () => {
  const result = evaluateCoarsePrecedentLookup(stat({ contributing_account_count: MIN_CONTRIBUTING_ACCOUNTS, total_count: MIN_TOTAL_SAMPLE - 1 }));
  assertEquals(result, { available: false, reason: "too_small_sample" });
});

Deno.test("evaluateCoarsePrecedentLookup: enough accounts and enough sample returns the real share", () => {
  const result = evaluateCoarsePrecedentLookup(stat({ contributing_account_count: 4, total_count: 20, non_allow_count: 5 }));
  assertEquals(result, { available: true, nonAllowShare: 0.25, totalCount: 20, contributingAccountCount: 4 });
});

// ---- summarizeCoarsePrecedentLookup ----

Deno.test("summarizeCoarsePrecedentLookup: an available result names the real share, sample, and account count", () => {
  const text = summarizeCoarsePrecedentLookup({ available: true, nonAllowShare: 0.4, totalCount: 25, contributingAccountCount: 5 }, "send_email", "Gmail");
  assert(text.includes("40%"));
  assert(text.includes("25"));
  assert(text.includes("5 opted-in"));
  assert(text.includes("send_email on Gmail"));
});

Deno.test("summarizeCoarsePrecedentLookup: a too-few-accounts result never implies real numbers exist", () => {
  const text = summarizeCoarsePrecedentLookup({ available: false, reason: "too_few_contributing_accounts" }, "delete_record", null);
  assert(text.toLowerCase().includes("not enough"));
  assert(!text.includes("%"));
});

Deno.test("summarizeCoarsePrecedentLookup: a null provider is described without an 'on' clause", () => {
  const text = summarizeCoarsePrecedentLookup({ available: false, reason: "no_data" }, "delete_record", null);
  assert(!text.includes(" on "));
});
