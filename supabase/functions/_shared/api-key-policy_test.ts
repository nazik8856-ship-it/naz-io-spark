// Real tests for the API key auto-resolve policy's pure resolution logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/api-key-policy_test.ts
import { resolveOnUncertain, isValidOnUncertainPolicy, ON_UNCERTAIN_POLICIES } from "./api-key-policy.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("resolveOnUncertain: 'human_review' leaves it pending, unresolved -- today's exact behavior", () => {
  assertEquals(resolveOnUncertain("human_review"), { autoResolved: false, resolution: null, status: "pending" });
});

Deno.test("resolveOnUncertain: 'auto_allow' resolves to approved automatically", () => {
  assertEquals(resolveOnUncertain("auto_allow"), { autoResolved: true, resolution: "approved", status: "auto_approved" });
});

Deno.test("resolveOnUncertain: 'auto_deny' resolves to rejected automatically", () => {
  assertEquals(resolveOnUncertain("auto_deny"), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
});

Deno.test("resolveOnUncertain: null, undefined, or an unrecognized value all fall back to human_review's behavior, never guessing an automatic resolution", () => {
  const expected = { autoResolved: false, resolution: null, status: "pending" };
  assertEquals(resolveOnUncertain(null), expected);
  assertEquals(resolveOnUncertain(undefined), expected);
  assertEquals(resolveOnUncertain("something_new_and_unrecognized"), expected);
  assertEquals(resolveOnUncertain(""), expected);
});

Deno.test("isValidOnUncertainPolicy: accepts exactly the three known values", () => {
  for (const p of ON_UNCERTAIN_POLICIES) assert(isValidOnUncertainPolicy(p), `${p} should be valid`);
});

Deno.test("isValidOnUncertainPolicy: rejects anything else, including non-strings", () => {
  assert(!isValidOnUncertainPolicy("bogus"));
  assert(!isValidOnUncertainPolicy(null));
  assert(!isValidOnUncertainPolicy(undefined));
  assert(!isValidOnUncertainPolicy(123));
  assert(!isValidOnUncertainPolicy({}));
});
