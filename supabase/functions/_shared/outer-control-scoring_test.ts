// Run with: deno test --allow-env supabase/functions/_shared/outer-control-scoring_test.ts
import { computeTrustScore, decideVerdict, isRedactableMatch, redactContent } from "./outer-control-scoring.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- isRedactableMatch ------------------------------------------------------

Deno.test("isRedactableMatch: a block-severity secrets match is redactable", () => {
  assertEquals(isRedactableMatch({ severity: "block", category: "secrets" }), true);
});

Deno.test("isRedactableMatch: a block-severity pii match is redactable", () => {
  assertEquals(isRedactableMatch({ severity: "block", category: "pii" }), true);
});

Deno.test("isRedactableMatch: a block-severity destructive match is NOT redactable", () => {
  assertEquals(isRedactableMatch({ severity: "block", category: "destructive" }), false);
});

Deno.test("isRedactableMatch: a require_approval secrets match is not redactable (redaction is only ever a block-severity concern)", () => {
  assertEquals(isRedactableMatch({ severity: "require_approval", category: "secrets" }), false);
});

// ---- computeTrustScore -------------------------------------------------------

Deno.test("computeTrustScore: no matches scores 100", () => {
  assertEquals(computeTrustScore([]), 100);
});

Deno.test("computeTrustScore: a require_approval match costs 20", () => {
  assertEquals(computeTrustScore([{ severity: "require_approval" }]), 80);
});

Deno.test("computeTrustScore: a block match costs 40", () => {
  assertEquals(computeTrustScore([{ severity: "block" }]), 60);
});

Deno.test("computeTrustScore: never goes below 0", () => {
  assertEquals(computeTrustScore([{ severity: "block" }, { severity: "block" }, { severity: "block" }]), 0);
});

// ---- decideVerdict -------------------------------------------------------

Deno.test("decideVerdict: no matches -> allow", () => {
  assertEquals(decideVerdict([]), "allow");
});

Deno.test("decideVerdict: only a require_approval match -> escalate", () => {
  assertEquals(decideVerdict([{ severity: "require_approval", category: "financial" }]), "escalate");
});

Deno.test("decideVerdict: a redactable block match (secrets) -> modify", () => {
  assertEquals(decideVerdict([{ severity: "block", category: "secrets" }]), "modify");
});

Deno.test("decideVerdict: a non-redactable block match (destructive) -> block", () => {
  assertEquals(decideVerdict([{ severity: "block", category: "destructive" }]), "block");
});

Deno.test("decideVerdict: block wins over require_approval when both are present", () => {
  assertEquals(
    decideVerdict([{ severity: "require_approval", category: "financial" }, { severity: "block", category: "destructive" }]),
    "block",
  );
});

Deno.test("decideVerdict: one non-redactable block match among several block matches still forces a hard block", () => {
  assertEquals(
    decideVerdict([{ severity: "block", category: "secrets" }, { severity: "block", category: "destructive" }]),
    "block",
  );
});

Deno.test("decideVerdict: multiple redactable block matches together still -> modify", () => {
  assertEquals(
    decideVerdict([{ severity: "block", category: "secrets" }, { severity: "block", category: "pii" }]),
    "modify",
  );
});

// ---- redactContent -------------------------------------------------------

Deno.test("redactContent: replaces every occurrence of a redactable pattern", () => {
  const content = "Here is my key sk-1234567890abcdef and again sk-1234567890abcdef.";
  const redacted = redactContent(content, [{ pattern: "sk-[A-Za-z0-9]{16,}", category: "secrets" }]);
  assertEquals(redacted, "Here is my key [REDACTED:secrets] and again [REDACTED:secrets].");
});

Deno.test("redactContent: leaves a non-redactable category's matches untouched", () => {
  const content = "Please delete all customer records now.";
  const redacted = redactContent(content, [{ pattern: "delete all", category: "destructive" }]);
  assertEquals(redacted, content);
});

Deno.test("redactContent: an invalid regex pattern is skipped, never throws", () => {
  const content = "some content";
  const redacted = redactContent(content, [{ pattern: "(unclosed", category: "secrets" }]);
  assertEquals(redacted, content);
});

Deno.test("redactContent: applies multiple rules in sequence", () => {
  const content = "card 4111111111111111 and key sk-1234567890abcdef";
  const redacted = redactContent(content, [
    { pattern: "\\b4[0-9]{12}(?:[0-9]{3})?\\b", category: "pii" },
    { pattern: "sk-[A-Za-z0-9]{16,}", category: "secrets" },
  ]);
  assertEquals(redacted, "card [REDACTED:pii] and key [REDACTED:secrets]");
});

// ---- AUDIT 3 (Output Modification & Repair Engine, 2026-10-07): adversarial
// custom-safety-rule patterns -- found by actually running them, not by
// inspection. ControlSafetyRules.tsx only ever checks a custom pattern
// PARSES (`new RegExp(pattern)`), never that it's safe to run, so both of
// these are real, user-reachable inputs, not contrived edge cases.
// ---------------------------------------------------------------------------

Deno.test("redactContent: a literal empty pattern is rejected, not spliced into every character boundary", () => {
  const content = "hello world, this is fine content";
  const redacted = redactContent(content, [{ pattern: "", category: "secrets" }]);
  assertEquals(redacted, content, "an empty pattern must never touch the content at all");
});

Deno.test("redactContent: '.*' (matches the empty string) is rejected, not just '.+'", () => {
  const content = "some perfectly fine text";
  const redacted = redactContent(content, [{ pattern: ".*", category: "pii" }]);
  assertEquals(redacted, content);
});

Deno.test("redactContent: '\\\\d*' (an easy, non-malicious authoring mistake -- 0-or-more, not 1-or-more) is rejected", () => {
  const content = "call 555-1234 now";
  const redacted = redactContent(content, [{ pattern: "\\d*", category: "pii" }]);
  assertEquals(redacted, content);
});

Deno.test("redactContent: a classic catastrophic-backtracking pattern resolves immediately instead of hanging", () => {
  const content = "a".repeat(50) + "!";
  const start = Date.now();
  const redacted = redactContent(content, [{ pattern: "(a+)+$", category: "secrets" }]);
  const elapsed = Date.now() - start;
  assertEquals(redacted, content, "a rejected pattern must leave content untouched");
  if (elapsed > 500) throw new Error(`expected the dangerous pattern to be rejected near-instantly, took ${elapsed}ms`);
});

Deno.test("redactContent: a dangerous pattern alongside a legitimate one -- the legitimate one still redacts", () => {
  const content = "a".repeat(50) + "! key sk-1234567890abcdef";
  const redacted = redactContent(content, [
    { pattern: "(a+)+$", category: "secrets" },
    { pattern: "sk-[A-Za-z0-9]{16,}", category: "secrets" },
  ]);
  assertEquals(redacted, "a".repeat(50) + "! key [REDACTED:secrets]");
});
