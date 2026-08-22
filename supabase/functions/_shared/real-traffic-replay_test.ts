// Real tests for real-traffic-replay's pure diff/aggregation logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/real-traffic-replay_test.ts
import { diffRealAction, summarizeRealTrafficReplay, type RealActionDiff } from "./real-traffic-replay.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("diffRealAction: identical outcomes are 'same'", () => {
  assertEquals(diffRealAction("block", "block"), "same");
  assertEquals(diffRealAction("pass_through", "pass_through"), "same");
});

Deno.test("diffRealAction: draft strictly less strict than active is a regression", () => {
  assertEquals(diffRealAction("block", "require_approval"), "regression");
  assertEquals(diffRealAction("block", "pass_through"), "regression");
  assertEquals(diffRealAction("require_approval", "pass_through"), "regression");
});

Deno.test("diffRealAction: draft strictly more strict than active is an improvement", () => {
  assertEquals(diffRealAction("pass_through", "require_approval"), "improvement");
  assertEquals(diffRealAction("pass_through", "block"), "improvement");
  assertEquals(diffRealAction("require_approval", "block"), "improvement");
});

Deno.test("summarizeRealTrafficReplay: counts each bucket correctly", () => {
  const diffs: RealActionDiff[] = ["same", "same", "regression", "improvement", "improvement", "improvement"];
  assertEquals(summarizeRealTrafficReplay(diffs), { total: 6, same: 2, regressions: 1, improvements: 3 });
});

Deno.test("summarizeRealTrafficReplay: an empty batch is all zeros, not a crash", () => {
  assertEquals(summarizeRealTrafficReplay([]), { total: 0, same: 0, regressions: 0, improvements: 0 });
});
