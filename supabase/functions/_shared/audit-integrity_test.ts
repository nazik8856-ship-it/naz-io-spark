// Real tests for the audit-integrity sweep's pure classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/audit-integrity_test.ts
import { isAuditIntegrityFailure, summarizeAuditIntegrityFailure, isAutoResolutionMismatch, isPrecedentCitationMismatch, isDecisionConsistencyMismatch, type SignatureVerifyResult, type StoredPrecedentCitation } from "./audit-integrity.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

const clean: SignatureVerifyResult = { checked: 10, verified: 10, unsigned: 0, mismatched_count: 0 };

Deno.test("isAuditIntegrityFailure: a clean sweep (all verified, none unsigned) is not a failure", () => {
  assertFalse(isAuditIntegrityFailure(clean));
});

Deno.test("isAuditIntegrityFailure: any mismatched signature is a failure", () => {
  assert(isAuditIntegrityFailure({ ...clean, verified: 9, mismatched_count: 1 }));
});

Deno.test("isAuditIntegrityFailure: any unsigned decision in range is a failure", () => {
  assert(isAuditIntegrityFailure({ ...clean, verified: 9, unsigned: 1 }));
});

Deno.test("isAuditIntegrityFailure: zero decisions checked is not a failure (nothing to verify)", () => {
  assertFalse(isAuditIntegrityFailure({ checked: 0, verified: 0, unsigned: 0, mismatched_count: 0 }));
});

Deno.test("summarizeAuditIntegrityFailure: mentions checked/verified counts always", () => {
  const summary = summarizeAuditIntegrityFailure(clean);
  assert(summary.includes("checked 10"));
  assert(summary.includes("10 verified"));
});

Deno.test("summarizeAuditIntegrityFailure: calls out a mismatch as a possible tamper", () => {
  const summary = summarizeAuditIntegrityFailure({ ...clean, verified: 9, mismatched_count: 1 });
  assert(summary.includes("1 signature mismatch"));
  assert(summary.toLowerCase().includes("altered"));
});

Deno.test("summarizeAuditIntegrityFailure: calls out unsigned decisions distinctly from mismatches", () => {
  const summary = summarizeAuditIntegrityFailure({ ...clean, verified: 9, unsigned: 2 });
  assert(summary.includes("2 decision(s) in range have no signature"));
});

Deno.test("summarizeAuditIntegrityFailure: a clean sweep's summary mentions neither mismatch nor unsigned", () => {
  const summary = summarizeAuditIntegrityFailure(clean);
  assertFalse(summary.includes("mismatch"));
  assertFalse(summary.includes("unsigned") && summary.includes("no signature"));
});

// ---- item 15: auto-resolution policy re-check ----

Deno.test("isAutoResolutionMismatch: pass_through is not a mismatch", () => {
  assertFalse(isAutoResolutionMismatch("pass_through"));
});

Deno.test("isAutoResolutionMismatch: block or require_approval are both mismatches", () => {
  assert(isAutoResolutionMismatch("block"));
  assert(isAutoResolutionMismatch("require_approval"));
});

Deno.test("isAuditIntegrityFailure: a clean sweep with auto-resolution fields present but zero mismatches is still not a failure", () => {
  assertFalse(isAuditIntegrityFailure({ ...clean, auto_resolutions_checked: 5, auto_resolutions_mismatched: 0 }));
});

Deno.test("isAuditIntegrityFailure: any auto-resolution mismatch is a failure, even with clean signatures", () => {
  assert(isAuditIntegrityFailure({ ...clean, auto_resolutions_checked: 5, auto_resolutions_mismatched: 1 }));
});

Deno.test("isAuditIntegrityFailure: auto-resolution fields omitted entirely defaults to no failure from that dimension", () => {
  assertFalse(isAuditIntegrityFailure(clean));
});

Deno.test("summarizeAuditIntegrityFailure: calls out an auto-resolution mismatch distinctly, with both counts", () => {
  const summary = summarizeAuditIntegrityFailure({ ...clean, auto_resolutions_checked: 8, auto_resolutions_mismatched: 2 });
  assert(summary.includes("2 of 8 auto-resolved"));
  assert(summary.toLowerCase().includes("current policy"));
});

// ---- item 15: precedent-citation re-check ----

const validCitation = (overrides: Partial<StoredPrecedentCitation> = {}): StoredPrecedentCitation => ({
  reason: "non_allow_majority",
  sampleSize: 3,
  nonAllowShare: 0.67,
  citedDecisions: [{ decisionId: "d1" }, { decisionId: "d2" }, { decisionId: "d3" }],
  ...overrides,
});
const allExist = new Set(["d1", "d2", "d3"]);

Deno.test("isPrecedentCitationMismatch: a genuinely consistent, real citation is not a mismatch", () => {
  assertFalse(isPrecedentCitationMismatch(validCitation(), allExist));
});

Deno.test("isPrecedentCitationMismatch: a contradictory-reasoned citation whose share genuinely sits in that range is not a mismatch", () => {
  assertFalse(isPrecedentCitationMismatch(validCitation({ reason: "contradictory", nonAllowShare: 0.5 }), allExist));
});

Deno.test("isPrecedentCitationMismatch: claimed sample size that doesn't match the listed decisions is a mismatch", () => {
  assert(isPrecedentCitationMismatch(validCitation({ sampleSize: 5 }), allExist));
});

