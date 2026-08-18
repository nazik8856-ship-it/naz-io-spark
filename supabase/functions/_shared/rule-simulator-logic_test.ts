// Real tests for the rule simulator's pure verdict-combination logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/rule-simulator-logic_test.ts
import { projectVerdict } from "./rule-simulator-logic.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const clean = {
  liveRuleEffect: null,
  draftRuleMatches: false,
  draftRuleEffect: null,
  safetyMatched: false,
  safetySeverity: null,
} as const;

Deno.test("nothing matches anything: allow", () => {
  assertEquals(projectVerdict(clean), "allow");
});

Deno.test("a live hard rule (always_block) wins outright", () => {
  assertEquals(projectVerdict({ ...clean, liveRuleEffect: "always_block" }), "block");
});

Deno.test("a live hard rule (always_require_approval) requires approval", () => {
  assertEquals(projectVerdict({ ...clean, liveRuleEffect: "always_require_approval" }), "require_approval");
});

Deno.test("a live hard rule beats a draft rule that would ALSO block — the live rule is what's actually enforced today", () => {
  assertEquals(
    projectVerdict({ ...clean, liveRuleEffect: "always_require_approval", draftRuleMatches: true, draftRuleEffect: "always_block" }),
    "require_approval",
  );
});

Deno.test("a live hard rule beats the safety scanner too", () => {
  assertEquals(
    projectVerdict({ ...clean, liveRuleEffect: "always_require_approval", safetyMatched: true, safetySeverity: "block" }),
    "require_approval",
  );
});

Deno.test("no live rule: a matching draft rule decides", () => {
  assertEquals(projectVerdict({ ...clean, draftRuleMatches: true, draftRuleEffect: "always_block" }), "block");
});

Deno.test("a draft rule that does NOT match is ignored even if an effect is set", () => {
  assertEquals(projectVerdict({ ...clean, draftRuleMatches: false, draftRuleEffect: "always_block" }), "allow");
});

Deno.test("a draft rule beats the safety scanner", () => {
  assertEquals(
    projectVerdict({ ...clean, draftRuleMatches: true, draftRuleEffect: "always_require_approval", safetyMatched: true, safetySeverity: "block" }),
    "require_approval",
  );
});

Deno.test("no rules at all: the safety scanner decides", () => {
  assertEquals(projectVerdict({ ...clean, safetyMatched: true, safetySeverity: "block" }), "block");
  assertEquals(projectVerdict({ ...clean, safetyMatched: true, safetySeverity: "require_approval" }), "require_approval");
});
