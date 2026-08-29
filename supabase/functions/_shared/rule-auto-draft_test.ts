// Real tests for the recurring-block-pattern rule auto-drafter.
//
// Run with: deno test --allow-none supabase/functions/_shared/rule-auto-draft_test.ts
import { detectRecurringBlockPatterns, draftRuleFromPattern, MIN_SAMPLE_FOR_AUTO_DRAFT, type DecisionRow } from "./rule-auto-draft.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (over: Partial<DecisionRow> = {}): DecisionRow => ({ action_type: "delete_record", provider: "Notion", ...over });

// ---- detectRecurringBlockPatterns ----

Deno.test("detectRecurringBlockPatterns: a sample below the threshold is not a pattern", () => {
  const rows = Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT - 1 }, () => row());
  assertEquals(detectRecurringBlockPatterns(rows), []);
});

Deno.test("detectRecurringBlockPatterns: a sample exactly at the threshold counts as a pattern", () => {
  const rows = Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT }, () => row());
  const patterns = detectRecurringBlockPatterns(rows);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0], { action_type: "delete_record", provider: "Notion", sample_size: MIN_SAMPLE_FOR_AUTO_DRAFT });
});

Deno.test("detectRecurringBlockPatterns: different action_type/provider shapes are counted separately", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT }, () => row({ action_type: "delete_record", provider: "Notion" })),
    ...Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT - 1 }, () => row({ action_type: "send_email", provider: "Gmail" })),
  ];
  const patterns = detectRecurringBlockPatterns(rows);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].action_type, "delete_record");
});

Deno.test("detectRecurringBlockPatterns: a null provider is its own distinct group, not merged with a real provider", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT }, () => row({ provider: null })),
    ...Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT }, () => row({ provider: "Notion" })),
  ];
  const patterns = detectRecurringBlockPatterns(rows);
  assertEquals(patterns.length, 2);
});

Deno.test("detectRecurringBlockPatterns: rows with a blank action_type are ignored, never grouped under an empty key", () => {
  const rows = Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT + 5 }, () => row({ action_type: "" }));
  assertEquals(detectRecurringBlockPatterns(rows), []);
});

Deno.test("detectRecurringBlockPatterns: multiple qualifying patterns are sorted largest sample first", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT }, () => row({ action_type: "delete_record", provider: "Notion" })),
    ...Array.from({ length: MIN_SAMPLE_FOR_AUTO_DRAFT + 20 }, () => row({ action_type: "send_email", provider: "Gmail" })),
  ];
  const patterns = detectRecurringBlockPatterns(rows);
  assertEquals(patterns.length, 2);
  assertEquals(patterns[0].action_type, "send_email");
  assertEquals(patterns[1].action_type, "delete_record");
});

Deno.test("detectRecurringBlockPatterns: a custom minSample threshold is honored", () => {
  const rows = Array.from({ length: 3 }, () => row());
  assertEquals(detectRecurringBlockPatterns(rows, 3).length, 1);
  assertEquals(detectRecurringBlockPatterns(rows, 4).length, 0);
});

// ---- draftRuleFromPattern ----

Deno.test("draftRuleFromPattern: builds a shadow-mode always_block rule naming the exact sample size", () => {
  const draft = draftRuleFromPattern({ action_type: "delete_record", provider: "Notion", sample_size: 14 });
  assertEquals(draft.effect, "always_block");
  assertEquals(draft.shadow_mode, true);
  assertEquals(draft.action_type_pattern, "delete_record");
  assertEquals(draft.provider, "Notion");
  assert(draft.rationale.includes("14"));
  assert(draft.rule_text.includes("delete_record"));
});

Deno.test("draftRuleFromPattern: a null provider is described without an 'on' clause", () => {
  const draft = draftRuleFromPattern({ action_type: "delete_record", provider: null, sample_size: 12 });
  assertEquals(draft.provider, null);
  assert(!draft.rule_text.includes(" on "));
  assert(!draft.rationale.includes(" on "));
});
