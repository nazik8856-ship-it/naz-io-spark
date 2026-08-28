// Real tests for the per-action-type on_uncertain override resolver.
//
// Run with: deno test --allow-none supabase/functions/_shared/action-type-policy_test.ts
import { matchesActionTypePattern, resolveEffectiveOnUncertain, resolveEffectiveConfidenceThreshold, type ActionTypeOverride } from "./action-type-policy.ts";

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

// ---- matchesActionTypePattern ----

Deno.test("matchesActionTypePattern: an exact match with no wildcard matches only that action_type", () => {
  assert(matchesActionTypePattern("send_email", "send_email"));
  assertFalse(matchesActionTypePattern("send_email", "delete_record"));
});

Deno.test("matchesActionTypePattern: a wildcard prefix matches every action_type sharing that prefix", () => {
  assert(matchesActionTypePattern("delete_*", "delete_record"));
  assert(matchesActionTypePattern("delete_*", "delete_user"));
  assertFalse(matchesActionTypePattern("delete_*", "send_email"));
});

Deno.test("matchesActionTypePattern: a bare '*' matches everything", () => {
  assert(matchesActionTypePattern("*", "anything_at_all"));
});

Deno.test("matchesActionTypePattern: matching is case-insensitive", () => {
  assert(matchesActionTypePattern("Send_Email", "send_email"));
});

Deno.test("matchesActionTypePattern: an invalid pattern never matches, never throws", () => {
  assertFalse(matchesActionTypePattern("[", "anything"));
});

// ---- resolveEffectiveOnUncertain ----

const override = (over: Partial<ActionTypeOverride> = {}): ActionTypeOverride => ({
  action_type_pattern: "delete_*",
  on_uncertain: "human_review",
  ...over,
});

Deno.test("resolveEffectiveOnUncertain: no overrides at all falls back to the blanket policy", () => {
  const result = resolveEffectiveOnUncertain("auto_allow", "send_email", []);
  assertEquals(result, { policy: "auto_allow", matchedOverride: null });
});

Deno.test("resolveEffectiveOnUncertain: a matching override replaces the blanket policy for this decision", () => {
  const overrides = [override({ action_type_pattern: "delete_*", on_uncertain: "human_review" })];
  const result = resolveEffectiveOnUncertain("auto_allow", "delete_record", overrides);
  assertEquals(result.policy, "human_review");
  assertEquals(result.matchedOverride, overrides[0]);
});

Deno.test("resolveEffectiveOnUncertain: an override that doesn't match this action_type leaves the blanket policy untouched", () => {
  const overrides = [override({ action_type_pattern: "delete_*", on_uncertain: "human_review" })];
  const result = resolveEffectiveOnUncertain("auto_allow", "send_email", overrides);
  assertEquals(result, { policy: "auto_allow", matchedOverride: null });
});

Deno.test("resolveEffectiveOnUncertain: a null blanket policy with no matching override still returns null, not a guess", () => {
  const result = resolveEffectiveOnUncertain(null, "send_email", [override({ action_type_pattern: "delete_*" })]);
  assertEquals(result, { policy: null, matchedOverride: null });
});

Deno.test("resolveEffectiveOnUncertain: when two overrides could both match, the first one given (oldest) wins", () => {
  const overrides = [
    override({ action_type_pattern: "delete_*", on_uncertain: "human_review" }),
    override({ action_type_pattern: "*", on_uncertain: "auto_allow" }),
  ];
  const result = resolveEffectiveOnUncertain("auto_deny", "delete_record", overrides);
  assertEquals(result.policy, "human_review");
});

Deno.test("resolveEffectiveOnUncertain: an exact-action-type override applies only to that one action_type, blanket governs the rest", () => {
  const overrides = [override({ action_type_pattern: "delete_record", on_uncertain: "human_review" })];
  assertEquals(resolveEffectiveOnUncertain("auto_allow", "delete_record", overrides).policy, "human_review");
  assertEquals(resolveEffectiveOnUncertain("auto_allow", "delete_user", overrides).policy, "auto_allow");
});

// ---- resolveEffectiveConfidenceThreshold ("knowledge & autonomy" item 9) ----

Deno.test("resolveEffectiveConfidenceThreshold: no overrides at all falls back to the blanket threshold", () => {
  const result = resolveEffectiveConfidenceThreshold(60, "send_email", []);
  assertEquals(result, { threshold: 60, matchedOverride: null });
});

Deno.test("resolveEffectiveConfidenceThreshold: a matching override with a threshold replaces the blanket threshold", () => {
  const overrides = [override({ action_type_pattern: "delete_*", confidence_threshold: 85 })];
  const result = resolveEffectiveConfidenceThreshold(60, "delete_record", overrides);
  assertEquals(result.threshold, 85);
  assertEquals(result.matchedOverride, overrides[0]);
});

Deno.test("resolveEffectiveConfidenceThreshold: an override matching this action_type but with no threshold set is skipped, not treated as zero", () => {
  const overrides = [override({ action_type_pattern: "delete_*", on_uncertain: "human_review", confidence_threshold: null })];
  const result = resolveEffectiveConfidenceThreshold(60, "delete_record", overrides);
  assertEquals(result, { threshold: 60, matchedOverride: null });
});

Deno.test("resolveEffectiveConfidenceThreshold: an override that doesn't match this action_type leaves the blanket threshold untouched", () => {
  const overrides = [override({ action_type_pattern: "delete_*", confidence_threshold: 85 })];
  const result = resolveEffectiveConfidenceThreshold(60, "send_email", overrides);
  assertEquals(result, { threshold: 60, matchedOverride: null });
});

Deno.test("resolveEffectiveConfidenceThreshold: when two overrides could both match, the first one with a real threshold set wins", () => {
  const overrides = [
    override({ action_type_pattern: "delete_*", confidence_threshold: null }),
    override({ action_type_pattern: "*", confidence_threshold: 40 }),
  ];
  // The first row matches the pattern but carries no threshold override of
  // its own -- resolution must skip past it to the next real match, not
  // stop at the first PATTERN match regardless of whether it set one.
  const result = resolveEffectiveConfidenceThreshold(60, "delete_record", overrides);
  assertEquals(result.threshold, 40);
});

Deno.test("resolveEffectiveConfidenceThreshold: a threshold of exactly 0 is honored, not treated as unset", () => {
  const overrides = [override({ action_type_pattern: "delete_*", confidence_threshold: 0 })];
  const result = resolveEffectiveConfidenceThreshold(60, "delete_record", overrides);
  assertEquals(result.threshold, 0);
});
