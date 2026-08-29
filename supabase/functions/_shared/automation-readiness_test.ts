// Real tests for the "automation readiness" signal aggregator.
//
// Run with: deno test --allow-none supabase/functions/_shared/automation-readiness_test.ts
import {
  evaluateAutomationReadiness,
  gatherAutomationReadinessInput,
  MIN_SAMPLE_FOR_READINESS,
  MIN_CITATIONS_FOR_PRECEDENT_SIGNAL,
  type AutomationReadinessInput,
} from "./automation-readiness.ts";
import type { ShadowPolicySummary } from "./api-key-policy.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const shadowSummary = (over: Partial<ShadowPolicySummary> = {}): ShadowPolicySummary => ({
  total: 30,
  decided: 30,
  agreed: 30,
  disagreed: 0,
  disagreement_samples: [],
  ...over,
});

const cleanInput = (over: Partial<AutomationReadinessInput> = {}): AutomationReadinessInput => ({
  decidedSampleSize: MIN_SAMPLE_FOR_READINESS,
  hasActiveCalibrationFlag: false,
  shadowSummary: null,
  totalPrecedentCitations: 0,
  contradictoryPrecedentCitations: 0,
  daysSinceLastDecision: 1,
  ...over,
});

Deno.test("evaluateAutomationReadiness: every signal clean (or not-applicable) is overall ready with zero blockers", () => {
  const report = evaluateAutomationReadiness(cleanInput());
  assertEquals(report.ready, true);
  assertEquals(report.blockers, []);
  assertEquals(report.signals.length, 5);
});

Deno.test("evaluateAutomationReadiness: below the sample-size floor is not ready and names it as a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ decidedSampleSize: 5 }));
  assertEquals(report.ready, false);
  assertEquals(report.blockers.length, 1);
  const sampleSignal = report.signals.find((s) => s.name === "sample_size");
  assertEquals(sampleSignal?.status, "insufficient");
});

Deno.test("evaluateAutomationReadiness: an active confidence-miscalibration flag is a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ hasActiveCalibrationFlag: true }));
  assertEquals(report.ready, false);
  const signal = report.signals.find((s) => s.name === "confidence_calibration");
  assertEquals(signal?.status, "flagged");
});

Deno.test("evaluateAutomationReadiness: no shadow policy configured is informational only, never a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ shadowSummary: null }));
  const signal = report.signals.find((s) => s.name === "shadow_policy");
  assertEquals(signal?.status, "not_configured");
  assertEquals(report.ready, true);
});

Deno.test("evaluateAutomationReadiness: a shadow policy that has earned promotion is a positive, non-blocking signal", () => {
  const report = evaluateAutomationReadiness(cleanInput({ shadowSummary: shadowSummary({ decided: 25, agreed: 24 }) }));
  const signal = report.signals.find((s) => s.name === "shadow_policy");
  assertEquals(signal?.status, "ready");
  assertEquals(report.ready, true);
});

Deno.test("evaluateAutomationReadiness: a shadow policy that hasn't earned promotion yet IS a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ shadowSummary: shadowSummary({ decided: 25, agreed: 15 }) }));
  const signal = report.signals.find((s) => s.name === "shadow_policy");
  assertEquals(signal?.status, "not_ready");
  assertEquals(report.ready, false);
});

Deno.test("evaluateAutomationReadiness: too few precedent citations to judge is informational only, never a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ totalPrecedentCitations: MIN_CITATIONS_FOR_PRECEDENT_SIGNAL - 1, contradictoryPrecedentCitations: MIN_CITATIONS_FOR_PRECEDENT_SIGNAL - 1 }));
  const signal = report.signals.find((s) => s.name === "precedent_consistency");
  assertEquals(signal?.status, "not_enough_data");
  assertEquals(report.ready, true);
});

