// Inner Control Day 2 (#163): one Add rule window. It asks what the rule should do, then only what that kind needs, with the same
// checks as Edit; a text rule is written from plain words (the same pattern builder as the chat); a new rule starts in shadow mode;
// a write the database refused is said.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { join } from "node:path";

const db = vi.hoisted(() => ({ inserts: [] as { table: string; row: Record<string, unknown> }[], reply: { data: [{ id: "new" }], error: null } as { data: unknown; error: unknown } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => ({ insert: (row: Record<string, unknown>) => { db.inserts.push({ table, row }); return { select: async () => db.reply }; } }) },
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast }));

import AddRuleDialog, { newRuleRow, textRuleOf } from "@/components/control/AddRuleDialog";
import { phrasesFrom, phrasesPattern } from "@/lib/rule-phrases";

const open = (over: Partial<Parameters<typeof AddRuleDialog>[0]> = {}) => {
  const onSaved = vi.fn(); const onOpenChange = vi.fn();
  render(<AddRuleDialog open onOpenChange={onOpenChange} accountId="acct" canWrite onSaved={onSaved} fallback={<div data-testid="old-editor" />} {...over} />);
  return { onSaved, onOpenChange };
};

describe("the Add rule window", () => {
  beforeEach(() => { db.inserts = []; db.reply = { data: [{ id: "new" }], error: null }; toast.mockClear(); });

  it("starts with what the rule should do; the old editor is a fallback", () => {
    open();
    expect(screen.getByText("What should this rule do?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("add-rule-fallback"));
    expect(screen.getByTestId("old-editor")).toBeTruthy();
  });

  it("an action rule: refused with the reason until it is complete, then written to hard_rules in shadow mode", async () => {
    const { onSaved, onOpenChange } = open();
    fireEvent.click(screen.getByTestId("add-kind-action"));
    fireEvent.click(screen.getByTestId("add-rule-save"));
    expect(screen.getByTestId("add-rule-problem").textContent).toBe("Describe the rule in a few words.");
    expect(db.inserts).toEqual([]);
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "Never email customers without my approval" } });
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "send_email" } });
    fireEvent.change(screen.getByLabelText("Approvals needed"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("add-rule-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(db.inserts).toEqual([{ table: "hard_rules", row: {
      user_id: "acct", rule_text: "Never email customers without my approval", action_type_pattern: "send_email",
      effect: "always_require_approval", required_approvals: 2, shadow_mode: true, agent_id: null,
    } }]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a text rule from plain words: the pattern is built for the person, a name is made, live when shadow is switched off", async () => {
    open();
    fireEvent.click(screen.getByTestId("add-kind-text"));
    fireEvent.change(screen.getByLabelText("Words to look for"), { target: { value: "Price, discount, €, price" } });
    fireEvent.change(screen.getByLabelText("On a match"), { target: { value: "redact" } });
    fireEvent.click(screen.getByLabelText("Start in shadow mode"));
    fireEvent.click(screen.getByTestId("add-rule-save"));
    await waitFor(() => expect(db.inserts).toHaveLength(1));
    expect(db.inserts[0]).toEqual({ table: "safety_rules", row: {
      user_id: "acct", name: "Mentions price, discount, €", pattern: phrasesPattern(["price", "discount", "€"]),
      severity: "block", redact: true, category: "custom", shadow_mode: false, agent_id: null, api_key_id: null,
    } });
  });

  it("no words: says what is missing; an advanced pattern is checked like on the safety rules page", () => {
    open();
    fireEvent.click(screen.getByTestId("add-kind-text"));
    fireEvent.click(screen.getByTestId("add-rule-save"));
    expect(screen.getByTestId("add-rule-problem").textContent).toBe("Type the words or phrases the rule should look for.");
    fireEvent.click(screen.getByTestId("add-rule-advanced"));
    fireEvent.change(screen.getByLabelText("Text pattern"), { target: { value: ".*" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anything" } });
    fireEvent.click(screen.getByTestId("add-rule-save"));
    expect(screen.getByTestId("add-rule-problem").textContent).toMatch(/matches empty text/);
    expect(db.inserts).toEqual([]);
  });

  it("a write the database refused (no row) is said, never shown as added", async () => {
    db.reply = { data: [], error: null };
    const { onSaved } = open();
    fireEvent.click(screen.getByTestId("add-kind-action"));
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "Hold every action" } });
    fireEvent.click(screen.getByTestId("add-rule-save"));
    expect((await screen.findByTestId("add-rule-error")).textContent).toMatch(/Nothing was changed/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a role that can not add rules sees why, and no choice is open", () => {
    open({ canWrite: false });
    expect(screen.getByText(/Your role can not add rules/)).toBeTruthy();
    expect((screen.getByTestId("add-kind-action") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the pure parts", () => {
  it("words: cleaned, lowercased, no repeats, single symbols kept, at most 12", () => {
    expect(phrasesFrom("Price,discount\n€,a,price")).toEqual(["price", "discount", "€"]);
    expect(phrasesFrom(Array.from({ length: 20 }, (_, i) => `word${i}`).join(","))).toHaveLength(12);
  });
  it("the browser's pattern builder is the chat's (server) one", async () => {
    (globalThis as unknown as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } };
    const server = await import(/* @vite-ignore */ join(__dirname, "../..", "supabase/functions/_shared/inner-chat-rule.ts"));
    for (const words of [["price"], ["price", "discount", "€"], ["sale price", "50% off", "c++"], ["$", "ab("]]) {
      expect(phrasesPattern(words), words.join("|")).toBe(server.phrasesPattern(words));
    }
    const re = new RegExp(phrasesPattern(["price", "€"]), "i");
    expect(re.test("Our PRICE is 5 €")).toBe(true);
    expect(re.test("priceless")).toBe(false);
  });
  it("the rows written are the columns Edit writes, plus owner and shadow", () => {
    expect(newRuleRow("text", textRuleOf({ name: "", words: "refund", advanced: false, pattern: "", action: "approval" }), "a", true)).toEqual({
      table: "safety_rules", row: { user_id: "a", name: "Mentions refund", pattern: phrasesPattern(["refund"]), severity: "require_approval", redact: false, category: "custom", shadow_mode: true, agent_id: null, api_key_id: null },
    });
  });
});
