// Inner Control Day 3 (#171): rules in plain words for the whole account, on the Inner page. They sit in the one rules list,
// are added from the same window, start in shadow mode, and are edited, switched off, deleted and made live like the others,
// with the same second-owner requests when dual control is on.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({
  meaning: [] as Record<string, unknown>[], dual: false, inserts: [] as { table: string; row: Record<string, unknown> }[],
  writes: [] as { table: string; op: string; patch?: unknown; filters: [string, unknown][] }[], rpcs: [] as { fn: string; args: unknown }[],
  invokes: [] as unknown[], queries: [] as string[],
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "u1", role: "owner", permissions: null }) }));
vi.mock("@/lib/outer-control-read", () => ({ ocRead: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let op = "select"; let patch: unknown;
    const q: Record<string, unknown> = {};
    for (const m of ["order", "limit", "not", "in", "gte", "or"]) q[m] = () => q;
    q.select = () => q;
    q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
    q.is = (c: string, v: unknown) => { db.queries.push(`${table}.is(${c},${v})`); return q; };
    q.update = (p: unknown) => { op = "update"; patch = p; return q; };
    q.delete = () => { op = "delete"; return q; };
    q.insert = (row: Record<string, unknown>) => { db.inserts.push({ table, row }); op = "insert"; return q; };
    q.maybeSingle = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      if (op !== "select") {
        if (op !== "insert") db.writes.push({ table, op, patch, filters: [...filters] });
        return Promise.resolve({ data: [{ id: filters.find(([c]) => c === "id")?.[1] ?? "new" }], error: null }).then(res);
      }
      const data = table === "meaning_rules" ? db.meaning : table === "profiles" ? { require_dual_control_for_policy: db.dual } : [];
      return Promise.resolve({ data, error: null }).then(res);
    };
    return q;
  };
  return {
    supabase: {
      from, rpc: async (fn: string, args: unknown) => { db.rpcs.push({ fn, args }); return { data: {}, error: null }; },
      functions: { invoke: async (name: string, opts: unknown) => { db.invokes.push({ name, opts }); return { data: { ok: true, kind: "meaning", checked: 8, matched: 2, unavailable: 1, hits: [] }, error: null }; } },
    },
  };
});

import { useInnerControlRules } from "@/hooks/useInnerControlRules";
import AddRuleDialog, { meaningRuleOf, newRuleRow } from "@/components/control/AddRuleDialog";
import RuleEditDialog from "@/components/control/RuleEditDialog";
import RuleTrial from "@/components/control/RuleTrial";
import { taskAnswerRuleCount, toRuleItems } from "@/lib/inner-control-ui";
import { meaningEditProblem, meaningPatch } from "@/lib/inner-rule-edit";
import { meaningTrialLine, trialSpecOfDraft, trialSpecOfRow } from "@/lib/rule-trial";
import { meaningConflicts } from "@/lib/new-rule-warnings";

const RULE = { id: "m1", name: "No delivery promises", description: "Never promise a delivery date", action: "block", enabled: true, shadow_mode: true, created_at: "2026-11-19T00:00:00Z" };
const lastToast = () => toast.mock.calls.at(-1)?.[0] as { title: string; description?: string };

