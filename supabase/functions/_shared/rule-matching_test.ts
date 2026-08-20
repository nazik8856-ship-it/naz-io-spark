// Real tests for the shared hard-rule matcher, extracted from control-gate.ts
// so it's used identically by both the real gate and the rule simulator.
//
// Run with: deno test --allow-none supabase/functions/_shared/rule-matching_test.ts
import { globToRe, ruleMatchesAction, selectRulesForAgent } from "./rule-matching.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("globToRe: '*' alone matches anything", () => {
  const re = globToRe("*");
  assert(re.test("send_email"));
  assert(re.test(""));
});

Deno.test("globToRe: exact string with no '*' matches only that string", () => {
  const re = globToRe("send_email");
  assert(re.test("send_email"));
  assert(!re.test("send_email_reply"));
  assert(!re.test("reply_send_email"));
});

Deno.test("globToRe: prefix/suffix wildcard", () => {
  const re = globToRe("slack_*");
  assert(re.test("slack_post_message"));
  assert(!re.test("gmail_send"));
});

Deno.test("globToRe: is case-insensitive", () => {
  assert(globToRe("Send_Email").test("send_email"));
});

Deno.test("globToRe: special regex characters in the pattern are escaped, not interpreted", () => {
  const re = globToRe("a.b+c");
  assert(re.test("a.b+c"));
  assert(!re.test("axbyc")); // '.' and '+' must be literal, not regex metacharacters
});

Deno.test("ruleMatchesAction: no provider on the rule means it applies to every provider", () => {
  assert(ruleMatchesAction({ action_type_pattern: "*", provider: null }, "send_email", "Gmail"));
  assert(ruleMatchesAction({ action_type_pattern: "*", provider: null }, "slack_post_message", "Slack"));
});

Deno.test("ruleMatchesAction: a provider on the rule restricts it to that provider only", () => {
  const rule = { action_type_pattern: "*", provider: "Gmail" };
  assert(ruleMatchesAction(rule, "send_email", "Gmail"));
  assert(!ruleMatchesAction(rule, "send_email", "Slack"));
});

Deno.test("ruleMatchesAction: provider comparison is case-insensitive", () => {
  const rule = { action_type_pattern: "*", provider: "gmail" };
  assert(ruleMatchesAction(rule, "send_email", "GMAIL"));
});

Deno.test("ruleMatchesAction: an empty action_type_pattern defaults to matching everything", () => {
  assert(ruleMatchesAction({ action_type_pattern: "", provider: null }, "anything_at_all", "Any"));
});

Deno.test("ruleMatchesAction: a pattern with regex-special characters (e.g. an unbalanced bracket) is escaped, matched literally, and never throws", () => {
  const rule = { action_type_pattern: "[weird]", provider: null };
  assert(ruleMatchesAction(rule, "[weird]", "Gmail"), "the literal bracketed string should match itself");
  assert(!ruleMatchesAction(rule, "weird", "Gmail"), "'[' and ']' must be literal characters, not a regex character class");
});

// --- selectRulesForAgent (Wave 5, session 1: per-agent policy scoping) ---

type R = { id: string; agent_id: string | null };

Deno.test("selectRulesForAgent: account-wide rules (agent_id null) are visible for any agent", () => {
  const rules: R[] = [{ id: "acct", agent_id: null }];
  assertEquals(selectRulesForAgent(rules, "agent-1").map((r) => r.id), ["acct"]);
  assertEquals(selectRulesForAgent(rules, "agent-2").map((r) => r.id), ["acct"]);
  assertEquals(selectRulesForAgent(rules, null).map((r) => r.id), ["acct"]);
});

Deno.test("selectRulesForAgent: an agent-scoped rule is invisible to every other agent", () => {
  const rules: R[] = [{ id: "a1-only", agent_id: "agent-1" }];
  assertEquals(selectRulesForAgent(rules, "agent-2"), []);
  assertEquals(selectRulesForAgent(rules, null), []);
});

Deno.test("selectRulesForAgent: an agent-scoped rule is visible for its own agent", () => {
  const rules: R[] = [{ id: "a1-only", agent_id: "agent-1" }];
  assertEquals(selectRulesForAgent(rules, "agent-1").map((r) => r.id), ["a1-only"]);
});

Deno.test("selectRulesForAgent: agent-specific rules are ordered before account-wide ones, so 'first match wins' gives agent precedence", () => {
  const rules: R[] = [
    { id: "acct-1", agent_id: null },
    { id: "agent-rule", agent_id: "agent-1" },
    { id: "acct-2", agent_id: null },
  ];
  assertEquals(selectRulesForAgent(rules, "agent-1").map((r) => r.id), ["agent-rule", "acct-1", "acct-2"]);
});

Deno.test("selectRulesForAgent: multiple rules scoped to the same agent all stay visible, still ahead of account-wide ones", () => {
  const rules: R[] = [
    { id: "acct", agent_id: null },
    { id: "a1-first", agent_id: "agent-1" },
    { id: "a1-second", agent_id: "agent-1" },
  ];
  assertEquals(selectRulesForAgent(rules, "agent-1").map((r) => r.id), ["a1-first", "a1-second", "acct"]);
});

Deno.test("selectRulesForAgent: with no agent in context (agentId null/undefined), only account-wide rules apply", () => {
  const rules: R[] = [
    { id: "acct", agent_id: null },
    { id: "a1-only", agent_id: "agent-1" },
  ];
  assertEquals(selectRulesForAgent(rules, null).map((r) => r.id), ["acct"]);
  assertEquals(selectRulesForAgent(rules, undefined).map((r) => r.id), ["acct"]);
});

Deno.test("selectRulesForAgent: empty input is a valid empty result, not a crash", () => {
  assertEquals(selectRulesForAgent([] as R[], "agent-1"), []);
});
