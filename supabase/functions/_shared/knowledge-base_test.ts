// Real tests for the account knowledge-base matching/prompt logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/knowledge-base_test.ts
import {
  matchesKnowledgeBaseEntry,
  selectRelevantKnowledgeBaseEntries,
  buildKnowledgeBasePromptBlock,
  type KnowledgeBaseEntry,
} from "./knowledge-base.ts";

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

const entry = (over: Partial<KnowledgeBaseEntry> = {}): KnowledgeBaseEntry => ({
  id: "kb-1",
  entry_text: "Our refund policy is 30 days.",
  action_type_pattern: null,
  provider: null,
  ...over,
});

// ---- matchesKnowledgeBaseEntry ----

Deno.test("matchesKnowledgeBaseEntry: a fully unscoped entry (null pattern, null provider) matches everything", () => {
  assert(matchesKnowledgeBaseEntry(entry(), "send_email", "Gmail"));
  assert(matchesKnowledgeBaseEntry(entry(), "delete_record", "Notion"));
});

Deno.test("matchesKnowledgeBaseEntry: an action_type_pattern scope only matches that shape", () => {
  const e = entry({ action_type_pattern: "refund_*" });
  assert(matchesKnowledgeBaseEntry(e, "refund_order", "Stripe"));
  assertFalse(matchesKnowledgeBaseEntry(e, "send_email", "Gmail"));
});

Deno.test("matchesKnowledgeBaseEntry: a provider scope only matches that provider, case-insensitively", () => {
  const e = entry({ provider: "gmail" });
  assert(matchesKnowledgeBaseEntry(e, "send_email", "Gmail"));
  assertFalse(matchesKnowledgeBaseEntry(e, "send_email", "Slack"));
});

Deno.test("matchesKnowledgeBaseEntry: both scopes must match when both are set", () => {
  const e = entry({ action_type_pattern: "send_email", provider: "Gmail" });
  assert(matchesKnowledgeBaseEntry(e, "send_email", "Gmail"));
  assertFalse(matchesKnowledgeBaseEntry(e, "send_email", "Slack"));
  assertFalse(matchesKnowledgeBaseEntry(e, "delete_record", "Gmail"));
});

// ---- selectRelevantKnowledgeBaseEntries ----

Deno.test("selectRelevantKnowledgeBaseEntries: filters down to only the matching entries", () => {
  const entries = [
    entry({ id: "a", action_type_pattern: "send_email" }),
    entry({ id: "b", action_type_pattern: "delete_record" }),
    entry({ id: "c" }),
  ];
  const relevant = selectRelevantKnowledgeBaseEntries(entries, "send_email", "Gmail");
  assertEquals(relevant.map((e) => e.id), ["a", "c"]);
});

// ---- buildKnowledgeBasePromptBlock ----

Deno.test("buildKnowledgeBasePromptBlock: no entries produces an empty string, never an empty header", () => {
  assertEquals(buildKnowledgeBasePromptBlock([]), "");
});

Deno.test("buildKnowledgeBasePromptBlock: includes every entry's text", () => {
  const block = buildKnowledgeBasePromptBlock([
    entry({ entry_text: "Fact one." }),
    entry({ entry_text: "Fact two." }),
  ]);
  assert(block.includes("Fact one."));
  assert(block.includes("Fact two."));
  assert(block.includes("ACCOUNT KNOWLEDGE"));
});

Deno.test("buildKnowledgeBasePromptBlock: truncates an overly long entry rather than blowing up the prompt", () => {
  const longText = "x".repeat(1000);
  const block = buildKnowledgeBasePromptBlock([entry({ entry_text: longText })]);
  assert(block.length < longText.length + 200);
});