async function hook() {
  const h = renderHook(() => useInnerControlRules());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe("the pure parts", () => {
  it("in the one list: its kind, what it does, for every reply; a live one checks every Task answer, a shadow one does not", () => {
    const [item] = toRuleItems([], [], () => "", [RULE as never]);
    expect(item).toMatchObject({ key: "meaning:m1", kind: "meaning", name: "No delivery promises", effect: "Blocks a reply that breaks it", shadow: true, status: "active" });
    expect(taskAnswerRuleCount([], [], [RULE as never])).toBe(0);
    expect(taskAnswerRuleCount([], [], [{ ...RULE, shadow_mode: false } as never])).toBe(1);
  });
  it("checked like the database: the words, a name, an outcome; a name is made from the first words", () => {
    expect(meaningEditProblem({ name: "x", description: "no", action: "block" })).toMatch(/plain words/);
    expect(meaningEditProblem({ name: "", description: "Never promise a date", action: "block" })).toMatch(/name/);
    expect(meaningEditProblem({ name: "x".repeat(121), description: "Never promise a date", action: "block" })).toMatch(/120/);
    expect(meaningRuleOf({ name: "", description: "  Never promise   a delivery date or a time to anyone  ", action: "remove" }))
      .toEqual({ name: "Never promise a delivery date or a…", description: "Never promise a delivery date or a time to anyone", action: "remove" });
    expect(meaningPatch({ name: " N ", description: " a  b c ", action: "approval" })).toEqual({ name: "N", description: "a b c", action: "approval" });
  });
  it("the row the Add window writes: the whole account (no project), switched on, in shadow mode when asked", () => {
    expect(newRuleRow("meaning", { name: "N", description: "Never promise a date", action: "block" }, "acct", true)).toEqual({
      table: "meaning_rules", row: { user_id: "acct", project_id: null, name: "N", description: "Never promise a date", action: "block", enabled: true, shadow_mode: true },
    });
  });
  it("Try it first and warnings know rules in plain words", () => {
    expect(trialSpecOfDraft("meaning", { name: "N", description: "no", action: "block" })).toBeNull();
    expect(trialSpecOfRow(RULE)).toEqual({ kind: "meaning", name: "No delivery promises", description: "Never promise a delivery date", action: "block" });
    expect(meaningTrialLine({ checked: 7, matched: 2, hits: [], unavailable: 1 }, "approval")).toBe("2 of your last 7 replies would have been held for approval. 1 could not be read by the AI judge.");
    expect(meaningTrialLine({ checked: 0, matched: 0, hits: [], unavailable: 3 }, "block")).toMatch(/could not read any/);
    expect(meaningConflicts({ description: "never promise a delivery date!", action: "block" }, [RULE])[0]).toMatchObject({ kind: "duplicate", id: "m1" });
    expect(meaningConflicts({ description: "Never promise a delivery date", action: "remove" }, [RULE])[0].kind).toBe("contradicts");
    expect(meaningConflicts({ description: "Never mention prices", action: "block" }, [RULE])).toEqual([]);
  });
});

describe("on the Inner page", () => {
  beforeEach(() => { db.meaning = [RULE]; db.dual = false; db.writes = []; db.rpcs = []; db.inserts = []; db.invokes = []; db.queries = []; toast.mockClear(); });

  it("only the account's own rules (no project) are listed with the others", async () => {
    const h = await hook();
    expect(h.result.current.rules.map((r) => r.key)).toEqual(["meaning:m1"]);
    expect(db.queries).toContain("meaning_rules.is(project_id,null)");
  });

  it("switch off, edit, delete and go live write the meaning_rules row of this account", async () => {
    const h = await hook();
    const r = h.result.current.rules[0];
    await act(async () => { await h.result.current.setEnabled(r, false); });
    await act(async () => { await h.result.current.edit(r, { name: "N2", description: "Never promise a delivery time", action: "approval" }); });
    await act(async () => { await h.result.current.promote(r); });
    await act(async () => { await h.result.current.remove(r); });
    expect(db.writes.map((w) => [w.table, w.op])).toEqual([["meaning_rules", "update"], ["meaning_rules", "update"], ["meaning_rules", "update"], ["meaning_rules", "delete"]]);
    expect(db.writes[1].patch).toEqual({ name: "N2", description: "Never promise a delivery time", action: "approval" });
    expect(db.writes[2].patch).toMatchObject({ shadow_mode: false });
    expect(db.writes.every((w) => w.filters.some(([c, v]) => c === "user_id" && v === "u1"))).toBe(true);
  });

  it("with dual control each of them is a request for a second owner, of the meaning-rule kind", async () => {
    db.dual = true;
    const h = await hook();
    const r = h.result.current.rules[0];
    await act(async () => { await h.result.current.setEnabled(r, false); });
    await act(async () => { await h.result.current.edit(r, { name: "N2", description: "Never promise a delivery time", action: "approval" }); });
    await act(async () => { await h.result.current.promote(r); });
    await act(async () => { await h.result.current.remove(r); });
    expect(db.writes).toEqual([]);
    expect(db.rpcs.map((c) => (c.args as { _change_type: string })._change_type)).toEqual(["disable_meaning_rule", "edit_meaning_rule", "promote_meaning_rule", "delete_meaning_rule"]);
    expect(lastToast().title).toBe("Deletion requested");
  });

  it("the Add window: the third choice writes an account-wide rule in plain words, in shadow mode", async () => {
    const onSaved = vi.fn();
    render(<AddRuleDialog open onOpenChange={() => {}} accountId="u1" canWrite onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId("add-kind-meaning"));
    fireEvent.change(screen.getByLabelText("The rule, in plain words"), { target: { value: "Never promise a delivery date" } });
    fireEvent.change(screen.getByLabelText("When a reply breaks it"), { target: { value: "approval" } });
    fireEvent.click(screen.getByTestId("add-rule-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(db.inserts).toEqual([{ table: "meaning_rules", row: { user_id: "u1", project_id: null, name: "Never promise a delivery date", description: "Never promise a delivery date", action: "approval", enabled: true, shadow_mode: true } }]);
  });

  it("the edit window edits the words, the name and the outcome", async () => {
    const onSave = vi.fn(async () => true);
    const [item] = toRuleItems([], [], () => "", [RULE as never]);
    render(<RuleEditDialog rule={item} row={RULE as never} busy={false} onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("The rule, in plain words"), { target: { value: "Never promise a delivery time" } });
    fireEvent.click(screen.getByTestId("rule-edit-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(item, { name: "No delivery promises", description: "Never promise a delivery time", action: "block" }));
  });

  it("Try it first asks the server's AI judge, with the words and the outcome", async () => {
    render(<RuleTrial spec={{ kind: "meaning", name: "N", description: "Never promise a date", action: "remove" }} accountId="u1" />);
    fireEvent.click(screen.getByTestId("rule-trial-run"));
    expect((await screen.findByTestId("rule-trial-line")).textContent).toBe("2 of your last 8 replies would have had the words that break it removed. 1 could not be read by the AI judge.");
    expect(db.invokes).toEqual([{ name: "projects", opts: { body: { action: "try_rule", kind: "meaning", name: "N", description: "Never promise a date", rule_action: "remove", account_id: "u1" } } }]);
  });
});
