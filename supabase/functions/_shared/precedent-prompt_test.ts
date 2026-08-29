// Real tests for item 4's precedent prompt-block builder.
//
// Run with: deno test --allow-none supabase/functions/_shared/precedent-prompt_test.ts
import { buildPrecedentPromptBlock, type PrecedentPromptRow } from "./precedent-prompt.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (over: Partial<PrecedentPromptRow> = {}): PrecedentPromptRow => ({
  actionType: "send_email", provider: "Gmail", similarity: 0.9,
  decision: "ALLOW send_email (Gmail)", reasoning: "Looked routine and low-risk.",
  ...over,
});

Deno.test("buildPrecedentPromptBlock: empty input produces an empty string, never a misleading empty section header", () => {
  assertEquals(buildPrecedentPromptBlock([]), "");
});

Deno.test("buildPrecedentPromptBlock: includes the decision text, reasoning, and rounded similarity percentage", () => {
  const block = buildPrecedentPromptBlock([row({ similarity: 0.876 })]);
  assert(block.includes("ALLOW send_email (Gmail)"));
  assert(block.includes("Looked routine and low-risk."));
  assert(block.includes("88%"));
});

Deno.test("buildPrecedentPromptBlock: caps at 6 rows even when given more", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ decision: `DECISION_${i}` }));
  const block = buildPrecedentPromptBlock(rows);
  for (let i = 0; i < 6; i++) assert(block.includes(`DECISION_${i}`));
  for (let i = 6; i < 10; i++) assert(!block.includes(`DECISION_${i}`));
});

Deno.test("buildPrecedentPromptBlock: truncates a long reasoning field", () => {
  const block = buildPrecedentPromptBlock([row({ reasoning: "x".repeat(500) })]);
  // 200-char cap on the reasoning slice -- the block itself has other text too.
  assert(!block.includes("x".repeat(500)));
});
