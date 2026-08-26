// Real tests for control-api's shared per-action parsing/validation.
//
// Run with: deno test --allow-none supabase/functions/_shared/control-api-action_test.ts
import { parseControlApiAction, MAX_BATCH_ACTIONS } from "./control-api-action.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("parseControlApiAction: a full valid action parses with all fields, mode defaults to fast", () => {
  const result = parseControlApiAction({ action_type: "send_email", provider: "Gmail", description: "Reply to a customer.", params: { to: "a@b.com" } });
  assertEquals(result, {
    actionType: "send_email",
    provider: "Gmail",
    description: "Reply to a customer.",
    params: { to: "a@b.com" },
    mode: "fast",
    idempotencyKey: null,
  });
});

// ---- item 13: idempotency_key parsing ----

Deno.test("parseControlApiAction: idempotency_key is carried through when present", () => {
  const result = parseControlApiAction({ action_type: "x", description: "y", idempotency_key: "retry-attempt-1" });
  assert(!("error" in result));
  assertEquals((result as { idempotencyKey: string | null }).idempotencyKey, "retry-attempt-1");
});

Deno.test("parseControlApiAction: idempotency_key absent parses as null, never an empty string", () => {
  const result = parseControlApiAction({ action_type: "x", description: "y" });
  assert(!("error" in result));
  assertEquals((result as { idempotencyKey: string | null }).idempotencyKey, null);
});

Deno.test("parseControlApiAction: an empty-string idempotency_key is treated as absent (null), not a real key", () => {
  const result = parseControlApiAction({ action_type: "x", description: "y", idempotency_key: "" });
  assert(!("error" in result));
  assertEquals((result as { idempotencyKey: string | null }).idempotencyKey, null);
});

Deno.test("parseControlApiAction: an overlong idempotency_key is truncated to 200 chars, same cap control-engine already uses", () => {
  const long = "x".repeat(500);
  const result = parseControlApiAction({ action_type: "x", description: "y", idempotency_key: long });
  assert(!("error" in result));
  assertEquals((result as { idempotencyKey: string | null }).idempotencyKey?.length, 200);
});

Deno.test("parseControlApiAction: mode='full' is honored, anything else falls back to fast", () => {
  const full = parseControlApiAction({ action_type: "x", description: "y", mode: "full" });
  assert(!("error" in full));
  assertEquals((full as { mode: string }).mode, "full");

  const bogus = parseControlApiAction({ action_type: "x", description: "y", mode: "bogus" });
  assert(!("error" in bogus));
  assertEquals((bogus as { mode: string }).mode, "fast");
});

Deno.test("parseControlApiAction: missing action_type is rejected", () => {
  assertEquals(parseControlApiAction({ description: "y" }), { error: "action_type required" });
  assertEquals(parseControlApiAction({ action_type: "  ", description: "y" }), { error: "action_type required" });
});

Deno.test("parseControlApiAction: missing description is rejected", () => {
  assertEquals(parseControlApiAction({ action_type: "x" }), { error: "description required" });
  assertEquals(parseControlApiAction({ action_type: "x", description: "   " }), { error: "description required" });
});

Deno.test("parseControlApiAction: provider defaults to 'unknown' when absent or blank", () => {
  const noProvider = parseControlApiAction({ action_type: "x", description: "y" });
  assert(!("error" in noProvider));
  assertEquals((noProvider as { provider: string }).provider, "unknown");

  const blankProvider = parseControlApiAction({ action_type: "x", description: "y", provider: "   " });
  assert(!("error" in blankProvider));
  assertEquals((blankProvider as { provider: string }).provider, "unknown");
});

Deno.test("parseControlApiAction: params defaults to an empty object when absent", () => {
  const result = parseControlApiAction({ action_type: "x", description: "y" });
  assert(!("error" in result));
  assertEquals((result as { params: unknown }).params, {});
});

Deno.test("parseControlApiAction: a non-object input is treated as an empty action and rejected", () => {
  assertEquals(parseControlApiAction(null), { error: "action_type required" });
  assertEquals(parseControlApiAction("not an object"), { error: "action_type required" });
  assertEquals(parseControlApiAction(undefined), { error: "action_type required" });
});

Deno.test("MAX_BATCH_ACTIONS is a sane positive cap", () => {
  assert(MAX_BATCH_ACTIONS > 0 && MAX_BATCH_ACTIONS <= 200);
});
