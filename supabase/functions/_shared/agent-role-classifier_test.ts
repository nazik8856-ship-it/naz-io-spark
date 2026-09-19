// Run with: deno test --allow-none supabase/functions/_shared/agent-role-classifier_test.ts
import { pickRole } from "./agent-role-classifier.ts";

function assertEq<T>(actual: T, expected: T, msg = ""): void {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("pickRole: hinted role wins outright", () => {
  assertEq(pickRole("checks gmail for invoices", "marketing"), "marketing");
});

Deno.test("pickRole: an unknown hint is ignored, falls through to keyword matching", () => {
  assertEq(pickRole("checks gmail every morning for unread invoices", "not-a-real-role"), "ops_finance");
});

Deno.test("pickRole: plural financial keywords match ops_finance (regression: singular-only lists missed 'invoices')", () => {
  assertEq(
    pickRole("An AI agent that checks Gmail every morning for unread invoices, extracts the amounts, and posts a summary to Slack"),
    "ops_finance",
  );
});

Deno.test("pickRole: 'posts' alone must NOT win over a real financial signal (regression: pluralizing 'post' broke this)", () => {
  // Same prompt as above, worded slightly differently -- "posts" appears but
  // "invoices" is still the real signal. This is the exact bug caught during
  // live re-verification the same night the plural fix shipped.
  assertEq(pickRole("Every day posts a summary of unread invoices to Slack"), "ops_finance");
});

Deno.test("pickRole: real marketing prompt still classifies correctly without the 'post' keyword", () => {
  assertEq(pickRole("Draft blog content and track social media mentions of our brand"), "marketing");
});

Deno.test("pickRole: support keywords, singular and plural", () => {
  assertEq(pickRole("triage inbound support tickets from the helpdesk"), "support");
  assertEq(pickRole("classify each new customer service complaint"), "support");
});

Deno.test("pickRole: sales_ops keywords, singular and plural", () => {
  assertEq(pickRole("find qualified leads and log them in the CRM pipeline"), "sales_ops");
});

Deno.test("pickRole: anomaly/anomalies both match ops_finance", () => {
  assertEq(pickRole("flag any anomaly in daily revenue"), "ops_finance");
  assertEq(pickRole("flag anomalies in daily revenue"), "ops_finance");
});

Deno.test("pickRole: no keyword match falls back to custom", () => {
  assertEq(pickRole("water my plants and tell me a joke"), "custom");
});
