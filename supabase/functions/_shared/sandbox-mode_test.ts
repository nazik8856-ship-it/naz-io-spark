// Real tests for the sandbox/test-mode gating helpers.
//
// Run with: deno test --allow-none supabase/functions/_shared/sandbox-mode_test.ts
import { countsTowardRealUsage, testModeVerdictNote } from "./sandbox-mode.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("countsTowardRealUsage: a real (non-test) key counts", () => {
  assert(countsTowardRealUsage(false));
});

Deno.test("countsTowardRealUsage: a test key never counts", () => {
  assertFalse(countsTowardRealUsage(true));
});

Deno.test("countsTowardRealUsage: null/undefined default to counting -- every caller predating this item keeps its exact old behavior", () => {
  assert(countsTowardRealUsage(null));
  assert(countsTowardRealUsage(undefined));
});

Deno.test("testModeVerdictNote: a real key gets no note at all", () => {
  assert(testModeVerdictNote(false) === null);
  assert(testModeVerdictNote(null) === null);
  assert(testModeVerdictNote(undefined) === null);
});

Deno.test("testModeVerdictNote: a test key gets a real, non-empty explanation", () => {
  const note = testModeVerdictNote(true);
  assert(typeof note === "string" && note!.length > 0);
  assert(note!.toLowerCase().includes("sandbox"));
});
