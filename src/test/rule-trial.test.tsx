// Inner Control Day 2 (#169): "Try it first". A rule is tried on what already happened, before it is switched on: an action rule on
// the account's recent decisions (in the browser), a text rule on recent tool replies (by the server, as they are stored
// encrypted). Nothing is saved by trying; a changed rule clears the old result.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const db = vi.hoisted(() => ({
  decisions: [] as { decision: string; action_type: string | null }[], queries: [] as string[], invokes: [] as unknown[],
  reply: { data: { ok: true, checked: 3, matched: 1, hits: [{ tool: "Groq", at: "2026-11-19", before: "Our ", match: "price", after: " is 40" }] }, error: null } as { data: unknown; error: unknown },
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = (...a: unknown[]) => { db.queries.push(`${table}.${m}(${a.join(",")})`); return q; };
    q.limit = async () => ({ data: db.decisions, error: null });
    for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => { throw new Error(`trying wrote to ${table}`); };
    return q;
  };
  return { supabase: { from: chain, functions: { invoke: async (name: string, opts: unknown) => { db.invokes.push({ name, opts }); return db.reply; } } } };
});

import RuleTrial from "@/components/control/RuleTrial";
import { actionTrialLine, replayActionRule, textTrialLine, trialSpecOfDraft, trialSpecOfRow } from "@/lib/rule-trial";

const D = (decision: string, action_type: string | null) => ({ decision, action_type });

describe("the pure parts", () => {
  it("an action rule is replayed with the gate's glob, on verdict rows only", () => {
    const t = replayActionRule("send_*", [D("ALLOW sent", "send_email"), D("BLOCK no", "send_sms"), D("ALLOW ok", "send_email"),
      D("ALLOW", "read_file"), D("some note", "send_email"), D("ALLOW", null)]);
    expect(t).toEqual({ checked: 4, matched: 3, wasAllowed: 2, byAction: [{ action: "send_email", count: 2 }, { action: "send_sms", count: 1 }] });
    expect(actionTrialLine(t, "always_require_approval")).toBe("Of your last 4 actions, 3 would have been held for approval (send_email ×2, send_sms ×1). 2 of them were allowed then.");
    expect(replayActionRule("send_email", [D("ALLOW", "send_emails")]).matched).toBe(0);
  });
  it("the lines say plainly when there is nothing to try it on, or nothing matched", () => {
    expect(actionTrialLine(replayActionRule("*", []), "always_block")).toMatch(/Nothing has run yet/);
    expect(actionTrialLine(replayActionRule("x", [D("ALLOW", "y")]), "always_block")).toBe("Of your last 1 action, none would have been affected.");
    expect(textTrialLine({ checked: 0, matched: 0, hits: [] }, "block")).toMatch(/no tool replies yet/);
    expect(textTrialLine({ checked: 5, matched: 2, hits: [] }, "redact")).toBe("2 of your last 5 replies would have had the matching text removed.");
  });
  it("what is tried: a draft only once complete; a saved rule from its row, saying when it applies to fewer AIs", () => {
    expect(trialSpecOfDraft("action", { scope: "", effect: "always_block" })).toBeNull();
    expect(trialSpecOfDraft("text", { pattern: "price", action: "redact" })).toEqual({ kind: "text", pattern: "price", action: "redact" });
    expect(trialSpecOfRow({ action_type_pattern: "send_*", effect: "always_block", agent_id: "a1" })).toEqual({ kind: "action", pattern: "send_*", effect: "always_block", narrower: true });
    expect(trialSpecOfRow({ pattern: "x", severity: "require_approval", redact: false })).toEqual({ kind: "text", pattern: "x", action: "approval" });
  });
});

describe("the Try it first panel", () => {
  beforeEach(() => { db.decisions = []; db.queries = []; db.invokes = []; });

  it("an action rule: reads only this account's real decisions and shows what would have happened; nothing is written", async () => {
    db.decisions = [D("ALLOW", "send_email"), D("ALLOW", "read_file")];
    render(<RuleTrial spec={{ kind: "action", pattern: "send_*", effect: "always_block" }} accountId="acct" />);
    fireEvent.click(screen.getByTestId("rule-trial-run"));
    expect((await screen.findByTestId("rule-trial-line")).textContent).toBe("Of your last 2 actions, 1 would have been blocked (send_email ×1). 1 of them was allowed then.");
    expect(db.queries).toContain("agent_decisions.eq(user_id,acct)");
    expect(db.queries).toContain("agent_decisions.eq(is_test,false)");
  });

  it("a text rule: asked of the server, the matches shown with where they were found; a changed rule clears the result", async () => {
    const { rerender } = render(<RuleTrial spec={{ kind: "text", pattern: "price", action: "block" }} accountId="acct" />);
    fireEvent.click(screen.getByTestId("rule-trial-run"));
    expect((await screen.findByTestId("rule-trial-line")).textContent).toBe("1 of your last 3 replies would have been blocked.");
    expect(screen.getByTestId("rule-trial-hit").textContent).toBe("Groq: …Our price is 40…");
    expect(db.invokes).toEqual([{ name: "projects", opts: { body: { action: "try_rule", pattern: "price", account_id: "acct" } } }]);
    rerender(<RuleTrial spec={{ kind: "text", pattern: "prices", action: "block" }} accountId="acct" />);
    expect(screen.queryByTestId("rule-trial-result")).toBeNull();
  });

  it("a refusal is said, and nothing to try is not offered", async () => {
    db.reply = { data: { ok: false, message: "That pattern is not valid." }, error: null };
    render(<RuleTrial spec={{ kind: "text", pattern: "(", action: "block" }} accountId="acct" />);
    fireEvent.click(screen.getByTestId("rule-trial-run"));
    expect((await screen.findByRole("alert")).textContent).toBe("That pattern is not valid.");
  });

  it("an incomplete rule can not be tried", () => {
    render(<RuleTrial spec={null} accountId="acct" />);
    expect((screen.getByTestId("rule-trial-run") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("review fixes", () => {
  it("a hold written by the agent runtime (REQUIRE_APPROVAL) is a check; an agent step is not", () => {
    const t = replayActionRule("send_email", [D("REQUIRE_APPROVAL send_email (Gmail)", "send_email"), D('Call tool "web_search"', "send_email")]);
    expect(t).toMatchObject({ checked: 1, matched: 1, wasAllowed: 0 });
  });
});
