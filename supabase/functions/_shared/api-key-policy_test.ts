// Real tests for the API key auto-resolve policy's pure resolution logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/api-key-policy_test.ts
import { resolveOnUncertain, isValidOnUncertainPolicy, ON_UNCERTAIN_POLICIES, extractNarrowedAction, narrowedActionResolution, classifyPendingApprovalStatus } from "./api-key-policy.ts";

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

Deno.test("resolveOnUncertain: 'auto_narrow' is not handled here -- falls back to pending, same as human_review, since this function has no way to attempt a narrow itself", () => {
  assertEquals(resolveOnUncertain("auto_narrow"), { autoResolved: false, resolution: null, status: "pending" });
});

Deno.test("resolveOnUncertain: 'callback' is not handled here either -- same pending fallback, no async I/O possible in a pure function", () => {
  assertEquals(resolveOnUncertain("callback"), { autoResolved: false, resolution: null, status: "pending" });
});

// ---- item 4: callback delegation's pure status classification ----

Deno.test("classifyPendingApprovalStatus: a human decision and its auto-resolved equivalent classify the same way", () => {
  assertEquals(classifyPendingApprovalStatus("approved"), "approved");
  assertEquals(classifyPendingApprovalStatus("auto_approved"), "approved");
  assertEquals(classifyPendingApprovalStatus("rejected"), "rejected");
  assertEquals(classifyPendingApprovalStatus("auto_rejected"), "rejected");
});

Deno.test("classifyPendingApprovalStatus: 'pending' and any unrecognized value are both still-pending", () => {
  assertEquals(classifyPendingApprovalStatus("pending"), "pending");
  assertEquals(classifyPendingApprovalStatus(null), "pending");
  assertEquals(classifyPendingApprovalStatus(undefined), "pending");
  assertEquals(classifyPendingApprovalStatus("something_else"), "pending");
});

// ---- item 3: structured narrowed-action extraction + re-check classification ----

Deno.test("extractNarrowedAction: a 'modify' decision with a real non-empty params object is usable", () => {
  assertEquals(extractNarrowedAction("modify", { to: ["a@b.com"] }), { to: ["a@b.com"] });
});

Deno.test("extractNarrowedAction: only ever usable for a 'modify' decision, never block/allow/deferred", () => {
  for (const decision of ["allow", "block", "deferred"]) {
    assertEquals(extractNarrowedAction(decision, { to: ["a@b.com"] }), null, `${decision} should never be narrowable`);
  }
});

Deno.test("extractNarrowedAction: an empty object, a non-object, an array, or a missing value are all 'nothing to narrow with'", () => {
  assertEquals(extractNarrowedAction("modify", {}), null);
  assertEquals(extractNarrowedAction("modify", null), null);
  assertEquals(extractNarrowedAction("modify", undefined), null);
  assertEquals(extractNarrowedAction("modify", "a string, not an object"), null);
  assertEquals(extractNarrowedAction("modify", ["not", "an", "object"]), null);
});

Deno.test("narrowedActionResolution: a clean re-check (pass_through) auto-approves", () => {
  const result = narrowedActionResolution("pass_through");
  assertEquals(result.resolution, "approved");
  assert(result.note.includes("approved"));
});

Deno.test("narrowedActionResolution: the narrowed version STILL tripping a rule or safety match auto-denies, never a blind allow", () => {
  assertEquals(narrowedActionResolution("require_approval").resolution, "rejected");
  assertEquals(narrowedActionResolution("block").resolution, "rejected");
});
