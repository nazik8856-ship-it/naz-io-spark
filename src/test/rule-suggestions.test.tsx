// Inner Control Day 3 (#173): suggested rules from what happened. The same action stopped several times this week with no rule
// of the account behind it is offered as a rule; one tap opens the Add window with it drafted, and nothing is saved until Save.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));

import { suggestRules, SUGGEST_MIN_TIMES, type SuggestionDecision } from "@/lib/rule-suggestions";
import RuleSuggestions from "@/components/control/RuleSuggestions";
import AddRuleDialog from "@/components/control/AddRuleDialog";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const D = (decision: string, action_type: string | null, daysAgo = 1, hard_rule_id: string | null = null): SuggestionDecision =>
  ({ decision, action_type, hard_rule_id, created_at: at(daysAgo) });

describe("which suggestions are made", () => {
  it("an action held 3 times this week with no rule behind it is offered as a hold-for-approval rule", () => {
    const s = suggestRules([D("ESCALATE send_email (Gmail)", "send_email"), D("REQUIRE_APPROVAL send_email", "send_email"), D("APPROVAL_REQUIRED send_email", "send_email", 3)], [], { now: NOW });
    expect(s).toEqual([{
      action: "send_email", count: 3, blocked: 0, held: 3, changed: 0,
      line: "Sending email was held for approval 3 times this week, and no rule of yours made that call. Make it a rule?",
      draft: { text: "Hold sending email for my approval", scope: "send_email", effect: "always_require_approval", approvals: 1 },
    }]);
  });

  it("mostly blocked: the rule blocks; an action without a friendly name is quoted", () => {
    const s = suggestRules([D("BLOCK stripe_refund", "stripe_refund"), D("BLOCK stripe_refund", "stripe_refund"), D("MODIFY stripe_refund", "stripe_refund"), D("BLOCK stripe_refund", "stripe_refund")], [], { now: NOW });
    expect(s[0].line).toBe('"stripe_refund" was blocked 3 times, changed once this week, and no rule of yours made that call. Make it a rule?');
    expect(s[0].draft).toEqual({ text: 'Block "stripe_refund"', scope: "stripe_refund", effect: "always_block", approvals: 1 });
  });

  it("not suggested: fewer than 3, older than a week, decided by a rule, allowed, an answer check, an agent step", () => {
    expect(SUGGEST_MIN_TIMES).toBe(3);
    const x = "post_slack";
    expect(suggestRules([D("BLOCK", x), D("BLOCK", x)], [], { now: NOW })).toEqual([]);
    expect(suggestRules([D("BLOCK", x), D("BLOCK", x), D("BLOCK", x, 8)], [], { now: NOW })).toEqual([]);
    expect(suggestRules([D("BLOCK", x), D("BLOCK", x), D("BLOCK", x, 1, "h1")], [], { now: NOW })).toEqual([]);
    expect(suggestRules([D("BLOCK", x), D("BLOCK", x), D("ALLOW", x)], [], { now: NOW })).toEqual([]);
    expect(suggestRules([1, 2, 3].map(() => D("BLOCK text_review", "outer_control_text_review")), [], { now: NOW })).toEqual([]);
    expect(suggestRules([1, 2, 3].map(() => D('Call tool "web_search"', x)), [], { now: NOW })).toEqual([]);
  });

  it("not suggested when a rule (even one in shadow mode) already covers it, or after Not now; switched-off rules do not cover", () => {
    const three = [1, 2, 3].map(() => D("BLOCK", "slack_post"));
    expect(suggestRules(three, [{ action_type_pattern: "slack_*", enabled: true }], { now: NOW })).toEqual([]);
    expect(suggestRules(three, [{ action_type_pattern: "slack_*", enabled: false }], { now: NOW })).toHaveLength(1);
    expect(suggestRules(three, [], { now: NOW, dismissed: new Set(["slack_post"]) })).toEqual([]);
  });

  it("the most often stopped first, at most three", () => {
    const many = ["a1", "a2", "a3", "a4"].flatMap((a, i) => Array.from({ length: 3 + i }, () => D("BLOCK", a)));
    expect(suggestRules(many, [], { now: NOW }).map((s) => [s.action, s.count])).toEqual([["a4", 6], ["a3", 5], ["a2", 4]]);
  });
});

describe("on the page", () => {
  const s = suggestRules([1, 2, 3, 4].map(() => D("ESCALATE send_email", "send_email")), [], { now: NOW })[0];

  it("says how often it happened; Make it a rule and Not now; a role that can not add rules only sees Not now", () => {
    const onMake = vi.fn(); const onDismiss = vi.fn();
    const { rerender } = render(<RuleSuggestions suggestions={[s]} canWrite onMake={onMake} onDismiss={onDismiss} />);
    expect(screen.getByTestId("rule-suggestion").textContent).toMatch(/^This happened 4 times this week\. Sending email was held for approval 4 times/);
    fireEvent.click(screen.getByTestId("suggestion-make"));
    expect(onMake).toHaveBeenCalledWith(s);
    fireEvent.click(screen.getByTestId("suggestion-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith(s);
    rerender(<RuleSuggestions suggestions={[s]} canWrite={false} onMake={onMake} onDismiss={onDismiss} />);
    expect(screen.queryByTestId("suggestion-make")).toBeNull();
  });

  it("nothing to suggest: nothing shown", () => {
    const { container } = render(<RuleSuggestions suggestions={[]} canWrite onMake={() => {}} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("Make it a rule opens the Add window with the rule drafted, in shadow mode, and nothing saved", () => {
    render(<AddRuleDialog open onOpenChange={() => {}} accountId="u1" canWrite onSaved={() => {}} initial={{ kind: "action", hard: s.draft }} />);
    expect((screen.getByLabelText("Rule") as HTMLTextAreaElement).value).toBe("Hold sending email for my approval");
    expect((screen.getByLabelText("Applies to") as HTMLSelectElement).value).toBe("send_email");
    expect((screen.getByLabelText("Start in shadow mode") as HTMLInputElement).checked).toBe(true);
  });
});
