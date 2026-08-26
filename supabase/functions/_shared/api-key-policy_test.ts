// Real tests for the API key auto-resolve policy's pure resolution logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/api-key-policy_test.ts
import { resolveOnUncertain, isValidOnUncertainPolicy, ON_UNCERTAIN_POLICIES, extractNarrowedAction, narrowedActionResolution, classifyPendingApprovalStatus, isStuckPastMaxWait, resolveSweepFallback, STUCK_APPROVAL_MAX_WAIT_MINUTES, summarizeShadowObservations, type ShadowObservationRow } from "./api-key-policy.ts";

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

// ---- item 5: safety-net sweep's stuck-detection and fallback logic ----

Deno.test("isStuckPastMaxWait: a row younger than the max wait is not stuck", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  const createdAt = new Date(now.getTime() - (STUCK_APPROVAL_MAX_WAIT_MINUTES - 1) * 60_000).toISOString();
  assert(!isStuckPastMaxWait(createdAt, now));
});

Deno.test("isStuckPastMaxWait: a row exactly at or past the max wait is stuck", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  const atThreshold = new Date(now.getTime() - STUCK_APPROVAL_MAX_WAIT_MINUTES * 60_000).toISOString();
  const pastThreshold = new Date(now.getTime() - (STUCK_APPROVAL_MAX_WAIT_MINUTES + 5) * 60_000).toISOString();
  assert(isStuckPastMaxWait(atThreshold, now));
  assert(isStuckPastMaxWait(pastThreshold, now));
});

Deno.test("resolveSweepFallback: 'human_review', null, and unrecognized values are never swept -- left pending for a human", () => {
  const expected = { autoResolved: false, resolution: null, status: "pending" };
  assertEquals(resolveSweepFallback("human_review"), expected);
  assertEquals(resolveSweepFallback(null), expected);
  assertEquals(resolveSweepFallback("something_new_and_unrecognized"), expected);
});

Deno.test("resolveSweepFallback: 'auto_allow'/'auto_deny' resolve exactly like resolveOnUncertain", () => {
  assertEquals(resolveSweepFallback("auto_allow"), { autoResolved: true, resolution: "approved", status: "auto_approved" });
  assertEquals(resolveSweepFallback("auto_deny"), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
});

Deno.test("resolveSweepFallback: 'auto_narrow' always resolves to rejected -- a sweep has no model output left to narrow with", () => {
  assertEquals(resolveSweepFallback("auto_narrow"), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
});

Deno.test("resolveSweepFallback: 'callback' resolves using the key's own configured callback_fallback, not a hardcoded default", () => {
  assertEquals(resolveSweepFallback("callback", "auto_allow"), { autoResolved: true, resolution: "approved", status: "auto_approved" });
  assertEquals(resolveSweepFallback("callback", "auto_deny"), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
});

Deno.test("resolveSweepFallback: 'callback' with a missing/unrecognized callback_fallback defaults to the safer auto_deny, never guesses allow", () => {
  assertEquals(resolveSweepFallback("callback", null), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
  assertEquals(resolveSweepFallback("callback", undefined), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
  assertEquals(resolveSweepFallback("callback", "bogus"), { autoResolved: true, resolution: "rejected", status: "auto_rejected" });
});

// ---- item 6: shadow-mode summary for a candidate on_uncertain policy ----

const shadowRow = (over: Partial<ShadowObservationRow> = {}): ShadowObservationRow => ({
  shadow_resolution: "approved",
  actual_status: "approved",
  action_type: "send_email",
  provider: "Gmail",
  created_at: "2026-08-28T00:00:00Z",
  ...over,
});

Deno.test("summarizeShadowObservations: a still-pending real approval is counted in total but not decided", () => {
  const summary = summarizeShadowObservations([shadowRow({ actual_status: "pending" }), shadowRow({ actual_status: null })]);
  assertEquals(summary.total, 2);
  assertEquals(summary.decided, 0);
  assertEquals(summary.agreed, 0);
  assertEquals(summary.disagreed, 0);
});

Deno.test("summarizeShadowObservations: matching shadow guess and real (possibly auto-) outcome count as agreement, either way of phrasing 'approved'", () => {
  const summary = summarizeShadowObservations([
    shadowRow({ shadow_resolution: "approved", actual_status: "approved" }),
    shadowRow({ shadow_resolution: "approved", actual_status: "auto_approved" }),
    shadowRow({ shadow_resolution: "rejected", actual_status: "rejected" }),
  ]);
  assertEquals(summary.total, 3);
  assertEquals(summary.decided, 3);
  assertEquals(summary.agreed, 3);
  assertEquals(summary.disagreed, 0);
  assertEquals(summary.disagreement_samples, []);
});

Deno.test("summarizeShadowObservations: a shadow guess that differs from the real outcome is a disagreement, surfaced as a sample", () => {
  const disagreement = shadowRow({ shadow_resolution: "approved", actual_status: "rejected", action_type: "delete_record" });
  const summary = summarizeShadowObservations([disagreement, shadowRow({ shadow_resolution: "rejected", actual_status: "auto_rejected" })]);
  assertEquals(summary.decided, 2);
  assertEquals(summary.agreed, 1);
  assertEquals(summary.disagreed, 1);
  assertEquals(summary.disagreement_samples.length, 1);
  assertEquals(summary.disagreement_samples[0].action_type, "delete_record");
  assertEquals(summary.disagreement_samples[0].actual, "rejected");
});