Deno.test("evaluateAutomationReadiness: a high contradictory-citation rate with enough sample is a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ totalPrecedentCitations: 10, contradictoryPrecedentCitations: 5 }));
  const signal = report.signals.find((s) => s.name === "precedent_consistency");
  assertEquals(signal?.status, "contradictory");
  assertEquals(report.ready, false);
});

Deno.test("evaluateAutomationReadiness: a low contradictory-citation rate with enough sample is ok, not a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ totalPrecedentCitations: 10, contradictoryPrecedentCitations: 1 }));
  const signal = report.signals.find((s) => s.name === "precedent_consistency");
  assertEquals(signal?.status, "ok");
  assertEquals(report.ready, true);
});

Deno.test("evaluateAutomationReadiness: multiple simultaneous blockers are all reported, not just the first one found", () => {
  const report = evaluateAutomationReadiness(cleanInput({
    decidedSampleSize: 2,
    hasActiveCalibrationFlag: true,
    totalPrecedentCitations: 10,
    contradictoryPrecedentCitations: 8,
  }));
  assertEquals(report.ready, false);
  assertEquals(report.blockers.length, 3);
});

// ---- evidence_recency ("knowledge & autonomy" item 10) ----

Deno.test("evaluateAutomationReadiness: no real decision ever is informational only, never a blocker (sample_size already covers it)", () => {
  const report = evaluateAutomationReadiness(cleanInput({ decidedSampleSize: 0, daysSinceLastDecision: null }));
  const signal = report.signals.find((s) => s.name === "evidence_recency");
  assertEquals(signal?.status, "no_data");
  // Only sample_size's own blocker should fire here, not a second one for the same root cause.
  assertEquals(report.blockers.length, 1);
});

Deno.test("evaluateAutomationReadiness: a key with plenty of sample size but stale recent evidence IS its own blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ daysSinceLastDecision: 30 }));
  const signal = report.signals.find((s) => s.name === "evidence_recency");
  assertEquals(signal?.status, "stale");
  assertEquals(report.ready, false);
  assertEquals(report.blockers.length, 1);
});

Deno.test("evaluateAutomationReadiness: evidence right at the staleness boundary is still ok, not stale", () => {
  const report = evaluateAutomationReadiness(cleanInput({ daysSinceLastDecision: 14 }));
  const signal = report.signals.find((s) => s.name === "evidence_recency");
  assertEquals(signal?.status, "ok");
  assertEquals(report.ready, true);
});

Deno.test("evaluateAutomationReadiness: recent evidence is ok, never a blocker", () => {
  const report = evaluateAutomationReadiness(cleanInput({ daysSinceLastDecision: 0 }));
  const signal = report.signals.find((s) => s.name === "evidence_recency");
  assertEquals(signal?.status, "ok");
  assertEquals(report.ready, true);
});

// ---- gatherAutomationReadinessInput (DB-backed) ----

type QueryConfig = {
  agentDecisionsCount?: number;
  confidenceFlagRows?: unknown[];
  apiKeyRow?: { shadow_on_uncertain: string | null } | null;
  shadowObservationRows?: unknown[];
  precedentCitationRows?: { precedent_citations: { reason?: string } | null }[];
  lastDecisionRow?: { created_at: string } | null;
};

function chain(resolve: () => unknown) {
  // deno-lint-ignore no-explicit-any
  const q: any = {
    eq() { return q; },
    is() { return q; },
    not() { return q; },
    gte() { return q; },
    order() { return q; },
    limit() { return q; },
    maybeSingle() { return Promise.resolve(resolve()); },
    then(onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) { return Promise.resolve(resolve()).then(onF, onR); },
  };
  return q;
}

