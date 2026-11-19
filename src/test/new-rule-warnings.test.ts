// Inner Control Day 2 (#170): a rule being added is checked against the rules already there. A repeat, an overlap or a contradiction
// is warned about, naming the other rule; it never blocks the save. Deterministic: the gate's glob, the scanner's regex.
import { describe, it, expect } from "vitest";
import { hardConflicts, textConflicts } from "@/lib/new-rule-warnings";
import { phrasesPattern } from "@/lib/rule-phrases";
import type { HardRuleRow, SafetyRuleRow } from "@/lib/inner-control-ui";

const hard = (id: string, rule_text: string, action_type_pattern: string, effect: HardRuleRow["effect"], over: Partial<HardRuleRow> = {}): HardRuleRow =>
  ({ id, rule_text, action_type_pattern, effect, enabled: true, shadow_mode: false, agent_id: null, required_approvals: null, created_at: "2026-10-01", ...over });
const safety = (id: string, name: string, pattern: string, severity: SafetyRuleRow["severity"], redact = false, over: Partial<SafetyRuleRow> = {}): SafetyRuleRow =>
  ({ id, name, pattern, severity, redact, enabled: true, shadow_mode: false, agent_id: null, api_key_id: null, created_at: "2026-10-01", ...over });
const draft = (scope: string, effect: HardRuleRow["effect"]) => ({ text: "New rule", scope, effect, approvals: 1 });

describe("action rules", () => {
  const rules = [
    hard("h1", "Never email customers", "send_email", "always_block"),
    hard("h2", "Hold every payment", "payment_*", "always_require_approval", { shadow_mode: true }),
    hard("h3", "Hold everything", "*", "always_require_approval", { enabled: false }),
    hard("h4", "Read files freely", "read_file", "always_block", { agent_id: "a1" }),
  ];

  it("the same actions and outcome: a duplicate; the same actions, another outcome: a contradiction where the older rule decides", () => {
    expect(hardConflicts(draft("Send_Email", "always_block"), rules)[0]).toEqual({ kind: "duplicate", id: "h1", name: "Never email customers", line: "Same as your rule “Never email customers”: it already blocks send_email." });
    const c = hardConflicts(draft("send_email", "always_require_approval"), rules);
    expect(c[0]).toEqual({ kind: "contradicts", id: "h1", name: "Never email customers",
      line: "Your rule “Never email customers” blocks send_email; this one would hold them for approval. When both match, the older rule is used, so it decides." });
    // The switched-off catch-all has the draft's outcome: an overlap, said to be off.
    expect(c.find((x) => x.id === "h3")?.kind).toBe("overlaps");
    expect(hardConflicts(draft("send_email", "always_block"), [rules[2]])[0].line).toBe(
      "Your rule “Hold everything” (switched off) holds every action for approval; this one would block send_email.");
  });

  it("a wider or narrower rule is an overlap, with its state; a rule for one AI says so", () => {
    const wide = hardConflicts(draft("payment_refund", "always_require_approval"), rules);
    expect(wide.map((w) => [w.kind, w.id])).toEqual([["overlaps", "h2"], ["overlaps", "h3"]]);
    expect(wide[0].line).toBe("Your rule “Hold every payment” (in shadow mode) already covers payment_refund, as it applies to payment_*.");
    expect(wide[1].line).toBe("Your rule “Hold everything” (switched off) already covers payment_refund, as it applies to every action.");
    const all = hardConflicts(draft("*", "always_block"), rules);
    expect(all.map((w) => [w.kind, w.id])).toEqual([["contradicts", "h3"], ["overlaps", "h1"], ["overlaps", "h2"]]);
    expect(hardConflicts(draft("read_*", "always_require_approval"), rules).find((w) => w.id === "h4")?.line).toBe(
      "This rule also covers read_file, which your rule “Read files freely” blocks.");
    expect(hardConflicts(draft("read_file", "always_require_approval"), rules).find((w) => w.id === "h4")?.line).toMatch(/For the AI it is set for, that rule is used\.$/);
  });

  it("nothing in common: no warning", () => {
    expect(hardConflicts(draft("delete_record", "always_block"), rules.slice(0, 2))).toEqual([]);
  });
});

describe("text rules", () => {
  const rules = [
    safety("s1", "Prices", phrasesPattern(["price", "discount"]), "block", true),
    safety("s2", "Card numbers", "\\b\\d{16}\\b", "block"),
    safety("s3", "Anything", ".*", "block"),
  ];
  const t = (words: string[], action: "block" | "approval" | "redact") => ({ name: "x", pattern: phrasesPattern(words), action });

  it("the same pattern: a duplicate or a contradiction", () => {
    expect(textConflicts(t(["price", "discount"], "redact"), ["price", "discount"], rules)[0].kind).toBe("duplicate");
    expect(textConflicts(t(["price", "discount"], "approval"), ["price", "discount"], rules)[0].line).toBe(
      "Your rule “Prices” looks for the same text but removes the matching text; this one holds the reply for approval.");
  });

  it("words an existing rule already catches: named; an unsafe existing pattern is skipped, as the scanner skips it", () => {
    const w = textConflicts(t(["price", "refund"], "redact"), ["price", "refund"], rules);
    expect(w).toEqual([{ kind: "overlaps", id: "s1", name: "Prices", line: "Your rule “Prices” already catches “price”." }]);
    expect(textConflicts(t(["discount"], "block"), ["discount"], rules)[0]).toMatchObject({ kind: "contradicts", id: "s1" });
    expect(textConflicts(t(["refund"], "block"), ["refund"], rules)).toEqual([]);
  });

  it("an advanced pattern is only compared as a whole", () => {
    expect(textConflicts({ name: "x", pattern: "refunds?", action: "block" }, [], rules)).toEqual([]);
  });
});
