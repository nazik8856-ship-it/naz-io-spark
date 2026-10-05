// GAP 3 (Output Modification & Repair Engine): real tests for the shared
// repair primitives used by Outer Control's correction path, Generator's
// pre-save prose scan, and agent-runtime's retry-with-repair loop.
//
// Run with: deno test --allow-none supabase/functions/_shared/repair-engine_test.ts
import { repairContent, repairParams, verifyRepair, isUsableRepair } from "./repair-engine.ts";
import type { SafetyMatch } from "./safety-scanner.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const secretMatch: SafetyMatch = {
  rule_id: "builtin:secret_key", name: "API key or secret in payload", category: "secrets",
  severity: "block", pattern: "sk-[A-Za-z0-9]{10,}", matched_on: "body", sample: "sk-x…redacted",
};
const destructiveMatch: SafetyMatch = {
  rule_id: "builtin:destructive", name: "Destructive wording", category: "destructive",
  severity: "block", pattern: "delete all", matched_on: "body", sample: "delete all",
};

Deno.test("repairContent: redacts an excisable secret/PII span and leaves the rest of the text intact", () => {
  const result = repairContent("here is the key sk-abcdef1234567890 for you", [secretMatch]);
  assert(result.repaired !== null);
  assert(!result.repaired!.includes("sk-abcdef1234567890"), "the raw secret must not survive repair");
  assert(result.repaired!.includes("here is the key"), "unrelated text must be untouched");
  assert(result.confidence > 0 && result.confidence < 100);
  assert(result.diff.length === 1 && result.diff[0].kind === "redacted_span");
});

Deno.test("repairContent: a non-redactable match (destructive wording) produces no repair", () => {
  const result = repairContent("please delete all records", [destructiveMatch]);
  assert(result.repaired === null);
  assert(result.confidence === 0);
  assert(result.diff.length === 0);
});

Deno.test("repairParams: removes exactly the flagged top-level field", () => {
  const params = { to: "a@b.com", body: "contains a secret sk-abcdef1234567890" };
  const result = repairParams(params, [{ ...secretMatch, matched_on: "body" }]);
  assert(result.repaired !== null);
  assert(!("body" in result.repaired!), "the flagged field must be removed");
  assert("to" in result.repaired!, "an unflagged field must survive");
  assert(result.diff.length === 1 && result.diff[0].detail === "body");
});

Deno.test("repairParams: a match with nothing removable (nested path, or field absent) produces no repair", () => {
  const params = { to: "a@b.com" };
  const result = repairParams(params, [{ ...secretMatch, matched_on: "metadata.secret" }]);
  assert(result.repaired === null);
});

Deno.test("repairParams: stripping the only field produces no repair (nothing left to run)", () => {
  // repairParams itself doesn't enforce this -- it's each caller's own
  // responsibility (outer-control's buildSuggestedCorrection and
  // agent-runtime's attemptSelfRepair both check for it) -- so this test
  // documents the contract: the caller must reject an empty result, not
  // repairParams itself.
  const params = { body: "contains a secret sk-abcdef1234567890" };
  const result = repairParams(params, [{ ...secretMatch, matched_on: "body" }]);
  assert(result.repaired !== null);
  assert(Object.keys(result.repaired!).length === 0, "caller must treat an empty object as unusable");
});

Deno.test("verifyRepair: raises confidence once confirmed clean, zeroes it if still violating", () => {
  const params = { to: "a@b.com", body: "contains a secret sk-abcdef1234567890" };
  const attempt = repairParams(params, [{ ...secretMatch, matched_on: "body" }]);
  const clean = verifyRepair(attempt, false);
  assert(clean.confidence === 95);
  const stillBad = verifyRepair(attempt, true);
  assert(stillBad.confidence === 0);
});

Deno.test("verifyRepair: a no-repair result (repaired: null) is left untouched", () => {
  const noRepair = repairParams({ to: "a@b.com" }, [{ ...secretMatch, matched_on: "metadata.secret" }]);
  const verified = verifyRepair(noRepair, false);
  assert(verified.repaired === null);
  assert(verified.confidence === 0);
});

Deno.test("isUsableRepair: only true once both produced AND verified at high confidence", () => {
  const params = { to: "a@b.com", body: "contains a secret sk-abcdef1234567890" };
  const attempt = repairParams(params, [{ ...secretMatch, matched_on: "body" }]);
  assert(!isUsableRepair(attempt), "an unverified fresh repair (confidence 50) must not be usable yet");
  const verified = verifyRepair(attempt, false);
  assert(isUsableRepair(verified), "a verified-clean repair must be usable");
  const failed = verifyRepair(attempt, true);
  assert(!isUsableRepair(failed), "a repair that still violates must never be usable");
});
