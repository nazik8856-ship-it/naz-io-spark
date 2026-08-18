// Real tests for the gate decision trace — the exact function
// runControlGate calls to build a complete, ordered layer-by-layer record.
// Run with: deno test supabase/functions/_shared/gate-trace_test.ts
import { finalizeTrace, TRACE_LAYER_ORDER, type TraceEntry } from "./gate-trace.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("finalizeTrace: an empty input fills every canonical layer as not_reached", () => {
  const trace = finalizeTrace([]);
  assertEquals(trace.length, TRACE_LAYER_ORDER.length);
  for (const e of trace) assertEquals(e.status, "not_reached");
});

Deno.test("finalizeTrace: a fully-pushed allow run passes every layer through unchanged, in canonical order", () => {
  const pushed: TraceEntry[] = TRACE_LAYER_ORDER.map(({ layer, label }) => ({
    layer, label, status: "ok", detail: null,
  }));
  const trace = finalizeTrace(pushed);
  assertEquals(trace, pushed);
});

Deno.test("finalizeTrace: layers pushed out of order still come back in canonical order", () => {
  const outOfOrder: TraceEntry[] = [
    { layer: "safety_scanner", label: "Safety scanner", status: "ok", detail: null },
    { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null },
  ];
  const trace = finalizeTrace(outOfOrder);
  assertEquals(trace.map((e) => e.layer), TRACE_LAYER_ORDER.map((l) => l.layer));
});

Deno.test("finalizeTrace: a stop at kill_switch leaves every later layer as not_reached, earlier ones untouched", () => {
  const pushed: TraceEntry[] = [
    { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null },
    { layer: "kill_switch", label: "Global kill switch", status: "stopped", detail: "Kill switch is on" },
  ];
  const trace = finalizeTrace(pushed);
  assertEquals(trace.length, 6);
  assertEquals(trace[0], { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null });
  assertEquals(trace[1].status, "stopped");
  for (const e of trace.slice(2)) assertEquals(e.status, "not_reached");
});

Deno.test("finalizeTrace: a skipped anomaly layer (no agentId) is preserved, not overwritten as not_reached", () => {
  const pushed: TraceEntry[] = [
    ...TRACE_LAYER_ORDER.slice(0, 5).map(({ layer, label }) => ({ layer, label, status: "ok" as const, detail: null })),
    { layer: "anomaly_detector", label: "Anomaly detector", status: "skipped", detail: "No agent tied to this action." },
  ];
  const trace = finalizeTrace(pushed);
  const anomalyEntry = trace.find((e) => e.layer === "anomaly_detector")!;
  assertEquals(anomalyEntry.status, "skipped");
  assertEquals(anomalyEntry.detail, "No agent tied to this action.");
});

Deno.test("finalizeTrace: TRACE_LAYER_ORDER has exactly the 6 documented layers, no duplicates", () => {
  const layers = TRACE_LAYER_ORDER.map((l) => l.layer);
  assertEquals(layers.length, 6);
  assertEquals(new Set(layers).size, 6);
});
