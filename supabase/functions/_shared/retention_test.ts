// Real tests for retention-sweep's cutoff calculation.
//
// Run with: deno test --allow-none supabase/functions/_shared/retention_test.ts
import { retentionCutoffIso } from "./retention.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = new Date("2026-08-27T12:00:00.000Z");

Deno.test("retentionCutoffIso: uses the configured retention_days when it's above the 30-day floor", () => {
  const cutoff = retentionCutoffIso(400, NOW);
  assertEquals(cutoff, new Date("2025-07-23T12:00:00.000Z").toISOString());
});

Deno.test("retentionCutoffIso: floors a configured value below 30 days up to 30", () => {
  const cutoff = retentionCutoffIso(5, NOW);
  assertEquals(cutoff, new Date("2026-07-28T12:00:00.000Z").toISOString());
});

Deno.test("retentionCutoffIso: floors a zero or negative retention_days up to 30, never resolving to 'delete everything'", () => {
  assertEquals(retentionCutoffIso(0, NOW), new Date("2026-07-28T12:00:00.000Z").toISOString());
  assertEquals(retentionCutoffIso(-10, NOW), new Date("2026-07-28T12:00:00.000Z").toISOString());
});

Deno.test("retentionCutoffIso: exactly 30 days uses 30, not the floor's edge case off-by-one", () => {
  assertEquals(retentionCutoffIso(30, NOW), new Date("2026-07-28T12:00:00.000Z").toISOString());
});
