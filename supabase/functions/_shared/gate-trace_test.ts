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
    { layer: "platform_kill_switch", label: "Platform kill switch", status: "ok", detail: null },
    { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null },
    { layer: "kill_switch", label: "Account kill switch", status: "stopped", detail: "Kill switch is on" },
  ];
  const trace = finalizeTrace(pushed);
  assertEquals(trace.length, TRACE_LAYER_ORDER.length);
  assertEquals(trace[0], { layer: "platform_kill_switch", label: "Platform kill switch", status: "ok", detail: null });
  assertEquals(trace[1], { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null });
  assertEquals(trace[2].status, "stopped");
  for (const e of trace.slice(3)) assertEquals(e.status, "not_reached");
});

Deno.test("finalizeTrace: a platform kill switch stop is preserved, not discarded as unrecognized", () => {
  // Regression test for the exact bug this list previously had: pushing a
  // layer this canonical list didn't know about (platform_kill_switch,
  // agent_spend_cap) used to be silently dropped by finalizeTrace, so a
  // block from either one rendered as ALL SIX layers "not_reached" instead
  // of showing the one that actually fired.
  const pushed: TraceEntry[] = [
    { layer: "platform_kill_switch", label: "Platform kill switch", status: "stopped", detail: "A platform operator has paused every account" },
  ];
  const trace = finalizeTrace(pushed);
  const entry = trace.find((e) => e.layer === "platform_kill_switch")!;
  assertEquals(entry.status, "stopped");
  assertEquals(entry.detail, "A platform operator has paused every account");
  for (const e of trace.filter((e) => e.layer !== "platform_kill_switch")) assertEquals(e.status, "not_reached");
});

Deno.test("finalizeTrace: an agent spend cap stop is preserved, not discarded as unrecognized", () => {
  const pushed: TraceEntry[] = [
    { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null },
    { layer: "kill_switch", label: "Account kill switch", status: "ok", detail: null },
    { layer: "agent_spend_cap", label: "Agent spend cap", status: "stopped", detail: "$5.00 of $5.00 across 10 calls (this agent only)" },
  ];
  const trace = finalizeTrace(pushed);
  const entry = trace.find((e) => e.layer === "agent_spend_cap")!;
  assertEquals(entry.status, "stopped");
  assertEquals(entry.detail, "$5.00 of $5.00 across 10 calls (this agent only)");
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

Deno.test("finalizeTrace: TRACE_LAYER_ORDER has exactly the 8 documented layers, no duplicates", () => {
  const layers = TRACE_LAYER_ORDER.map((l) => l.layer);
  assertEquals(layers.length, 8);
  assertEquals(new Set(layers).size, 8);
});
