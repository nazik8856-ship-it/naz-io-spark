// Real tests for the weekly self-audit's regression-detection logic — the
// exact function control-self-audit calls to decide whether to alert.
// Run with: deno test supabase/functions/_shared/self-audit-diff_test.ts
import { findRegressions, isPassingStatus } from "./self-audit-diff.ts";

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

Deno.test("isPassingStatus: pass and soft_pass count as passing", () => {
  assert(isPassingStatus("pass"));
  assert(isPassingStatus("soft_pass"));
});

Deno.test("isPassingStatus: fail, error, and undefined do not count as passing", () => {
  assertFalse(isPassingStatus("fail"));
  assertFalse(isPassingStatus("error"));
  assertFalse(isPassingStatus(undefined));
});

Deno.test("a scenario that passed before and fails now is a regression", () => {
  const r = findRegressions(["A01"], { A01: "pass" }, { A01: "fail" });
  assertEquals(r, ["A01"]);
});

Deno.test("a scenario that soft-passed before and errors now is a regression", () => {
  const r = findRegressions(["B02"], { B02: "soft_pass" }, { B02: "error" });
  assertEquals(r, ["B02"]);
});

Deno.test("a scenario that passed before and still passes is NOT a regression", () => {
  const r = findRegressions(["A01"], { A01: "pass" }, { A01: "pass" });
  assertEquals(r, []);
});

Deno.test("a scenario that failed before and still fails is NOT a regression (nothing to regress from)", () => {
  const r = findRegressions(["C03"], { C03: "fail" }, { C03: "fail" });
  assertEquals(r, []);
});

Deno.test("a scenario with no prior run is NOT a regression — it's new, not broken", () => {
  const r = findRegressions(["D04"], {}, { D04: "fail" });
  assertEquals(r, []);
});

Deno.test("a scenario that failed before and now passes is an improvement, not a regression", () => {
  const r = findRegressions(["E05"], { E05: "fail" }, { E05: "pass" });
  assertEquals(r, []);
});

Deno.test("only scenarios present in the tracked id list are considered", () => {
  // A stale prior-run status for a scenario that no longer exists in the
  // suite must not surface as a phantom regression.
  const r = findRegressions(["A01"], { A01: "pass", ZZZ: "pass" }, { A01: "pass", ZZZ: "fail" });
  assertEquals(r, []);
});

Deno.test("mixed batch: only the actually-regressed scenarios are returned, in scenario-list order", () => {
  const ids = ["A01", "A02", "A03", "A04"];
  const prev = { A01: "pass", A02: "fail", A03: "soft_pass", A04: "pass" };
  const curr = { A01: "pass", A02: "fail", A03: "fail", A04: "error" };
  const r = findRegressions(ids, prev, curr);
  assertEquals(r, ["A03", "A04"]);
});
