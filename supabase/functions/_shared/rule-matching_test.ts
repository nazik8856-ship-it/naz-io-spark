// Real tests for the shared hard-rule matcher, extracted from control-gate.ts
// so it's used identically by both the real gate and the rule simulator.
//
// Run with: deno test --allow-none supabase/functions/_shared/rule-matching_test.ts
import { globToRe, ruleMatchesAction } from "./rule-matching.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
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
