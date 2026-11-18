// Inner Control Day 1 (#168): one rule set everywhere. A rule added, edited, switched off or made in the chat is the same row every
// server path reads: agents (the gate, through the self-refreshing policy snapshot), Outer Control's answer check, the connection test,
// the Control API and the chat's own text review. This holds the page's "checked against N rules" to the server's choice, and guards
// the server filters so they can not drift apart.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checksTaskAnswers, taskAnswerRuleCount, TASK_ANSWER_ACTION, type HardRuleRow, type SafetyRuleRow } from "@/lib/inner-control-ui";
import { draftRow } from "@/components/control/RuleDraftCard";

const src = (p: string) => readFileSync(p, "utf8");
const hard = (o: Partial<HardRuleRow> = {}): HardRuleRow => ({
  id: "h", rule_text: "No prices", action_type_pattern: "*", effect: "always_block", enabled: true, shadow_mode: false, agent_id: null,
  api_key_id: null, provider: null, required_approvals: null, created_at: "2026-11-18T00:00:00Z", ...o,
});
const safety = (o: Partial<SafetyRuleRow> = {}): SafetyRuleRow => ({
  id: "s", name: "Prices", pattern: "price", severity: "block", redact: false, enabled: true, shadow_mode: false, agent_id: null,
  api_key_id: null, created_at: "2026-11-18T00:00:00Z", ...o,
});

describe("which rules check a chat Task's answers", () => {
  it("is the action the server checks every Outer answer as", () => {
    expect(src("supabase/functions/_shared/outer-control-text-review.ts")).toContain(`export const TEXT_REVIEW_ACTION_TYPE = "${TASK_ANSWER_ACTION}";`);
  });

  it("counts live, account-wide rules whose actions cover the answer check", () => {
    expect(checksTaskAnswers({ kind: "hard", row: hard() })).toBe(true);
    expect(checksTaskAnswers({ kind: "hard", row: hard({ action_type_pattern: "outer_control_*" }) })).toBe(true);
    expect(checksTaskAnswers({ kind: "hard", row: hard({ enabled: null }) })).toBe(true); // older rows: on, as the gate reads them
    expect(checksTaskAnswers({ kind: "safety", row: safety() })).toBe(true);
  });

  it("leaves out what the server leaves out", () => {
    expect(checksTaskAnswers({ kind: "hard", row: hard({ action_type_pattern: "send_email" }) })).toBe(false); // applies to sending email
    expect(checksTaskAnswers({ kind: "hard", row: hard({ shadow_mode: true }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "hard", row: hard({ enabled: false }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "hard", row: hard({ agent_id: "a1" }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "hard", row: hard({ api_key_id: "k1" }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "hard", row: hard({ provider: "openai" }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "safety", row: safety({ enabled: false }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "safety", row: safety({ shadow_mode: true }) })).toBe(false);
    expect(checksTaskAnswers({ kind: "safety", row: safety({ api_key_id: "k1" }) })).toBe(false);
    expect(taskAnswerRuleCount([hard(), hard({ action_type_pattern: "send_email" })], [safety(), safety({ enabled: false })])).toBe(2);
  });

  it("a rule made in the chat lands in the same set as one added by hand", () => {
    // The saved row, as the database stores it: `enabled` comes from the column default (true on both tables).
    const asRow = <T,>(d: Parameters<typeof draftRow>[0], shadow: boolean) => ({ id: "x", created_at: "", enabled: true, ...draftRow(d, "acct", shadow).row }) as unknown as T;
    const text = { type: "text" as const, name: "Prices", phrases: ["price"], pattern: "(?:price)", action: "block" as const };
    expect(checksTaskAnswers({ kind: "safety", row: asRow<SafetyRuleRow>(text, false) })).toBe(true);
    expect(checksTaskAnswers({ kind: "safety", row: asRow<SafetyRuleRow>(text, true) })).toBe(false); // shadow: watched, not enforced
    const any = { type: "action" as const, text: "Hold everything", scope: "*", effect: "always_require_approval" as const };
    expect(checksTaskAnswers({ kind: "hard", row: asRow<HardRuleRow>(any, false) })).toBe(true);
    expect(checksTaskAnswers({ kind: "hard", row: asRow<HardRuleRow>({ ...any, scope: "send_email" }, false) })).toBe(false);
  });
});

describe("the server paths read one rule set with the same filters", () => {
  it("custom text rules: only switched-on rows, scoped by agent or API key, shadow kept apart", () => {
    const s = src("supabase/functions/_shared/safety-scanner.ts");
    expect(s).toMatch(/\.from\("safety_rules"\)[\s\S]{0,200}\.eq\("enabled", true\)/);
    expect(s).toContain("selectRulesForEntity(custom, entity.kind, entity.id)");
    for (const f of ["outer-control-session.ts", "outer-control-text-review.ts", "projects.ts", "outer-control-workflow.ts"]) {
      expect(src(`supabase/functions/_shared/${f}`), f).toContain("loadSafetyRules(");
    }
  });

  it("action rules: the gate skips switched-off and shadow rules; Outer's answer check goes through the gate", () => {
    const g = src("supabase/functions/_shared/control-gate.ts");
    expect(g).toContain("enabled !== false");
    expect(g).toContain("!r.shadow_mode && ruleMatchesAction(r, actionType, provider)");
    expect(src("supabase/functions/_shared/outer-control-text-review.ts")).toContain("matchHardRule(admin, userId, TEXT_REVIEW_ACTION_TYPE");
    const sess = src("supabase/functions/_shared/outer-control-session.ts");
    expect((sess.match(/from\("hard_rules"\)[\s\S]{0,200}\.eq\("enabled", true\)/g) ?? []).length).toBe(2); // rule lines + contact check
  });

  it("an edit reaches agents at once: the policy snapshot rebuilds after any rule change", () => {
    const fn = src("supabase/migrations/20260930061428_self_heal_stale_policy_snapshot_v3.sql");
    expect(fn).toContain("cc.table_name IN ('hard_rules', 'safety_rules')");
    expect(fn).toContain("SET snapshot = public.build_policy_snapshot(_user_id)");
  });
});
