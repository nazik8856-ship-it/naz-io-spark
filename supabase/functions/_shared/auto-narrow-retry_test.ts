// Real tests for the auto_narrow "smarter second attempt" pure logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/auto-narrow-retry_test.ts
import { buildSecondNarrowingAttempt, secondNarrowingResolution, type NarrowingFailureReason } from "./auto-narrow-retry.ts";
import type { SafetyMatch } from "./safety-scanner.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const match = (over: Partial<SafetyMatch> = {}): SafetyMatch => ({
  rule_id: "builtin:mass_audience",
  name: "Mass-audience send",
  category: "reach",
  severity: "require_approval",
  pattern: "all",
  matched_on: "audience",
  sample: "all customers",
  ...over,
});

// ---- buildSecondNarrowingAttempt ----

Deno.test("buildSecondNarrowingAttempt: a hard-rule failure has nothing to remove, returns null", () => {
  const reason: NarrowingFailureReason = { kind: "hard_rule" };
  assertEquals(buildSecondNarrowingAttempt({ audience: "all" }, reason), null);
});

Deno.test("buildSecondNarrowingAttempt: a precedent-based rejection has nothing to remove, returns null", () => {
  const reason: NarrowingFailureReason = { kind: "precedent" };
  assertEquals(buildSecondNarrowingAttempt({ audience: "all" }, reason), null);
});

Deno.test("buildSecondNarrowingAttempt: a safety-scanner match on a real top-level field removes exactly that field", () => {
  const reason: NarrowingFailureReason = { kind: "safety_scanner", matches: [match({ matched_on: "audience" })] };
  const result = buildSecondNarrowingAttempt({ audience: "all customers", subject: "Hello" }, reason);
  assertEquals(result, { subject: "Hello" });
});

Deno.test("buildSecondNarrowingAttempt: a match on 'description' alone is not a real params field, returns null", () => {
  const reason: NarrowingFailureReason = { kind: "safety_scanner", matches: [match({ matched_on: "description" })] };
  assertEquals(buildSecondNarrowingAttempt({ audience: "some" }, reason), null);
});

Deno.test("buildSecondNarrowingAttempt: a nested (dotted) matched field is not removed, returns null", () => {
  const reason: NarrowingFailureReason = { kind: "safety_scanner", matches: [match({ matched_on: "recipient.email" })] };
  assertEquals(buildSecondNarrowingAttempt({ recipient: { email: "x@mailinator.com" } }, reason), null);
});

Deno.test("buildSecondNarrowingAttempt: a matched field that isn't actually present on these params returns null", () => {
  const reason: NarrowingFailureReason = { kind: "safety_scanner", matches: [match({ matched_on: "audience" })] };
  assertEquals(buildSecondNarrowingAttempt({ subject: "Hello" }, reason), null);
});

Deno.test("buildSecondNarrowingAttempt: multiple distinct matched fields are all removed", () => {
  const reason: NarrowingFailureReason = {
    kind: "safety_scanner",
    matches: [match({ matched_on: "audience" }), match({ matched_on: "body", rule_id: "builtin:destructive" })],
  };
  const result = buildSecondNarrowingAttempt({ audience: "all", body: "delete all", subject: "Hi" }, reason);
  assertEquals(result, { subject: "Hi" });
});

Deno.test("buildSecondNarrowingAttempt: duplicate matches on the same field only remove it once, no error", () => {
  const reason: NarrowingFailureReason = {
    kind: "safety_scanner",
    matches: [match({ matched_on: "audience" }), match({ matched_on: "audience", rule_id: "other" })],
  };
  const result = buildSecondNarrowingAttempt({ audience: "all", subject: "Hi" }, reason);
  assertEquals(result, { subject: "Hi" });
});

// ---- secondNarrowingResolution ----

Deno.test("secondNarrowingResolution: a clean pass on the stricter attempt approves and names the removed fields", () => {
  const result = secondNarrowingResolution("pass_through", ["audience"]);
  assertEquals(result.resolution, "approved");
  assertEquals(result.removed_fields, ["audience"]);
  if (!result.note.includes("audience")) throw new Error("note should mention the removed field");
  if (!result.note.toLowerCase().includes("second")) throw new Error("note should identify this as the second attempt");
});

Deno.test("secondNarrowingResolution: a require_approval outcome on the stricter attempt still rejects, never a blind allow", () => {
  const result = secondNarrowingResolution("require_approval", ["audience"]);
  assertEquals(result.resolution, "rejected");
});

Deno.test("secondNarrowingResolution: a block outcome on the stricter attempt rejects", () => {
  const result = secondNarrowingResolution("block", ["audience", "body"]);
  assertEquals(result.resolution, "rejected");
  if (!result.note.includes("audience, body")) throw new Error("note should list every removed field");
});