Deno.test("isPrecedentCitationMismatch: citing a decision that no longer exists is a mismatch", () => {
  const missingOne = new Set(["d1", "d2"]); // d3 is gone
  assert(isPrecedentCitationMismatch(validCitation(), missingOne));
});

Deno.test("isPrecedentCitationMismatch: a share too low to justify ANY override is a mismatch -- a citation should never exist for it", () => {
  assert(isPrecedentCitationMismatch(validCitation({ nonAllowShare: 0.2 }), allExist));
});

Deno.test("isPrecedentCitationMismatch: reason says 'non_allow_majority' but the share only clears the contradictory band -- a mismatch", () => {
  assert(isPrecedentCitationMismatch(validCitation({ reason: "non_allow_majority", nonAllowShare: 0.5 }), allExist));
});

Deno.test("isPrecedentCitationMismatch: reason says 'contradictory' but the share is a clear majority -- a mismatch", () => {
  assert(isPrecedentCitationMismatch(validCitation({ reason: "contradictory", nonAllowShare: 0.9 }), allExist));
});

Deno.test("isAuditIntegrityFailure: any precedent-citation mismatch is a failure, even with clean signatures", () => {
  assert(isAuditIntegrityFailure({ ...clean, precedent_citations_checked: 4, precedent_citations_mismatched: 1 }));
});

Deno.test("isAuditIntegrityFailure: precedent-citation fields present but zero mismatches is still not a failure", () => {
  assertFalse(isAuditIntegrityFailure({ ...clean, precedent_citations_checked: 4, precedent_citations_mismatched: 0 }));
});

Deno.test("summarizeAuditIntegrityFailure: calls out a precedent-citation mismatch distinctly, with both counts", () => {
  const summary = summarizeAuditIntegrityFailure({ ...clean, precedent_citations_checked: 6, precedent_citations_mismatched: 1 });
  assert(summary.includes("1 of 6 real-precedent citation"));
  assert(summary.toLowerCase().includes("real-precedent memory system"));
});

// ---- "policy autonomy" item 15: isDecisionConsistencyMismatch ----

const clearNonAllowMajority = [true, true, true, false]; // 75% non-allow
const clearAllowMajority = [false, false, false, true]; // 25% non-allow
const mixedBag = [true, true, false, false]; // 50% non-allow -- genuinely contradictory

Deno.test("isDecisionConsistencyMismatch: an escalated decision is never flagged, even against a clear opposing majority", () => {
  assertFalse(isDecisionConsistencyMismatch(true, true, "model", clearAllowMajority));
});

Deno.test("isDecisionConsistencyMismatch: a human_override is never flagged, even against a clear opposing majority", () => {
  assertFalse(isDecisionConsistencyMismatch(true, false, "human_override", clearAllowMajority));
});

Deno.test("isDecisionConsistencyMismatch: too few similar decisions to judge is never flagged", () => {
  assertFalse(isDecisionConsistencyMismatch(true, false, "model", [false, false]));
});

Deno.test("isDecisionConsistencyMismatch: a genuinely mixed-bag precedent cohort has no consistent answer to disagree with", () => {
  assertFalse(isDecisionConsistencyMismatch(true, false, "model", mixedBag));
  assertFalse(isDecisionConsistencyMismatch(false, false, "model", mixedBag));
});

Deno.test("isDecisionConsistencyMismatch: a non-allow verdict agreeing with a clear non-allow majority is not a mismatch", () => {
  assertFalse(isDecisionConsistencyMismatch(true, false, "model", clearNonAllowMajority));
});

Deno.test("isDecisionConsistencyMismatch: an allow verdict disagreeing with a clear non-allow majority IS a mismatch", () => {
  assert(isDecisionConsistencyMismatch(false, false, "model", clearNonAllowMajority));
});

Deno.test("isDecisionConsistencyMismatch: an allow verdict agreeing with a clear allow majority is not a mismatch", () => {
  assertFalse(isDecisionConsistencyMismatch(false, false, "model", clearAllowMajority));
});

Deno.test("isDecisionConsistencyMismatch: a non-allow verdict disagreeing with a clear allow majority IS a mismatch", () => {
  assert(isDecisionConsistencyMismatch(true, false, "model", clearAllowMajority));
});

Deno.test("isAuditIntegrityFailure: any decision-consistency mismatch is a failure, even with clean signatures", () => {
  assert(isAuditIntegrityFailure({ ...clean, decision_consistency_checked: 10, decision_consistency_mismatched: 1 }));
});

Deno.test("isAuditIntegrityFailure: decision-consistency fields present but zero mismatches is still not a failure", () => {
  assertFalse(isAuditIntegrityFailure({ ...clean, decision_consistency_checked: 10, decision_consistency_mismatched: 0 }));
});

Deno.test("isAuditIntegrityFailure: decision-consistency fields omitted entirely defaults to no failure from that dimension", () => {
  assertFalse(isAuditIntegrityFailure({ ...clean }));
});

Deno.test("summarizeAuditIntegrityFailure: calls out a decision-consistency mismatch distinctly, with both counts", () => {
  const summary = summarizeAuditIntegrityFailure({ ...clean, decision_consistency_checked: 12, decision_consistency_mismatched: 2 });
  assert(summary.includes("2 of 12 decision"));
  assert(summary.toLowerCase().includes("flip-flopping"));
});
