// AUDIT 1 (Shared Criteria Library, 2026-10-06): the rule-matching
// primitives that decide what governs an agent or API key exist in FOUR
// independently-maintained copies across this codebase --
//   1. supabase/functions/_shared/rule-matching.ts   (canonical -- every
//      real enforcement path and the Outer Control /criteria endpoint
//      import this one directly)
//   2. src/lib/agent-policy.ts                        (client mirror, used
//      to render what governs an agent in the UI)
//   3. src/lib/coverage-gaps.ts                        (client mirror, used
//      to find ungoverned capabilities)
//   4. src/lib/rule-conflicts.ts                       (client mirror, used
//      to detect overlapping rules)
//
// Copies 2-4 exist only because the Vite frontend can't import a Deno edge
// function module directly at runtime -- but nothing EVER verified they
// stay byte-identical to copy 1. A future bugfix to the canonical glob
// escaping, or a behavior change in selectRulesForEntity's precedence,
// could land in the enforcement path while every UI mirror keeps showing
// the OLD behavior -- Inner Control and Outer Control would disagree on
// what governs the exact same action, with nothing to catch it.
//
// This test imports the canonical module directly via a relative path (it
// has zero imports of its own, confirmed by reading it -- no Deno-specific
// syntax to trip up Vite/Node) and diffs every mirror against it across a
// deliberately adversarial battery of cases. A hand-edited mirror that
// drifts from the canonical implementation fails THIS test, not silently.
//
// Run with the normal frontend suite: npx vitest run
import { describe, it, expect } from "vitest";
import {
  selectRulesForEntity as selectRulesForEntityCanonical,
  ruleMatchesAction as ruleMatchesActionCanonical,
  globToRe as globToReCanonical,
  type EntityScopedLike,
} from "../../supabase/functions/_shared/rule-matching.ts";
import { selectRulesForEntity as selectRulesForEntityMirror } from "@/lib/agent-policy";
import { globToRe as globToReCoverageMirror, ruleCovers } from "@/lib/coverage-gaps";
import { globToRe as globToReConflictMirror } from "@/lib/rule-conflicts";

// ---- glob-pattern battery: wildcards, regex-special characters, mixed
// case, empty string, consecutive wildcards, leading/trailing whitespace --
// every shape a real rule_text/action_type_pattern has actually used.
const PATTERN_BATTERY = [
  "*",
  "send_email",
  "send_*",
  "*_email",
  "send_*_external",
  "SEND_EMAIL", // case
  "  send_email  ", // whitespace
  "a.b+c?d^e$f{g}h(i)j|k[l]m\\n", // every regex special char rule-matching.ts escapes
  "**",
  "",
  "slack_post_message",
];

const ACTION_TYPE_BATTERY = [
  "send_email", "SEND_EMAIL", "send_email_external", "slack_post_message",
  "", "a.b+c?d^e$f{g}h(i)j|k[l]m\\n", "unrelated_action",
];

const PROVIDER_BATTERY = [null, "gmail", "GMAIL", "slack", ""];

