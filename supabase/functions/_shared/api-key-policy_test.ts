// Real tests for the API key auto-resolve policy's pure resolution logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/api-key-policy_test.ts
import { resolveOnUncertain, isValidOnUncertainPolicy, ON_UNCERTAIN_POLICIES, extractNarrowedAction, narrowedActionResolution, classifyPendingApprovalStatus, isStuckPastMaxWait, resolveSweepFallback, STUCK_APPROVAL_MAX_WAIT_MINUTES, summarizeShadowObservations, evaluateShadowPromotionReadiness, summarizeShadowPromotionReadiness, MIN_DECIDED_SAMPLE_FOR_PROMOTION, MIN_AGREEMENT_RATE_FOR_PROMOTION, type ShadowObservationRow, type ShadowPolicySummary } from "./api-key-policy.ts";

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

// ---- "policy autonomy" item 6: shadow-promotion readiness ----

function summaryWith(decided: number, agreed: number): ShadowPolicySummary {
  return { total: decided, decided, agreed, disagreed: decided - agreed, disagreement_samples: [] };
}

Deno.test("evaluateShadowPromotionReadiness: too few decided outcomes is never ready, regardless of agreement rate", () => {
  const readiness = evaluateShadowPromotionReadiness(summaryWith(MIN_DECIDED_SAMPLE_FOR_PROMOTION - 1, MIN_DECIDED_SAMPLE_FOR_PROMOTION - 1));
  assertEquals(readiness, {
    ready: false,
    reason: "insufficient_sample",
    decided: MIN_DECIDED_SAMPLE_FOR_PROMOTION - 1,
    required: MIN_DECIDED_SAMPLE_FOR_PROMOTION,
  });
});

Deno.test("evaluateShadowPromotionReadiness: enough sample but agreement rate below the threshold is not ready", () => {
  // 20 decided, 17 agreed = 85% -- below the 90% bar.
  const readiness = evaluateShadowPromotionReadiness(summaryWith(20, 17));
  assertEquals(readiness, {
    ready: false,
    reason: "too_many_disagreements",
    agreementRate: 0.85,
    decided: 20,
    required: MIN_AGREEMENT_RATE_FOR_PROMOTION,
  });
});

Deno.test("evaluateShadowPromotionReadiness: enough sample and agreement rate at or above the threshold is ready", () => {
  // 20 decided, 18 agreed = 90% -- exactly at the bar.
  const readiness = evaluateShadowPromotionReadiness(summaryWith(20, 18));
  assertEquals(readiness, { ready: true, agreementRate: 0.9, decided: 20 });
});

Deno.test("evaluateShadowPromotionReadiness: a perfect agreement rate on a larger sample is ready", () => {
  const readiness = evaluateShadowPromotionReadiness(summaryWith(50, 50));
  assertEquals(readiness, { ready: true, agreementRate: 1, decided: 50 });
});

Deno.test("evaluateShadowPromotionReadiness: zero decided outcomes is insufficient sample, not a division-by-zero crash", () => {
  const readiness = evaluateShadowPromotionReadiness(summaryWith(0, 0));
  assertEquals(readiness, { ready: false, reason: "insufficient_sample", decided: 0, required: MIN_DECIDED_SAMPLE_FOR_PROMOTION });
});

Deno.test("summarizeShadowPromotionReadiness: a ready result mentions the real percentage and sample size", () => {
  const text = summarizeShadowPromotionReadiness({ ready: true, agreementRate: 0.95, decided: 40 });
  assert(text.includes("95%"));
  assert(text.includes("40"));
  assert(text.toLowerCase().includes("ready"));
});

Deno.test("summarizeShadowPromotionReadiness: an insufficient-sample result names how many more decided outcomes are needed", () => {
  const text = summarizeShadowPromotionReadiness({ ready: false, reason: "insufficient_sample", decided: 5, required: 20 });
  assert(text.includes("5"));
  assert(text.includes("20"));
});

Deno.test("summarizeShadowPromotionReadiness: a too-many-disagreements result names the real rate and the bar it missed", () => {
  const text = summarizeShadowPromotionReadiness({ ready: false, reason: "too_many_disagreements", agreementRate: 0.8, decided: 25, required: 0.9 });
  assert(text.includes("80%"));
  assert(text.includes("25"));
  assert(text.includes("90%"));
});
