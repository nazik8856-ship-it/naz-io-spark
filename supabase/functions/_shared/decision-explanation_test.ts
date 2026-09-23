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

// Regression for item 3: record_approval_signoff (backing both a normal
// escalation's resolution and a later /dispute re-review) never writes back
// to agent_decisions.human_response -- so without consulting
// approvalResolutions too, a decision a human fully resolved through that
// queue kept reading as "no human was involved" / "awaiting review".
Deno.test("buildDecisionExplanation: an escalated decision resolved via the approvals queue (no human_response) reports the real resolution, not 'awaiting'", () => {
  const text = buildDecisionExplanation(baseInput({
    escalated: true,
    humanResponse: null,
    approvalResolutions: [{ vote: "approved", resolvedAt: "2026-08-21T12:00:00Z", comment: "Looks fine, one-off exception." }],
  }));
  assert(text.includes("A human approved it"));
  assert(text.includes("2026-08-21"));
  assert(text.includes("Looks fine, one-off exception."));
  assert(!text.includes("No human was involved"));
  assert(!text.includes("awaiting"));
});

Deno.test("buildDecisionExplanation: a disputed decision that was never escalated at the time still reports the human's re-review", () => {
  const text = buildDecisionExplanation(baseInput({
    escalated: false,
    humanResponse: null,
    approvalResolutions: [{ vote: "rejected", resolvedAt: "2026-08-22T09:00:00Z", comment: null }],
  }));
  assert(text.includes("wasn't escalated at the time, but a human later reviewed it"));
  assert(text.includes("A human rejected it"));
  assert(!text.includes("No human was involved"));
});

Deno.test("buildDecisionExplanation: multiple approval resolutions (a decision disputed more than once) surface the most recent and note the total count", () => {
  const text = buildDecisionExplanation(baseInput({
    escalated: true,
    humanResponse: null,
    approvalResolutions: [
      { vote: "rejected", resolvedAt: "2026-08-20T09:00:00Z", comment: null },
      { vote: "approved", resolvedAt: "2026-08-25T09:00:00Z", comment: "Re-reviewed with more context." },
    ],
  }));
  assert(text.includes("A human approved it"));
  assert(text.includes("2026-08-25"));
  assert(text.includes("reviewed 2 times in total"));
});

Deno.test("buildDecisionExplanation: an explicit human_response still takes priority over approvalResolutions (its own text is the more specific source)", () => {
  const text = buildDecisionExplanation(baseInput({
    escalated: true,
    humanResponse: "approved",
    approvalResolutions: [{ vote: "approved", resolvedAt: "2026-08-21T12:00:00Z", comment: null }],
  }));
  assert(text.includes("a human resolved it: approved"));
  assert(!text.includes("A human approved it on"), "should not double-report via both paths");
});

Deno.test("buildDecisionExplanation: no approvalResolutions and not escalated still reads as no human involvement (unchanged default)", () => {
  const text = buildDecisionExplanation(baseInput({ escalated: false, approvalResolutions: null }));
  assert(text.includes("No human was involved"));
});

// Regression for item 4: a break-glass override of a hard-rule/safety-scanner
// BLOCK is modeled as a SEPARATE agent_decisions row (override_of pointing
// back at the original) -- the original row itself is never mutated beyond
// an overridden_at timestamp, so without this, the original block's own
// explanation had no way to ever say "a human later overrode this."
Deno.test("buildDecisionExplanation: a single override is reported plainly, with its reasoning and date", () => {
  const text = buildDecisionExplanation(baseInput({
    decisionText: "BLOCK delete_record (Notion)",
    source: "hard_rule",
    overrides: [{ reasoning: "Customer confirmed by phone this record is stale.", createdAt: "2026-08-21T15:00:00Z", actionType: "delete_record", provider: "Notion" }],
  }));
  assert(text.includes("A human later overrode this block on 2026-08-21"));
  assert(text.includes("Customer confirmed by phone this record is stale."));
});

Deno.test("buildDecisionExplanation: multiple overrides note the total count and surface the most recent", () => {
  const text = buildDecisionExplanation(baseInput({
    decisionText: "BLOCK delete_record (Notion)",
    source: "hard_rule",
    overrides: [
      { reasoning: "First attempt.", createdAt: "2026-08-20T09:00:00Z", actionType: "delete_record", provider: "Notion" },
      { reasoning: "Retried after the first write failed.", createdAt: "2026-08-20T09:05:00Z", actionType: "delete_record", provider: "Notion" },
    ],
  }));
  assert(text.includes("2 separate times"));
  assert(text.includes("Retried after the first write failed."));
  assert(!text.includes("First attempt."), "only the most recent override's reasoning should be quoted");
});

Deno.test("buildDecisionExplanation: no overrides is unchanged -- no override sentence appears at all", () => {
  const text = buildDecisionExplanation(baseInput({ overrides: null }));
  assert(!text.includes("overrode"));
});

// Regression for item 5: kill-switch-family TOGGLE events (KillSwitchPanel.tsx,
// source: kill_switch_flip / platform_kill_switch_flip) previously fell
// through to the generic template and rendered the raw source string --
// `...decided by "kill_switch_flip".` -- for the single highest-stakes
// governance action in the product.
Deno.test("buildDecisionExplanation: an account kill-switch flip ON reads as a real sentence, never the raw source string", () => {
  const text = buildDecisionExplanation(baseInput({
    decisionText: "block",
    reasoning: "Kill switch turned ON by owner@acme.com",
    confidenceScore: 100,
    source: "kill_switch_flip",
    escalated: false,
    actionType: null,
    provider: null,
  }));
  assert(text.includes("a human turned this account's kill switch ON"));
  assert(!text.includes('"kill_switch_flip"'));
  assert(!text.includes("% confidence"), "a manual toggle has no AI confidence score to report");
  assert(text.includes("manual action taken directly by a human"));
  assert(!text.includes("No human was involved"));
  assert(!text.includes("awaiting"));
});

Deno.test("buildDecisionExplanation: an account kill-switch flip OFF reads distinctly from ON", () => {
  const text = buildDecisionExplanation(baseInput({
    decisionText: "allow",
    reasoning: "Kill switch turned OFF by owner@acme.com",
    source: "kill_switch_flip",
    actionType: null,
    provider: null,
  }));
  assert(text.includes("a human turned this account's kill switch OFF"));
});

Deno.test("buildDecisionExplanation: a platform kill-switch flip names the platform, not the account, and never reads as a pending escalation", () => {
  const text = buildDecisionExplanation(baseInput({
    decisionText: "block",
    reasoning: "PLATFORM kill switch turned ON by admin@nazai.com -- affects every account, not just this one.",
    source: "platform_kill_switch_flip",
    escalated: true,
    actionType: null,
    provider: null,
  }));
  assert(text.includes("a human turned NazAI's platform-wide kill switch ON"));
  assert(!text.includes('"platform_kill_switch_flip"'));
  assert(!text.includes("escalated for a second look"));
  assert(!text.includes("awaiting"));
});

Deno.test("buildDecisionExplanation: every verdict word maps to a real, distinct plain-English verb", () => {
  const allow = buildDecisionExplanation(baseInput({ decisionText: "ALLOW x (y)" }));
  const block = buildDecisionExplanation(baseInput({ decisionText: "BLOCK x (y)" }));
  const modify = buildDecisionExplanation(baseInput({ decisionText: "MODIFY x (y)" }));
  assert(allow.includes("allowed") && !allow.includes("blocked"));
  assert(block.includes("blocked") && !block.includes("allowed"));
  assert(modify.includes("modified"));
});
