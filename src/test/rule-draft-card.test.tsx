// Inner Control Day 1 (#167): a rule drafted in the chat is saved only on Save, with the same row the Add forms write, in shadow mode
// unless the person switches that off; a refused save says why.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({ inserts: [] as { table: string; row: unknown }[], refuse: false as boolean | "error" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: unknown) => ({
        select: async () => {
          db.inserts.push({ table, row });
          if (db.refuse === "error") return { data: null, error: { message: "new row violates row-level security policy for table" } };
          return { data: db.refuse ? [] : [{ id: "new" }], error: null };
        },
      }),
    }),
  },
}));

import RuleDraftCard, { draftRow, type ChatRuleDraft } from "@/components/control/RuleDraftCard";

const TEXT: ChatRuleDraft = { type: "text", name: "No prices to customers", phrases: ["price", "€"], pattern: "(?:x)", action: "block" };
const ACTION: ChatRuleDraft = { type: "action", text: "Never email customers on Sundays", scope: "send_email", effect: "always_require_approval" };

describe("a rule drafted in the chat", () => {
  beforeEach(() => { db.inserts = []; db.refuse = false; });

  it("writes the same rows as the Add forms", () => {
    expect(draftRow(ACTION, "acct", true)).toEqual({ table: "hard_rules", row: { user_id: "acct", rule_text: "Never email customers on Sundays", action_type_pattern: "send_email", effect: "always_require_approval", shadow_mode: true, agent_id: null, required_approvals: 1 } });
    expect(draftRow(TEXT, "acct", false)).toEqual({ table: "safety_rules", row: { user_id: "acct", name: "No prices to customers", pattern: "(?:x)", category: "custom", severity: "block", redact: false, shadow_mode: false, agent_id: null, api_key_id: null } });
  });

  it("nothing is saved until Save; it starts in shadow mode; the list is refreshed", async () => {
    const onSaved = vi.fn();
    render(<RuleDraftCard draft={TEXT} line="New rule …" accountId="acct" canWrite onSaved={onSaved} />);
    expect(db.inserts).toEqual([]);
    fireEvent.click(screen.getByTestId("rule-draft-save"));
    await waitFor(() => expect(screen.getByTestId("rule-draft-saved").textContent).toMatch(/shadow mode/));
    expect(db.inserts).toEqual([{ table: "safety_rules", row: expect.objectContaining({ shadow_mode: true, user_id: "acct" }) }]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("switched to live, it says it applies now", async () => {
    render(<RuleDraftCard draft={ACTION} line="New rule …" accountId="acct" canWrite onSaved={() => {}} />);
    fireEvent.click(screen.getByLabelText("Start in shadow mode"));
    fireEvent.click(screen.getByTestId("rule-draft-save"));
    await waitFor(() => expect(screen.getByTestId("rule-draft-saved").textContent).toMatch(/live/));
    expect(db.inserts[0]).toMatchObject({ table: "hard_rules", row: { shadow_mode: false } });
  });

  it("a refused save says why and can be tried again; a role that can not add rules is told so", async () => {
    db.refuse = "error";
    const onSaved = vi.fn();
    render(<RuleDraftCard draft={TEXT} line="New rule …" accountId="acct" canWrite onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId("rule-draft-save"));
    expect((await screen.findByRole("alert")).textContent).toBe("You don't have permission to do that on this account.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("rule-draft-save")).toBeTruthy();
    render(<RuleDraftCard draft={TEXT} line="x" accountId="acct" canWrite={false} onSaved={() => {}} />);
    expect(screen.getByText(/Your role can not add rules/)).toBeTruthy();
  });
});
