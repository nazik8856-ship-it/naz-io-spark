import { describe, expect, it } from "vitest";
import {
  chatStepLabels, countRules, needsTemplate, statusLine, toActivity, toRuleItems,
  type DecisionRow, type HardRuleRow, type SafetyRuleRow,
} from "@/lib/inner-control-ui";

const hard = (o: Partial<HardRuleRow> = {}): HardRuleRow => ({
  id: "h1", rule_text: "Never email more than 1 person", action_type_pattern: "send_email", effect: "always_block",
  enabled: true, shadow_mode: false, agent_id: null, required_approvals: null, created_at: "2026-10-01T00:00:00Z", ...o,
});
const safety = (o: Partial<SafetyRuleRow> = {}): SafetyRuleRow => ({
  id: "s1", name: "Competitor mentions", pattern: "(acme)", severity: "require_approval", redact: false, enabled: true,
  shadow_mode: false, agent_id: null, api_key_id: null, created_at: "2026-10-02T00:00:00Z", ...o,
});
const nm = () => "Bot";

describe("rule list", () => {
  it("merges hard and safety rules, newest first, with plain wording", () => {
    const items = toRuleItems([hard()], [safety()], nm);
    expect(items.map((i) => i.key)).toEqual(["safety:s1", "hard:h1"]);
    expect(items[1]).toMatchObject({ kind: "hard", status: "active", effect: "Always blocks", scope: "Sending email · All agents" });
    expect(items[0].effect).toBe("Needs approval on a match");
  });
  it("treats enabled=false as disabled and null as on", () => {
    const items = toRuleItems([hard({ enabled: false }), hard({ id: "h2", enabled: null })], [safety({ enabled: false })], nm);
    expect(items.filter((i) => i.status === "disabled")).toHaveLength(2);
    expect(items.find((i) => i.id === "h2")?.status).toBe("active");
  });
  it("lists rules that apply before disabled ones", () => {
    const items = toRuleItems([hard({ id: "old", created_at: "2026-09-01T00:00:00Z" })], [safety({ enabled: false })], nm);
    expect(items.map((i) => i.status)).toEqual(["active", "disabled"]);
  });
  it("names redaction and approver counts", () => {
    const items = toRuleItems(
      [hard({ effect: "always_require_approval", required_approvals: 1, agent_id: "a1" })],
      [safety({ redact: true, severity: "block" })], nm,
    );
    expect(items.find((i) => i.kind === "hard")?.effect).toBe("Needs approval (1 approver)");
    expect(items.find((i) => i.kind === "hard")?.scope).toContain("Bot");
    expect(items.find((i) => i.kind === "safety")?.effect).toBe("Removes the matched text");
  });
});

describe("counts and status line", () => {
  it("does not count shadow or disabled rules as enforcing", () => {
    const c = countRules(toRuleItems([hard(), hard({ id: "h2", shadow_mode: true }), hard({ id: "h3", enabled: false })], [safety()], nm));
    expect(c).toEqual({ enforcing: 2, shadow: 1, disabled: 1, total: 4 });
    expect(statusLine(c, 60)).toBe("2 rules active (+1 in shadow mode) – Coverage 60%");
  });
  it("is singular for one rule and honest when there is no coverage figure", () => {
    const c = countRules(toRuleItems([hard()], [], nm));
    expect(statusLine(c, null)).toBe("1 rule active – Coverage — (no connected capabilities yet)");
  });
  it("asks for a template only when there are no rules at all", () => {
    expect(needsTemplate(countRules([]))).toBe(true);
    expect(needsTemplate(countRules(toRuleItems([hard({ enabled: false })], [], nm)))).toBe(false);
  });
});

describe("recent activity", () => {
  const row = (o: Partial<DecisionRow> = {}): DecisionRow => ({
    id: "d1", created_at: "2026-10-03T00:00:00Z", decision: "block", source: "hard_rule", action_type: "send_email",
    description: "Send email to all customers", reasoning: "A hard rule always blocks this.", hard_rule_id: "h1", escalated: false, ...o,
  });
  it("links a decision to the rule that made it and writes the chat question", () => {
    const [a] = toActivity([row()], (id) => (id === "h1" ? "Never email more than 1 person" : null));
    expect(a).toMatchObject({ verdict: "Blocked", tone: "bad", ruleId: "h1", ruleName: "Never email more than 1 person" });
    expect(a.question).toBe('Why was "Send email to all customers" blocked?');
  });
  it("leaves the rule link out when the rule no longer exists", () => {
    const [a] = toActivity([row()], () => null);
    expect(a.ruleId).toBeNull();
  });
  it("maps the other verdicts and survives odd ones", () => {
    const out = toActivity([row({ decision: "allow" }), row({ decision: "deferred" }), row({ decision: "weird" })], () => null);
    expect(out.map((o) => o.tone)).toEqual(["ok", "warn", "warn"]);
    expect(out[2].verdict).toBe("weird");
  });
});

describe("chat live status", () => {
  it("states only what is happening and mentions dry run", () => {
    expect(chatStepLabels(3, false).working).toBe("Checking 3 active rules and scoring risk");
    expect(chatStepLabels(0, true).working).toContain("built-in safety checks");
    expect(chatStepLabels(1, true).working).toContain("dry run");
  });
});
