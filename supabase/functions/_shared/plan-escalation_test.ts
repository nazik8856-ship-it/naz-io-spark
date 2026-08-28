// Real tests for the plan-linked-step escalation check.
//
// Run with: deno test --allow-none supabase/functions/_shared/plan-escalation_test.ts
import { planHasEarlierBlock } from "./plan-escalation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("planHasEarlierBlock: no earlier decisions at all is false", () => {
  assertFalse(planHasEarlierBlock([]));
});

Deno.test("planHasEarlierBlock: an earlier BLOCK is detected", () => {
  assert(planHasEarlierBlock(["BLOCK send_email (Gmail)"]));
});

Deno.test("planHasEarlierBlock: an earlier ALLOW alone is false", () => {
  assertFalse(planHasEarlierBlock(["ALLOW send_email (Gmail)"]));
});

Deno.test("planHasEarlierBlock: a mix of allows/modifies with one real block among them is true", () => {
  assert(planHasEarlierBlock(["ALLOW send_email (Gmail)", "MODIFY post_message (Slack)", "BLOCK delete_record (Notion)"]));
});

Deno.test("planHasEarlierBlock: APPROVAL_REQUIRED alone (not yet a real block) is false", () => {
  assertFalse(planHasEarlierBlock(["APPROVAL_REQUIRED send_email (Gmail)"]));
});

Deno.test("planHasEarlierBlock: matching is case-insensitive on the leading word, same as classifyDecisionOutcome", () => {
  assert(planHasEarlierBlock(["block send_email (Gmail)"]));
});
