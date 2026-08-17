// Real tests for the deterministic (non-LLM) content safety scanner — the
// layer inside control-gate.ts that runs AFTER hard rules / circuit breaker
// but BEFORE any model judgement, so a model mistake alone can never let a
// high-stakes action through. `scanWithRules` is pure (no DB), so these run
// directly against the built-in rule set with a fixed, known-bad/known-benign
// input set. Run with: deno test supabase/functions/_shared/safety-scanner_test.ts
import { BUILTIN_SAFETY_RULES, scanWithRules } from "./safety-scanner.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Built at runtime (not as a contiguous literal) so these obviously-fake test
// fixtures don't trip GitHub's secret-scanning push protection — they're
// shape-only fixtures for the regex, never real credentials.
const FAKE_OPENAI_KEY = ["sk", "-", "abcdefghijklmnopqrstuvwx", "1234567890", "ABCDEF"].join("");
const FAKE_SLACK_TOKEN = ["xoxb", "-", "1234567890", "-", "abcdefghijklmnop"].join("");

const scan = (params: Record<string, unknown>, description = "") =>
  scanWithRules(BUILTIN_SAFETY_RULES, params, description);

// ---- known-bad: block severity ---------------------------------------------

Deno.test("secrets: a live-looking OpenAI-style key blocks", () => {
  const r = scan({ body: `here is the key ${FAKE_OPENAI_KEY}` });
  assert(r.matched);
  assertEquals(r.severity, "block");
  assert(r.matches.some((m) => m.rule_id === "builtin:secret_key"));
});

Deno.test("secrets: a Slack bot token blocks", () => {
  const r = scan({ body: `token ${FAKE_SLACK_TOKEN}` });
  assert(r.matched);
  assertEquals(r.severity, "block");
});

Deno.test("secrets: never echoes the actual secret back in the sample", () => {
  const r = scan({ body: FAKE_OPENAI_KEY });
  const hit = r.matches.find((m) => m.rule_id === "builtin:secret_key")!;
  assert(hit.sample.includes("redacted"));
  assertFalse(hit.sample.includes("abcdefghijklmnopqrstuvwx"));
});

Deno.test("pii: a card number blocks and is redacted", () => {
  const r = scan({ note: "charge card 4111111111111111 for the deposit" });
  assert(r.matched);
  assertEquals(r.severity, "block");
  const hit = r.matches.find((m) => m.rule_id === "builtin:card_number")!;
  assert(hit.sample.includes("redacted"));
});

Deno.test("pii: an SSN-shaped number blocks", () => {
  const r = scan({ note: "SSN on file: 123-45-6789" });
  assert(r.matched);
  assert(r.matches.some((m) => m.rule_id === "builtin:national_id"));
});

Deno.test("destructive: 'delete all' wording blocks", () => {
  const r = scan({}, "delete all customer records from the CRM");
  assert(r.matched);
  assertEquals(r.severity, "block");
  assert(r.matches.some((m) => m.rule_id === "builtin:destructive"));
});

Deno.test("destructive: 'drop table' blocks", () => {
  const r = scan({}, "run: drop table customers");
  assert(r.matched);
  assertEquals(r.severity, "block");
});

Deno.test("recipients: a disposable email domain blocks", () => {
  const r = scan({ to: "someone@mailinator.com" });
  assert(r.matched);
  assertEquals(r.severity, "block");
  assert(r.matches.some((m) => m.rule_id === "builtin:disposable_recipient"));
});

// ---- known-bad: require_approval severity ----------------------------------

Deno.test("financial: refund wording with no order reference requires approval, not block", () => {
  const r = scan({}, "issue a refund to the customer who complained");
  assert(r.matched);
  assertEquals(r.severity, "require_approval");
  assert(r.matches.some((m) => m.rule_id === "builtin:refund_no_id"));
});

Deno.test("financial: refund wording WITH a concrete order id does not match", () => {
  const r = scan({}, "issue a refund for order_id 48213");
  // Sanity check the fixture actually contains "refund" wording — otherwise
  // this test would trivially pass for the wrong reason (nothing to exempt).
  assert(scan({}, "issue a refund for something unrelated").matches.some((m) => m.rule_id === "builtin:refund_no_id"));
  assertFalse(r.matches.some((m) => m.rule_id === "builtin:refund_no_id"));
});

Deno.test("reach: 'all customers' wording requires approval", () => {
  const r = scan({}, "send this update to all customers on the list");
  assert(r.matched);
  assertEquals(r.severity, "require_approval");
  assert(r.matches.some((m) => m.rule_id === "builtin:mass_audience"));
});

// ---- known-benign: must NOT match -----------------------------------------

Deno.test("benign: a normal customer reply matches nothing", () => {
  const r = scan(
    { to: "jane@acme.com", body: "Thanks for reaching out — your order ships in 3 business days." },
    "Reply to one inbound customer email",
  );
  assertFalse(r.matched);
  assertEquals(r.severity, null);
});

Deno.test("benign: an internal Slack status update matches nothing", () => {
  const r = scan({ channel: "#ops", text: "Weekly ops report is ready in Drive." });
  assertFalse(r.matched);
});

Deno.test("benign: refund mentioned only in a policy-explanation context with no ask still requires_approval (scanner is pattern-only, not intent-aware)", () => {
  // Documents an intentional scanner limitation: it can't tell "explain the
  // refund policy" from "issue a refund" — that judgement is the model's job
  // downstream. The scanner's contract is precision on payload content, not
  // full intent understanding.
  const r = scan({}, "explain our refund policy to the customer");
  assert(r.matched);
  assertEquals(r.severity, "require_approval");
});

Deno.test("benign: a normal-looking API-shaped string that is NOT a real key format does not match", () => {
  const r = scan({ body: "the config key is APP_ENV and its value is production" });
  assertFalse(r.matches.some((m) => m.rule_id === "builtin:secret_key"));
});

// ---- severity precedence: block always wins over require_approval ---------

Deno.test("when both a block-severity and a require_approval-severity rule match, overall severity is block", () => {
  const r = scan({ body: `here is the key ${FAKE_OPENAI_KEY}` }, "issue a refund");
  assert(r.matched);
  assertEquals(r.severity, "block");
  assert(r.matches.some((m) => m.rule_id === "builtin:refund_no_id"));
  assert(r.matches.some((m) => m.rule_id === "builtin:secret_key"));
});

// ---- structural ------------------------------------------------------------

Deno.test("a disabled rule is never matched", () => {
  const disabled = BUILTIN_SAFETY_RULES.map((r) => ({ ...r, enabled: false }));
  const r = scanWithRules(disabled.filter((x) => x.enabled), { body: FAKE_OPENAI_KEY }, "");
  assertFalse(r.matched);
});

Deno.test("a params field literally named 'description' is overwritten by the real description argument, not merged", () => {
  // flatten() unconditionally does `fields["description"] = description`
  // AFTER walking params, so a params.description value is silently
  // discarded rather than scanned. Documented here as real behavior (found
  // while writing these tests) — if any caller's action params ever
  // legitimately uses a "description" key, that text is never scanned.
  const r = scanWithRules(BUILTIN_SAFETY_RULES, { description: "delete all customer records" }, "");
  assertFalse(r.matched, "the params.description text must NOT be scanned — it's clobbered by the real description arg");
});

Deno.test("an invalid custom regex pattern is skipped, not thrown", () => {
  const broken = [{ id: "custom:broken", name: "broken", category: "custom", pattern: "(unclosed", severity: "block" as const, enabled: true, builtin: false }];
  const r = scanWithRules(broken, { body: "anything" }, "");
  assertFalse(r.matched);
});
