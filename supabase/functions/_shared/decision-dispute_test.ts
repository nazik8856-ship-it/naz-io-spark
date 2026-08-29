// Real tests for the decision-dispute (re-review request) pure helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-dispute_test.ts
import { hasOpenReview, buildDisputeReasonText } from "./decision-dispute.ts";

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

// ---- hasOpenReview ----

Deno.test("hasOpenReview: no existing row at all is false -- nothing open yet", () => {
  assertFalse(hasOpenReview(null));
});

Deno.test("hasOpenReview: a still-pending row is true", () => {
  assert(hasOpenReview({ status: "pending" }));
});

Deno.test("hasOpenReview: an already-resolved row (approved/rejected/auto_*) is false -- safe to open a new one", () => {
  assertFalse(hasOpenReview({ status: "approved" }));
  assertFalse(hasOpenReview({ status: "rejected" }));
  assertFalse(hasOpenReview({ status: "auto_approved" }));
  assertFalse(hasOpenReview({ status: "auto_rejected" }));
});

// ---- buildDisputeReasonText ----

Deno.test("buildDisputeReasonText: a real caller reason is prefixed and used verbatim", () => {
  const text = buildDisputeReasonText("Our customer says this email should have gone through.", "BLOCK send_email (Gmail)");
  assertEquals(text, "Re-review requested: Our customer says this email should have gone through.");
});

Deno.test("buildDisputeReasonText: whitespace-only reason is treated as absent", () => {
  const text = buildDisputeReasonText("   ", "BLOCK send_email (Gmail)");
  assert(text.includes("no additional reason given"));
});

Deno.test("buildDisputeReasonText: null/undefined reason still produces a real, honest reason referencing the original decision", () => {
  const a = buildDisputeReasonText(null, "BLOCK send_email (Gmail)");
  const b = buildDisputeReasonText(undefined, "BLOCK send_email (Gmail)");
  assert(a.includes("BLOCK send_email (Gmail)"));
  assertEquals(a, b);
});
