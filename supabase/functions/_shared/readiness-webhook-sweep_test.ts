// Real tests for the readiness-webhook "became ready" transition check.
//
// Run with: deno test --allow-none supabase/functions/_shared/readiness-webhook-sweep_test.ts
import { hasBecomeReady } from "./readiness-webhook-sweep.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("hasBecomeReady: never recorded before, now ready, IS a transition", () => {
  assert(hasBecomeReady(null, true));
});

Deno.test("hasBecomeReady: previously not ready, now ready, IS a transition", () => {
  assert(hasBecomeReady(false, true));
});

Deno.test("hasBecomeReady: previously ready, still ready, is NOT a new transition", () => {
  assertFalse(hasBecomeReady(true, true));
});

Deno.test("hasBecomeReady: previously ready, now not ready, is NOT a 'became ready' transition", () => {
  assertFalse(hasBecomeReady(true, false));
});

Deno.test("hasBecomeReady: never recorded, still not ready, is not a transition", () => {
  assertFalse(hasBecomeReady(null, false));
});
