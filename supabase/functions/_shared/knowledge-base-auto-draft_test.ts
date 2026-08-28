// Real tests for the recurring-override-reason knowledge-base drafter.
//
// Run with: deno test --allow-none supabase/functions/_shared/knowledge-base-auto-draft_test.ts
import {
  detectRecurringReasonPatterns,
  draftKnowledgeBaseEntryFromPattern,
  MIN_SAMPLE_FOR_KB_AUTO_DRAFT,
  type ReasonCodedResolution,
} from "./knowledge-base-auto-draft.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (over: Partial<ReasonCodedResolution> = {}): ReasonCodedResolution => ({
  action_type: "send_email",
  provider: "Gmail",
  reason_code: "missing_context",
  ...over,
});

// ---- detectRecurringReasonPatterns ----

Deno.test("detectRecurringReasonPatterns: a sample below the threshold is not a pattern", () => {
  const rows = Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT - 1 }, () => row());
  assertEquals(detectRecurringReasonPatterns(rows), []);
});

Deno.test("detectRecurringReasonPatterns: a sample exactly at the threshold counts as a pattern", () => {
  const rows = Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT }, () => row());
  const patterns = detectRecurringReasonPatterns(rows);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0], { action_type: "send_email", provider: "Gmail", reason_code: "missing_context", sample_size: MIN_SAMPLE_FOR_KB_AUTO_DRAFT });
});

Deno.test("detectRecurringReasonPatterns: different reason codes for the same shape are counted separately", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT }, () => row({ reason_code: "missing_context" })),
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT - 1 }, () => row({ reason_code: "policy_too_strict" })),
  ];
  const patterns = detectRecurringReasonPatterns(rows);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].reason_code, "missing_context");
});

Deno.test("detectRecurringReasonPatterns: rows with no reason_code or an unrecognized one are ignored", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT + 5 }, () => row({ reason_code: null })),
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT + 5 }, () => row({ reason_code: "not_a_real_code" })),
  ];
  assertEquals(detectRecurringReasonPatterns(rows), []);
});

Deno.test("detectRecurringReasonPatterns: a null provider is its own distinct group", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT }, () => row({ provider: null })),
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT }, () => row({ provider: "Gmail" })),
  ];
  assertEquals(detectRecurringReasonPatterns(rows).length, 2);
});

Deno.test("detectRecurringReasonPatterns: multiple qualifying patterns are sorted largest sample first", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT }, () => row({ action_type: "send_email" })),
    ...Array.from({ length: MIN_SAMPLE_FOR_KB_AUTO_DRAFT + 10 }, () => row({ action_type: "delete_record" })),
  ];
  const patterns = detectRecurringReasonPatterns(rows);
  assertEquals(patterns[0].action_type, "delete_record");
  assertEquals(patterns[1].action_type, "send_email");
});

// ---- draftKnowledgeBaseEntryFromPattern ----

Deno.test("draftKnowledgeBaseEntryFromPattern: builds a disabled, pending-review, auto-drafted entry", () => {
  const draft = draftKnowledgeBaseEntryFromPattern({
    action_type: "send_email", provider: "Gmail", reason_code: "missing_context", sample_size: 7,
  });
  assertEquals(draft.enabled, false);
  assertEquals(draft.pending_review, true);
  assertEquals(draft.auto_drafted, true);
  assertEquals(draft.action_type_pattern, "send_email");
  assertEquals(draft.provider, "Gmail");
  assert(draft.entry_text.includes("7"));
  assert(draft.entry_text.toLowerCase().includes("missing context"));
});

Deno.test("draftKnowledgeBaseEntryFromPattern: a null provider is described without an 'on' clause", () => {
  const draft = draftKnowledgeBaseEntryFromPattern({
    action_type: "send_email", provider: null, reason_code: "one_off_exception", sample_size: 5,
  });
  assert(!draft.entry_text.includes(" on "));
});