function fakeAdmin(cfg: QueryConfig) {
  const client = {
    from(table: string) {
      return {
        select(cols: string, opts?: { count?: string; head?: boolean }) {
          if (table === "agent_decisions" && opts?.count === "exact") {
            return chain(() => ({ count: cfg.agentDecisionsCount ?? 0, error: null }));
          }
          if (table === "agent_decisions" && cols === "precedent_citations") {
            return chain(() => ({ data: cfg.precedentCitationRows ?? [], error: null }));
          }
          if (table === "agent_decisions" && cols === "created_at") {
            return chain(() => ({ data: cfg.lastDecisionRow ?? null, error: null }));
          }
          if (table === "confidence_bucket_flags") {
            return chain(() => ({ data: cfg.confidenceFlagRows ?? [], error: null }));
          }
          if (table === "api_keys") {
            return chain(() => ({ data: cfg.apiKeyRow ?? null, error: null }));
          }
          if (table === "api_key_shadow_observations") {
            return chain(() => ({ data: cfg.shadowObservationRows ?? [], error: null }));
          }
          return chain(() => ({ data: null, error: null }));
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return client as any;
}

Deno.test("gatherAutomationReadinessInput: assembles all five signals from their real tables", async () => {
  const admin = fakeAdmin({
    agentDecisionsCount: 42,
    confidenceFlagRows: [],
    apiKeyRow: { shadow_on_uncertain: null },
    precedentCitationRows: [{ precedent_citations: { reason: "non_allow_majority" } }, { precedent_citations: { reason: "contradictory" } }],
    lastDecisionRow: { created_at: new Date(Date.now() - 3 * 86400_000).toISOString() },
  });
  const input = await gatherAutomationReadinessInput(admin, "key-1");
  assertEquals(input.decidedSampleSize, 42);
  assertEquals(input.hasActiveCalibrationFlag, false);
  assertEquals(input.shadowSummary, null);
  assertEquals(input.totalPrecedentCitations, 2);
  assertEquals(input.contradictoryPrecedentCitations, 1);
  assertEquals(input.daysSinceLastDecision, 3);
});

Deno.test("gatherAutomationReadinessInput: no last-decision row at all reports null, not zero", async () => {
  const admin = fakeAdmin({ lastDecisionRow: null });
  const input = await gatherAutomationReadinessInput(admin, "key-1");
  assertEquals(input.daysSinceLastDecision, null);
});

Deno.test("gatherAutomationReadinessInput: an active confidence flag row is detected", async () => {
  const admin = fakeAdmin({ confidenceFlagRows: [{ id: "flag-1" }] });
  const input = await gatherAutomationReadinessInput(admin, "key-1");
  assertEquals(input.hasActiveCalibrationFlag, true);
});

Deno.test("gatherAutomationReadinessInput: a configured shadow policy builds a real summary from its observations", async () => {
  const admin = fakeAdmin({
    apiKeyRow: { shadow_on_uncertain: "auto_deny" },
    shadowObservationRows: [
      { shadow_resolution: "rejected", action_type: "send_email", provider: "Gmail", created_at: "2026-08-28T00:00:00Z", pending_approvals: { status: "rejected" } },
    ],
  });
  const input = await gatherAutomationReadinessInput(admin, "key-1");
  assert(input.shadowSummary !== null);
  assertEquals(input.shadowSummary?.decided, 1);
  assertEquals(input.shadowSummary?.agreed, 1);
});

Deno.test("gatherAutomationReadinessInput: no shadow_on_uncertain configured never queries observations, returns null", async () => {
  const admin = fakeAdmin({ apiKeyRow: { shadow_on_uncertain: null } });
  const input = await gatherAutomationReadinessInput(admin, "key-1");
  assertEquals(input.shadowSummary, null);
});

Deno.test("gatherAutomationReadinessInput: a lookup failure anywhere degrades that signal to its own empty state, never throws", async () => {
  const admin = { from() { throw new Error("db down"); } };
  // deno-lint-ignore no-explicit-any
  const input = await gatherAutomationReadinessInput(admin as any, "key-1");
  assertEquals(input, {
    decidedSampleSize: 0,
    hasActiveCalibrationFlag: false,
    shadowSummary: null,
    totalPrecedentCitations: 0,
    contradictoryPrecedentCitations: 0,
    daysSinceLastDecision: null,
  });
});
