// Real tests for the pure reversibility lookup — reversibilityFor() itself,
// not the network-calling runUndo()/captureUndoState() (those need a real
// Supabase client and provider APIs, out of scope for a pure unit test).
//
// Run with: deno test --allow-none supabase/functions/_shared/reversibility_test.ts
import { reversibilityFor } from "./reversibility.ts";

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

const GENERIC_FALLBACK = "No compensating action is implemented for this tool.";

Deno.test("reversibilityFor: a genuinely unknown tool kind still falls through to the generic fallback", () => {
  const rev = reversibilityFor("some_future_tool_kind");
  assertFalse(rev.reversible);
  assertEquals(rev.irreversible_reason, GENERIC_FALLBACK);
});

Deno.test("reversibilityFor: generate_report has a specific reason, not the generic fallback", () => {
  const rev = reversibilityFor("generate_report");
  assertFalse(rev.reversible);
  assert(rev.irreversible_reason !== GENERIC_FALLBACK, "must not fall through to the generic message anymore");
  assert(!!rev.irreversible_reason && rev.irreversible_reason.length > 0);
});

Deno.test("reversibilityFor: schedule_followup has a specific reason, not the generic fallback", () => {
  const rev = reversibilityFor("schedule_followup");
  assertFalse(rev.reversible);
  assert(rev.irreversible_reason !== GENERIC_FALLBACK, "must not fall through to the generic message anymore");
});

Deno.test("reversibilityFor: upsert_client_note has a specific reason, not the generic fallback", () => {
  const rev = reversibilityFor("upsert_client_note");
  assertFalse(rev.reversible);
  assert(rev.irreversible_reason !== GENERIC_FALLBACK, "must not fall through to the generic message anymore");
});

Deno.test("reversibilityFor: an already-reversible kind is unaffected by this change", () => {
  const rev = reversibilityFor("slack_post_message");
  assert(rev.reversible);
  assertEquals(rev.undo_kind, "delete");
});
