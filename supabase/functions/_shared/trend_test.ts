// Real tests for the week-over-week trend calculator.
//
// Run with: deno test --allow-none supabase/functions/_shared/trend_test.ts
import { computeTrend } from "./trend.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("an increase is 'up' with a positive percent change", () => {
  assertEquals(computeTrend(15, 10), { current: 15, previous: 10, changePct: 50, direction: "up" });
});

Deno.test("a decrease is 'down' with a negative percent change", () => {
  assertEquals(computeTrend(5, 10), { current: 5, previous: 10, changePct: -50, direction: "down" });
});

Deno.test("no change is 'flat' with 0% change", () => {
  assertEquals(computeTrend(10, 10), { current: 10, previous: 10, changePct: 0, direction: "flat" });
});

Deno.test("zero both weeks is flat with 0% change, not NaN/Infinity", () => {
  assertEquals(computeTrend(0, 0), { current: 0, previous: 0, changePct: 0, direction: "flat" });
});

Deno.test("going from zero to something is 'up' with 100% change (no prior baseline to divide by)", () => {
  assertEquals(computeTrend(5, 0), { current: 5, previous: 0, changePct: 100, direction: "up" });
});

Deno.test("going from something to zero is 'down' with -100% change", () => {
  assertEquals(computeTrend(0, 5), { current: 0, previous: 5, changePct: -100, direction: "down" });
});

Deno.test("percent change rounds to one decimal place", () => {
  const t = computeTrend(1, 3);
  assertEquals(t.changePct, -66.7);
});
