// "Knowledge & autonomy" plan, item 8: a real, per-API-key speed/uptime
// report -- the same kind of status transparency any serious API
// dependency should offer, scoped to one company's own key instead of the
// whole platform (which the existing /control-api/v1/status endpoint
// already covers platform-wide).
//
// No new capture: agent_decisions.gate_duration_ms is already recorded on
// every gated decision (control-gate.ts's own existing latency
// observability, "15 more items" plan item 22) -- this is a pure
// aggregation layer over data that's already there. Mirrors the exact
// same percentile-by-index approach src/lib/approval-sla.ts and
// src/lib/control-health.ts already use for SLA hours and platform-wide
// gate latency, and the exact same "gate_error source = down" definition
// control-health.ts's engineUptimeStats already established -- duplicated
// here (not imported) since that file lives in the Vite frontend tree,
// not this Deno edge-function tree.
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export type KeyLatencyStats = { count: number; avgMs: number; p50Ms: number; p95Ms: number };

/** Pure -- avg/p50/p95 gate_duration_ms over whatever window the caller already fetched. Decisions with no recorded duration (a plain fast-mode allow, or a full-mode model-scored row -- see the module comment) must be filtered out by the caller before this runs, not treated as 0ms. */
export function keyLatencyStats(durationsMs: number[]): KeyLatencyStats {
  if (!durationsMs.length) return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0 };
  const sorted = durationsMs.slice().sort((a, b) => a - b);
  const avgMs = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  return { count: sorted.length, avgMs, p50Ms: Math.round(percentile(sorted, 50)), p95Ms: Math.round(percentile(sorted, 95)) };
}

const GATE_ERROR_SOURCES = new Set(["gate_error", "gate_error_fail_open"]);

export type KeyUptimeStats = { uptimePct: number | null; errorCount: number; total: number };

/**
 * Pure -- null uptimePct means "no decisions for this key in this window
 * at all," which must never render as a false "100% uptime": there's
 * simply nothing to measure yet, distinct from real traffic running
 * clean. A gate_error_fail_open counts as downtime here the same way it
 * does for the platform-wide stat -- the gate itself failed; the fact
 * this specific key was configured to fail open doesn't make that not an
 * outage from the key's own point of view.
 */
export function keyUptimeStats(sources: (string | null | undefined)[]): KeyUptimeStats {
  const total = sources.length;
  if (total === 0) return { uptimePct: null, errorCount: 0, total: 0 };
  const errorCount = sources.filter((s) => s != null && GATE_ERROR_SOURCES.has(s)).length;
  return { uptimePct: Math.round((1 - errorCount / total) * 1000) / 10, errorCount, total };
}
