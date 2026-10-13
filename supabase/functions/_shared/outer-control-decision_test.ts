// Run with: deno test --allow-env supabase/functions/_shared/outer-control-decision_test.ts
import { decideExternalText } from "./outer-control-decision.ts";
import { BUILTIN_SAFETY_RULES, type SafetyRule } from "./safety-scanner.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const custom = (over: Partial<SafetyRule>): SafetyRule => ({
  id: "r1", name: "Custom", category: "custom", pattern: "internal-only", severity: "require_approval",
  enabled: true, builtin: false, ...over,
});

const KEY = "sk-" + "a".repeat(24);
const CARD = "4111111111111111";

// ---- allow / block / escalate ---------------------------------------------

Deno.test("clean text -> allow, text returned unchanged, use_output", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, "Your order ships on Monday.");
  assertEquals(d.verdict, "allow");
  assertEquals(d.output, "Your order ships on Monday.");
  assertEquals(d.nextStep, "use_output");
  assertEquals(d.changes, []);
});

Deno.test("destructive wording -> block, no output, discard", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, "Sure, I will drop table customers now.");
  assertEquals(d.verdict, "block");
  assertEquals(d.output, null);
  assertEquals(d.nextStep, "discard");
});

Deno.test("approval-level match only -> escalate, no output, await_approval", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, "I will refund the customer right away.");
  assertEquals(d.verdict, "escalate");
  assertEquals(d.output, null);
  assertEquals(d.nextStep, "await_approval");
});

Deno.test("a block match outranks an approval match", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, "Refund everyone, then drop table orders.");
  assertEquals(d.verdict, "block");
});

// ---- modify ----------------------------------------------------------------

Deno.test("a secret -> modify, key removed, change reported, re-verified", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, `Use this key ${KEY} to connect.`);
  assertEquals(d.verdict, "modify");
  assert(!d.output!.includes(KEY), "the key must not be in the output");
  assert(d.output!.includes("[REDACTED:secrets]"), "placeholder expected");
  assertEquals(d.changes.length, 1);
  assertEquals(d.changes[0].count, 1);
  assertEquals(d.changes[0].name, "API key or secret in payload");
  assertEquals(d.nextStep, "use_output");
  assert(/re-checked/.test(d.summary), "summary says the cleaned text was re-checked");
});

Deno.test("every occurrence is removed and counted", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, `a ${KEY} b ${KEY} c`);
  assertEquals(d.verdict, "modify");
  assertEquals(d.changes[0].count, 2);
});

Deno.test("two different rules both report their own change", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, `card ${CARD} and key ${KEY}`);
  assertEquals(d.verdict, "modify");
  assertEquals(d.changes.length, 2);
});

// ---- the verdict-engine bug: secret + approval-level wording ------------------

Deno.test("secret + refund wording -> escalate, NOT modify (the approval-level part cannot be cut out)", () => {
  const d = decideExternalText(BUILTIN_SAFETY_RULES, `I will refund them. The key is ${KEY}.`);
  assertEquals(d.verdict, "escalate");
  assertEquals(d.output, null);
  assertEquals(d.nextStep, "await_approval");
});

// ---- the redaction bug: a skipped redaction must never be returned as "modify" -----

Deno.test("an unsafe custom pattern that cannot be applied -> block, never an unredacted 'modify'", () => {
  const rule = custom({ id: "bad", name: "Order digits", category: "pii", severity: "block", pattern: "(\\d+)+$" });
  const d = decideExternalText([rule], "Reference 12345");
  assertEquals(d.verdict, "block");
  assertEquals(d.output, null);
  assertEquals(d.redactionFailed, true);
  assertEquals(d.nextStep, "discard");
});

Deno.test("one rule redacts, another cannot be applied -> block (nothing is released half-cleaned)", () => {
  const bad = custom({ id: "bad", name: "Bad", category: "pii", severity: "block", pattern: "(\\d+)+$" });
  const d = decideExternalText([...BUILTIN_SAFETY_RULES, bad], `key ${KEY} ref 123`);
  assertEquals(d.verdict, "block");
  assertEquals(d.output, null);
});

// ---- custom rules ------------------------------------------------------------

Deno.test("a custom block rule WITHOUT redact -> block", () => {
  const rule = custom({ severity: "block", pattern: "internal-only" });
  assertEquals(decideExternalText([rule], "This is internal-only data").verdict, "block");
});

Deno.test("a custom block rule WITH redact -> modify, only the matched text removed", () => {
  const rule = custom({ id: "c1", name: "Project codename", severity: "block", pattern: "project\\s+falcon", redact: true });
  const d = decideExternalText([rule], "We shipped Project Falcon last week. Thanks!");
  assertEquals(d.verdict, "modify");
  assertEquals(d.output, "We shipped [REDACTED:custom] last week. Thanks!");
  assertEquals(d.changes[0].name, "Project codename");
});

Deno.test("a custom require_approval rule -> escalate", () => {
  const rule = custom({ severity: "require_approval", pattern: "internal-only" });
  assertEquals(decideExternalText([rule], "This is internal-only data").verdict, "escalate");
});

// ---- shadow rules ------------------------------------------------------------

Deno.test("a shadow-mode block rule is observed, never enforced", () => {
  const rule = custom({ id: "s1", severity: "block", pattern: "internal-only", shadow_mode: true });
  const d = decideExternalText([rule], "This is internal-only data");
  assertEquals(d.verdict, "allow");
  assertEquals(d.output, "This is internal-only data");
  assertEquals(d.matches.length, 0);
  assertEquals(d.shadowMatches.length, 1);
  assertEquals(d.shadowMatches[0].rule_id, "s1");
});

Deno.test("a live rule still fires when a shadow rule also exists", () => {
  const shadow = custom({ id: "s1", severity: "block", pattern: "alpha", shadow_mode: true });
  const live = custom({ id: "l1", severity: "block", pattern: "beta" });
  const d = decideExternalText([shadow, live], "alpha and beta");
  assertEquals(d.verdict, "block");
  assertEquals(d.shadowMatches.length, 1);
});

// ---- trust score ---------------------------------------------------------------

Deno.test("trust score reflects live matches only", () => {
  assertEquals(decideExternalText(BUILTIN_SAFETY_RULES, "hello").trustScore, 100);
  assertEquals(decideExternalText(BUILTIN_SAFETY_RULES, `x ${KEY}`).trustScore, 60);
});
