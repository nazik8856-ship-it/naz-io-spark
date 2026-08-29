// Real tests for the composed plain-English decision explanation.
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-explanation_test.ts
import { buildDecisionExplanation, type DecisionExplanationInput } from "./decision-explanation.ts";
import type { TraceEntry } from "./gate-trace.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const baseInput = (over: Partial<DecisionExplanationInput> = {}): DecisionExplanationInput => ({
  decisionText: "ALLOW send_email (Gmail)",
  reasoning: "The email matches the customer's request and poses no risk.",
  confidenceScore: 92,
  source: "model",
  escalated: false,
  humanResponse: null,
  actionType: "send_email",
  provider: "Gmail",
  createdAt: "2026-08-20T10:00:00Z",
  gateTrace: null,
  precedentCitations: null,
  ...over,
});

Deno.test("buildDecisionExplanation: a clean model-judged allow reads as a real narrative with the key facts", () => {
  const text = buildDecisionExplanation(baseInput());
  assert(text.includes("allowed"));
  assert(text.includes("send_email"));
  assert(text.includes("Gmail"));
  assert(text.includes("92%"));
  assert(text.includes("NazAI's AI judgment"));
  assert(text.includes("No human was involved"));
});

Deno.test("buildDecisionExplanation: a hard-rule block names the rule as the source, not the model", () => {
  const text = buildDecisionExplanation(baseInput({
    decisionText: "BLOCK delete_record (Notion)",
    source: "hard_rule",
    confidenceScore: null,
    reasoning: 'Blocked by your hard rule: "Never delete production records."',
    actionType: "delete_record",
    provider: "Notion",
  }));
  assert(text.includes("blocked"));
  assert(text.includes("one of this account's own hard rules"));
  assert(!text.includes("% confidence"), "a hard-rule block has no model confidence score to report");
});

Deno.test("buildDecisionExplanation: an escalated decision with a human resolution reports it plainly", () => {
  const text = buildDecisionExplanation(baseInput({
    escalated: true,
    humanResponse: "approved",
  }));
  assert(text.includes("escalated for a second look"));
  assert(text.includes("a human resolved it: approved"));
  assert(!text.includes("No human was involved"));
});

Deno.test("buildDecisionExplanation: an escalated decision with no human_response yet reads as still awaiting review", () => {
  const text = buildDecisionExplanation(baseInput({ escalated: true, humanResponse: null }));
  assert(text.includes("awaiting"));
});

Deno.test("buildDecisionExplanation: gate_trace layers are summarized in order, only the ones actually reached", () => {
  const trace: TraceEntry[] = [
    { layer: "spend_cap", label: "Daily AI spend cap", status: "ok", detail: null },
    { layer: "kill_switch", label: "Global kill switch", status: "ok", detail: null },
    { layer: "hard_rules", label: "Hard rules", status: "stopped", detail: "matched \"Never post to #general\"" },
    { layer: "circuit_breaker", label: "Circuit breaker", status: "not_reached", detail: null },
    { layer: "safety_scanner", label: "Safety scanner", status: "not_reached", detail: null },
    { layer: "anomaly_detector", label: "Anomaly detector", status: "not_reached", detail: null },
  ];
  const text = buildDecisionExplanation(baseInput({ gateTrace: trace }));
  assert(text.includes("Daily AI spend cap: passed cleanly"));
  assert(text.includes("Hard rules: stopped the action"));
  assert(!text.includes("Circuit breaker:"), "a layer never reached must not appear in the narrative at all");
});

Deno.test("buildDecisionExplanation: a null/empty gate_trace is silently omitted, not rendered as an empty section", () => {
  const text = buildDecisionExplanation(baseInput({ gateTrace: null }));
  assert(!text.includes("deterministic safety layers"));
  const text2 = buildDecisionExplanation(baseInput({ gateTrace: [] }));
  assert(!text2.includes("deterministic safety layers"));
});

Deno.test("buildDecisionExplanation: precedent citations are summarized with the real sample size and share", () => {
  const text = buildDecisionExplanation(baseInput({
    precedentCitations: { reason: "non_allow_majority", sampleSize: 8, nonAllowShare: 0.75, citedDecisions: [] },
  }));
  assert(text.includes("8 similar past decision"));
  assert(text.includes("75%"));
  assert(text.includes("did NOT come back a simple approval"));
});

Deno.test("buildDecisionExplanation: a contradictory precedent reason reads differently from a non-allow-majority one", () => {
  const text = buildDecisionExplanation(baseInput({
    precedentCitations: { reason: "contradictory", sampleSize: 6, nonAllowShare: 0.5, citedDecisions: [] },
  }));
  assert(text.includes("genuinely mixed signal"));
});

Deno.test("buildDecisionExplanation: a missing reasoning is skipped, not rendered as an empty statement", () => {
  const text = buildDecisionExplanation(baseInput({ reasoning: null }));
  assert(!text.includes("Reasoning given at the time:"));
});

Deno.test("buildDecisionExplanation: a null confidence score is skipped entirely", () => {
  const text = buildDecisionExplanation(baseInput({ confidenceScore: null }));
  assert(!text.includes("% confidence"));
});

Deno.test("buildDecisionExplanation: an unrecognized source falls back to quoting it plainly, never crashes", () => {
  const text = buildDecisionExplanation(baseInput({ source: "some_future_source" }));
  assert(text.includes('"some_future_source"'));
});

Deno.test("buildDecisionExplanation: every verdict word maps to a real, distinct plain-English verb", () => {
  const allow = buildDecisionExplanation(baseInput({ decisionText: "ALLOW x (y)" }));
  const block = buildDecisionExplanation(baseInput({ decisionText: "BLOCK x (y)" }));
  const modify = buildDecisionExplanation(baseInput({ decisionText: "MODIFY x (y)" }));
  assert(allow.includes("allowed") && !allow.includes("blocked"));
  assert(block.includes("blocked") && !block.includes("allowed"));
  assert(modify.includes("modified"));
});
