// Real tests for the audit-integrity sweep's pure classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/audit-integrity_test.ts
import { isAuditIntegrityFailure, summarizeAuditIntegrityFailure, type SignatureVerifyResult } from "./audit-integrity.ts";

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