describe("AUDIT 1: criteria-library parity -- glob matching stays identical across every mirror", () => {
  it("globToRe produces an identical regex (source + flags) in all three mirrors for every pattern in the battery", () => {
    for (const pattern of PATTERN_BATTERY) {
      const canonical = globToReCanonical(pattern);
      const coverageMirror = globToReCoverageMirror(pattern);
      const conflictMirror = globToReConflictMirror(pattern);
      expect(coverageMirror.source, `coverage-gaps.ts globToRe diverged on pattern ${JSON.stringify(pattern)}`).toBe(canonical.source);
      expect(coverageMirror.flags, `coverage-gaps.ts globToRe flags diverged on pattern ${JSON.stringify(pattern)}`).toBe(canonical.flags);
      expect(conflictMirror.source, `rule-conflicts.ts globToRe diverged on pattern ${JSON.stringify(pattern)}`).toBe(canonical.source);
      expect(conflictMirror.flags, `rule-conflicts.ts globToRe flags diverged on pattern ${JSON.stringify(pattern)}`).toBe(canonical.flags);
    }
  });

  it("ruleMatchesAction (canonical) and ruleCovers (coverage-gaps.ts mirror) agree on every (pattern, actionType, provider) triple", () => {
    let casesRun = 0;
    for (const pattern of PATTERN_BATTERY) {
      for (const actionType of ACTION_TYPE_BATTERY) {
        for (const provider of PROVIDER_BATTERY) {
          casesRun++;
          const canonicalResult = ruleMatchesActionCanonical({ action_type_pattern: pattern, provider }, actionType, provider ?? "");
          const mirrorResult = ruleCovers({ action_type_pattern: pattern, provider }, actionType, provider ?? "");
          expect(
            mirrorResult,
            `ruleCovers diverged from ruleMatchesAction for pattern=${JSON.stringify(pattern)} actionType=${JSON.stringify(actionType)} provider=${JSON.stringify(provider)}`,
          ).toBe(canonicalResult);
        }
      }
    }
    expect(casesRun).toBe(PATTERN_BATTERY.length * ACTION_TYPE_BATTERY.length * PROVIDER_BATTERY.length);
  });
});

describe("AUDIT 1: criteria-library parity -- entity-scoped rule selection stays identical between the canonical module and its client mirror", () => {
  type Rule = EntityScopedLike & { id: string };
  const rules: Rule[] = [
    { id: "account-wide-1", agent_id: null, api_key_id: null },
    { id: "agent-a-own", agent_id: "agent-a", api_key_id: null },
    { id: "agent-b-own", agent_id: "agent-b", api_key_id: null },
    { id: "key-x-own", agent_id: null, api_key_id: "key-x" },
    { id: "key-y-own", agent_id: null, api_key_id: "key-y" },
  ];

  const CASES: { kind: "agent" | "api_key" | null; id: string | null; label: string }[] = [
    { kind: "agent", id: "agent-a", label: "agent with its own rule" },
    { kind: "agent", id: "agent-c", label: "agent with no rule of its own" },
    { kind: "api_key", id: "key-x", label: "api key with its own rule" },
    { kind: "api_key", id: "key-z", label: "api key with no rule of its own" },
    { kind: null, id: null, label: "no entity in context (chat-driven)" },
  ];

  for (const { kind, id, label } of CASES) {
    it(`selectRulesForEntity: ${label} -- mirror matches canonical exactly, in the same order`, () => {
      const canonicalResult = selectRulesForEntityCanonical(rules, kind, id).map((r) => r.id);
      const mirrorResult = selectRulesForEntityMirror(rules as any, kind as any, id).map((r: Rule) => r.id);
      expect(mirrorResult, `agent-policy.ts selectRulesForEntity diverged for ${label}`).toEqual(canonicalResult);
    });
  }

  it("never leaks an api-key-scoped rule into an agent's visible set, or vice versa, in either copy", () => {
    const agentView = selectRulesForEntityCanonical(rules, "agent", "agent-a").map((r) => r.id);
    const keyView = selectRulesForEntityCanonical(rules, "api_key", "key-x").map((r) => r.id);
    expect(agentView).not.toContain("key-x-own");
    expect(agentView).not.toContain("key-y-own");
    expect(keyView).not.toContain("agent-a-own");
    expect(keyView).not.toContain("agent-b-own");

    const agentViewMirror = selectRulesForEntityMirror(rules as any, "agent" as any, "agent-a").map((r: Rule) => r.id);
    const keyViewMirror = selectRulesForEntityMirror(rules as any, "api_key" as any, "key-x").map((r: Rule) => r.id);
    expect(agentViewMirror).not.toContain("key-x-own");
    expect(keyViewMirror).not.toContain("agent-a-own");
  });
});
