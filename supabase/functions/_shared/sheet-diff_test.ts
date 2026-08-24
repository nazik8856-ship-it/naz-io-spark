// Real tests for the sheet write-verification spot-check diff.
//
// Run with: deno test --allow-env supabase/functions/_shared/sheet-diff_test.ts
import { diffSheetWrite } from "./sheet-diff.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}\n  ${(e as Error).message}`);
  }
}

test("diffSheetWrite: exact match is ok", () => {
  const r = diffSheetWrite([["a", "b"], ["c", "d"]], [["a", "b"], ["c", "d"]]);
  assert(r.ok, JSON.stringify(r));
});

test("diffSheetWrite: fewer rows re-read than sent is a failure", () => {
  const r = diffSheetWrite([["a"], ["b"], ["c"]], [["a"], ["b"]]);
  assert(!r.ok);
  assert(!!r.reason && r.reason.includes("expected 3"));
});

test("diffSheetWrite: numeric type coercion (string sent, number read back) is tolerated", () => {
  const r = diffSheetWrite([["5", "hello"]], [[5, "hello"]]);
  assert(r.ok, JSON.stringify(r));
});

test("diffSheetWrite: a genuinely wrong corner value is caught", () => {
  const r = diffSheetWrite([["a", "b"], ["c", "d"]], [["a", "WRONG"], ["c", "d"]]);
  assert(!r.ok);
  assert(!!r.reason && r.reason.includes('"b"') && r.reason.includes("WRONG"));
});

test("diffSheetWrite: a wrong value in the middle (not a checked corner) is NOT caught -- spot-check, not deep-equal", () => {
  const r = diffSheetWrite([["a", "MIDDLE", "b"]], [["a", "SOMETHING-ELSE", "b"]]);
  assert(r.ok, "middle cells are deliberately not spot-checked");
});

test("diffSheetWrite: a blank sent cell is never compared (nothing meaningful was asked to land there)", () => {
  const r = diffSheetWrite([["", "b"]], [["whatever-was-already-there", "b"]]);
  assert(r.ok, JSON.stringify(r));
});

test("diffSheetWrite: single-row single-cell write is checked", () => {
  const okr = diffSheetWrite([["only"]], [["only"]]);
  assert(okr.ok);
  const badr = diffSheetWrite([["only"]], [["different"]]);
  assert(!badr.ok);
});

test("diffSheetWrite: extra re-read rows beyond what was sent don't fail the check", () => {
  const r = diffSheetWrite([["a"]], [["a"], ["b"], ["c"]]);
  assert(r.ok);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
