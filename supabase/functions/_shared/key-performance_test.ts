// Real tests for the per-API-key speed/uptime report's pure aggregation.
//
// Run with: deno test --allow-none supabase/functions/_shared/key-performance_test.ts
import { keyLatencyStats, keyUptimeStats } from "./key-performance.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("keyLatencyStats: no durations at all reports a clean zero/empty state, not NaN", () => {
  assertEquals(keyLatencyStats([]), { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0 });
});

Deno.test("keyLatencyStats: a single duration is its own avg/p50/p95", () => {
  assertEquals(keyLatencyStats([120]), { count: 1, avgMs: 120, p50Ms: 120, p95Ms: 120 });
});

Deno.test("keyLatencyStats: p95 sits above the median for a skewed distribution", () => {
  const durations = [100, 105, 110, 115, 120, 900]; // one slow outlier
  const stats = keyLatencyStats(durations);
  assertEquals(stats.count, 6);
  assert(stats.p95Ms >= stats.p50Ms, "p95 must never be below p50");
  assert(stats.p95Ms === 900, `expected the outlier to dominate p95, got ${stats.p95Ms}`);
});

Deno.test("keyLatencyStats: input order doesn't matter -- it sorts internally", () => {
  const a = keyLatencyStats([300, 100, 200]);
  const b = keyLatencyStats([100, 200, 300]);
  assertEquals(a, b);
});

Deno.test("keyLatencyStats: never mutates the caller's array", () => {
  const input = [300, 100, 200];
  keyLatencyStats(input);
  assertEquals(input, [300, 100, 200]);
});

Deno.test("keyUptimeStats: no decisions in the window reports null, never a false 100%", () => {
  assertEquals(keyUptimeStats([]), { uptimePct: null, errorCount: 0, total: 0 });
});

Deno.test("keyUptimeStats: all clean decisions is 100% uptime", () => {
  const stats = keyUptimeStats(["hard_rule", "model", "kill_switch", "model"]);
  assertEquals(stats, { uptimePct: 100, errorCount: 0, total: 4 });
});

Deno.test("keyUptimeStats: gate_error and gate_error_fail_open both count as downtime", () => {
  const stats = keyUptimeStats(["model", "gate_error", "gate_error_fail_open", "model"]);
  assertEquals(stats, { uptimePct: 50, errorCount: 2, total: 4 });
});

Deno.test("keyUptimeStats: null/undefined sources are counted toward the total but never as errors", () => {
  const stats = keyUptimeStats(["model", null, undefined, "gate_error"]);
  assertEquals(stats, { uptimePct: 75, errorCount: 1, total: 4 });
});

Deno.test("keyUptimeStats: a source that merely BLOCKED on purpose (hard_rule, safety_scanner) is never counted as downtime", () => {
  const stats = keyUptimeStats(["hard_rule", "safety_scanner", "kill_switch", "circuit_breaker_trip"]);
  assertEquals(stats, { uptimePct: 100, errorCount: 0, total: 4 });
});
