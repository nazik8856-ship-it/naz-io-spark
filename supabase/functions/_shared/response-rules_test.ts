// Real tests for the response-rules tier of /respond's two-tier pipeline
// (item 177).
//
// Run with: deno test --allow-none supabase/functions/_shared/response-rules_test.ts
import { findMatchingRule, isValidTriggerPhrase, isValidRuleAnswer, isValidMatchType, type ResponseRule } from "./response-rules.ts";

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

// ---- findMatchingRule ----

Deno.test("findMatchingRule: no rules at all returns null", () => {
  assertEquals(findMatchingRule([], "How do I cancel?"), null);
});

Deno.test("findMatchingRule: contains_phrase matches anywhere in the message, case/whitespace-insensitive", () => {
  const rules: ResponseRule[] = [{ id: "r1", trigger_phrase: "cancel", match_type: "contains_phrase", answer_text: "Cancellation policy: ..." }];
  const match = findMatchingRule(rules, "Hi, I'd like to   CANCEL my subscription please.");
  assertEquals(match?.id, "r1");
});

Deno.test("findMatchingRule: exact_phrase requires the whole normalized message to equal the trigger", () => {
  const rules: ResponseRule[] = [{ id: "r1", trigger_phrase: "what are your hours?", match_type: "exact_phrase", answer_text: "9-5 ET." }];
  assertEquals(findMatchingRule(rules, "  What Are Your Hours?  ")?.id, "r1");
  assertEquals(findMatchingRule(rules, "what are your hours today?"), null);
});

Deno.test("findMatchingRule: the FIRST matching rule wins when several would match", () => {
  const rules: ResponseRule[] = [
    { id: "first", trigger_phrase: "cancel", match_type: "contains_phrase", answer_text: "General cancellation info." },
    { id: "second", trigger_phrase: "cancel my subscription", match_type: "contains_phrase", answer_text: "Subscription-specific info." },
  ];
  assertEquals(findMatchingRule(rules, "I want to cancel my subscription")?.id, "first");
});

Deno.test("findMatchingRule: an empty or whitespace-only message never matches anything", () => {
  const rules: ResponseRule[] = [{ id: "r1", trigger_phrase: "cancel", match_type: "contains_phrase", answer_text: "..." }];
  assertEquals(findMatchingRule(rules, "   "), null);
});

Deno.test("findMatchingRule: a rule with a blank trigger_phrase is skipped, never matches everything", () => {
  const rules: ResponseRule[] = [{ id: "r1", trigger_phrase: "   ", match_type: "contains_phrase", answer_text: "..." }];
  assertEquals(findMatchingRule(rules, "anything at all"), null);
});

// ---- isValidTriggerPhrase ----

Deno.test("isValidTriggerPhrase: rejects empty, whitespace-only, and oversized", () => {
  assertFalse(isValidTriggerPhrase(""));
  assertFalse(isValidTriggerPhrase("   "));
  assertFalse(isValidTriggerPhrase("x".repeat(501)));
});

Deno.test("isValidTriggerPhrase: accepts a reasonable phrase, rejects non-strings", () => {
  assert(isValidTriggerPhrase("cancel my subscription"));
  assertFalse(isValidTriggerPhrase(42));
  assertFalse(isValidTriggerPhrase(null));
});

// ---- isValidRuleAnswer ----

Deno.test("isValidRuleAnswer: rejects empty, whitespace-only, and oversized", () => {
  assertFalse(isValidRuleAnswer(""));
  assertFalse(isValidRuleAnswer("   "));
  assertFalse(isValidRuleAnswer("x".repeat(2001)));
});

Deno.test("isValidRuleAnswer: accepts a reasonable answer", () => {
  assert(isValidRuleAnswer("You can cancel any time from Settings > Billing."));
});

// ---- isValidMatchType ----

Deno.test("isValidMatchType: accepts exactly the two known values", () => {
  assert(isValidMatchType("exact_phrase"));
  assert(isValidMatchType("contains_phrase"));
});

Deno.test("isValidMatchType: rejects anything else", () => {
  assertFalse(isValidMatchType("fuzzy"));
  assertFalse(isValidMatchType(undefined));
  assertFalse(isValidMatchType(""));
});
