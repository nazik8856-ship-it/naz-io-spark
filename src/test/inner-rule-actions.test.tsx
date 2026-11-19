// Inner Control Day 1 (#158): every rule action works, and says so only when it did.
//   - Edit changes the rule in place, for both kinds, with the same checks as the Add forms.
//   - Disable / Enable / Delete write the right row; a write the database refused (no row changed, no error) is an error on screen,
//     never "Rule disabled".
//   - Dual control: delete, switch-off and edit ask a second owner; switching a rule back on does not.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({
  hard: [] as Record<string, unknown>[], safety: [] as Record<string, unknown>[], dual: false,
  refuse: false, writes: [] as { table: string; op: string; patch?: unknown; filters: [string, unknown][] }[], rpcs: [] as { fn: string; args: unknown }[],
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
    for (const m of ["order", "limit", "not", "in", "is", "gte", "or"]) q[m] = () => q;
    q.select = () => q;
    q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
    q.update = (p: unknown) => { op = "update"; patch = p; return q; };
    q.delete = () => { op = "delete"; return q; };
    q.maybeSingle = () => { (q as { single?: boolean }).single = true; return q; };
    q.then = (res: (v: unknown) => unknown) => {
      if (op !== "select") {
        db.writes.push({ table, op, patch, filters: [...filters] });
        const id = filters.find(([c]) => c === "id")?.[1];
        return Promise.resolve({ data: db.refuse ? [] : [{ id }], error: null }).then(res);
      }
      const data = table === "hard_rules" ? db.hard : table === "safety_rules" ? db.safety
        : table === "profiles" ? { require_dual_control_for_policy: db.dual } : [];
      return Promise.resolve({ data, error: null }).then(res);
    };
    return q;
  };
  return { supabase: { from, rpc: async (fn: string, args: unknown) => { db.rpcs.push({ fn, args }); return { data: {}, error: null }; } } };
});

import { useInnerControlRules } from "@/hooks/useInnerControlRules";
import RuleEditDialog from "@/components/control/RuleEditDialog";
import { NOTHING_CHANGED, hardEditProblem, safetyEditProblem, safetyActionOf, writeOutcome, hardPatch, safetyPatch } from "@/lib/inner-rule-edit";

const HARD = { id: "h1", rule_text: "Never email customers on Sunday", action_type_pattern: "send_email", effect: "always_block", enabled: true, shadow_mode: false, agent_id: null, required_approvals: null, created_at: "2026-11-01T00:00:00Z" };
const SAFE = { id: "s1", name: "Card numbers", pattern: "\\d{4} \\d{4}", severity: "block", redact: true, enabled: true, shadow_mode: false, agent_id: null, api_key_id: null, created_at: "2026-11-02T00:00:00Z" };
const lastToast = () => toast.mock.calls.at(-1)?.[0] as { title: string; description?: string; variant?: string };

async function hook() {
  const h = renderHook(() => useInnerControlRules());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe("the pure parts", () => {
  it("a write that changed no row is an error with what to do; a changed row is ok", () => {
    expect(writeOutcome({ data: [{ id: "x" }], error: null })).toEqual({ ok: true });
    expect(writeOutcome({ data: [], error: null })).toEqual({ ok: false, message: NOTHING_CHANGED });
    expect(writeOutcome({ data: null, error: { message: "boom" } })).toEqual({ ok: false, message: "boom" });
    expect(NOTHING_CHANGED).toMatch(/two-step sign-in/);
  });
  it("edits are checked like the Add forms, and write the same columns", () => {
    expect(hardEditProblem({ text: "ok rule", scope: "*", effect: "always_block", approvals: 1 })).toBeNull();
    expect(hardEditProblem({ text: "x", scope: "*", effect: "always_block", approvals: 1 })).toMatch(/few words/);
    expect(hardEditProblem({ text: "ok rule", scope: "drop table;", effect: "always_block", approvals: 1 })).toMatch(/letters, digits/);
    expect(hardEditProblem({ text: "ok rule", scope: "*", effect: "always_require_approval", approvals: 9 })).toMatch(/between 1 and 5/);
    expect(hardPatch({ text: " Hold refunds ", scope: "stripe_*", effect: "always_require_approval", approvals: 2 }))
      .toEqual({ rule_text: "Hold refunds", action_type_pattern: "stripe_*", effect: "always_require_approval", required_approvals: 2 });
    expect(hardPatch({ text: "Block it", scope: "*", effect: "always_block", approvals: 3 }).required_approvals).toBeNull();
    expect(safetyEditProblem({ name: "x", pattern: "a*", action: "block" })).toMatch(/matches empty text/);
    expect(safetyEditProblem({ name: "x", pattern: "(a+)+", action: "block" })).toMatch(/repeats a repeated group/);
    expect(safetyActionOf({ severity: "block", redact: true })).toBe("redact");
    expect(safetyPatch({ name: "N", pattern: "abc", action: "approval" })).toEqual({ name: "N", pattern: "abc", severity: "require_approval", redact: false });
  });
});

describe("rule actions on the Inner page", () => {
  beforeEach(() => { db.hard = [HARD]; db.safety = [SAFE]; db.dual = false; db.refuse = false; db.writes = []; db.rpcs = []; toast.mockClear(); });

  it("Disable and Enable write `enabled` on the right row of the right table, scoped to the account", async () => {
    const h = await hook();
    const hard = h.result.current.rules.find((r) => r.id === "h1")!;
    await act(async () => { await h.result.current.setEnabled(hard, false); });
    expect(db.writes.at(-1)).toEqual({ table: "hard_rules", op: "update", patch: { enabled: false }, filters: [["id", "h1"], ["user_id", "u1"]] });
    expect(lastToast().title).toBe("Rule disabled");
    const safe = h.result.current.rules.find((r) => r.id === "s1")!;
    await act(async () => { await h.result.current.setEnabled(safe, true); });
    expect(db.writes.at(-1)).toMatchObject({ table: "safety_rules", patch: { enabled: true } });
    expect(lastToast().title).toBe("Rule enabled");
  });

  it("a write the database refused is shown as an error, never as done", async () => {
    const h = await hook();
    db.refuse = true;
    const hard = h.result.current.rules.find((r) => r.id === "h1")!;
    await act(async () => { await h.result.current.setEnabled(hard, false); });
    expect(lastToast()).toMatchObject({ title: "Could not disable rule", description: NOTHING_CHANGED, variant: "destructive" });
    await act(async () => { await h.result.current.remove(hard); });
    expect(lastToast()).toMatchObject({ title: "Could not delete rule", variant: "destructive" });
    let saved = true;
    await act(async () => { saved = await h.result.current.edit(hard, { text: "New text here", scope: "*", effect: "always_block", approvals: 1 }); });
    expect(saved).toBe(false);
    expect(lastToast()).toMatchObject({ title: "Could not save the rule", variant: "destructive" });
    expect(toast.mock.calls.some(([t]) => /^Rule (disabled|deleted|updated)$/.test((t as { title: string }).title))).toBe(false);
  });

  it("Edit changes a hard rule and a safety rule in place (not a new rule); on/off and shadow are untouched", async () => {
    const h = await hook();
    const hard = h.result.current.rules.find((r) => r.id === "h1")!;
    expect(h.result.current.rowOf(hard)).toMatchObject({ rule_text: "Never email customers on Sunday" });
    await act(async () => { await h.result.current.edit(hard, { text: "Hold Sunday emails", scope: "send_email", effect: "always_require_approval", approvals: 2 }); });
    expect(db.writes.at(-1)).toEqual({ table: "hard_rules", op: "update", filters: [["id", "h1"], ["user_id", "u1"]],
      patch: { rule_text: "Hold Sunday emails", action_type_pattern: "send_email", effect: "always_require_approval", required_approvals: 2 } });
    expect(lastToast().title).toBe("Rule updated");
    const safe = h.result.current.rules.find((r) => r.id === "s1")!;
    await act(async () => { await h.result.current.edit(safe, { name: "Cards", pattern: "\\d{16}", action: "approval" }); });
    expect(db.writes.at(-1)).toMatchObject({ table: "safety_rules", patch: { name: "Cards", pattern: "\\d{16}", severity: "require_approval", redact: false } });
    expect(db.writes.every((w) => !("enabled" in (w.patch as object ?? {})) || w.op !== "update" || (w.patch as Record<string, unknown>).enabled !== undefined)).toBe(true);
    expect(db.writes.filter((w) => w.op === "update").every((w) => !("shadow_mode" in (w.patch as object)))).toBe(true);
  });

  it("Delete removes the row; with dual control it asks a second owner instead", async () => {
    const h = await hook();
    const safe = h.result.current.rules.find((r) => r.id === "s1")!;
    await act(async () => { await h.result.current.remove(safe); });
    expect(db.writes.at(-1)).toEqual({ table: "safety_rules", op: "delete", patch: undefined, filters: [["id", "s1"], ["user_id", "u1"]] });
    expect(lastToast().title).toBe("Rule deleted");
    db.dual = true; db.writes = [];
    const h2 = await hook();
    await waitFor(() => expect(h2.result.current.dualControl).toBe(true));
    const hard = h2.result.current.rules.find((r) => r.id === "h1")!;
    await act(async () => { await h2.result.current.remove(hard); });
    expect(db.writes).toEqual([]);
    expect(db.rpcs.at(-1)).toMatchObject({ fn: "request_policy_change", args: { _change_type: "delete_hard_rule", _row_id: "h1" } });
    expect(lastToast().title).toBe("Deletion requested");
  });
});

describe("dual control covers switching off and editing", () => {
  beforeEach(() => { db.hard = [HARD]; db.safety = [SAFE]; db.dual = false; db.refuse = false; db.writes = []; db.rpcs = []; toast.mockClear(); });
  it("switch-off and edit become requests (nothing written); switching on stays direct", async () => {
    db.dual = true; db.writes = []; db.rpcs = [];
    const h = await hook();
    await waitFor(() => expect(h.result.current.dualControl).toBe(true));
    const hard = h.result.current.rules.find((r) => r.id === "h1")!;
    await act(async () => { await h.result.current.setEnabled(hard, false); });
    expect(db.writes).toEqual([]);
    expect(db.rpcs.at(-1)).toMatchObject({ fn: "request_policy_change", args: { _change_type: "disable_hard_rule", _row_id: "h1" } });
    expect(lastToast().title).toBe("Switch-off requested");

    let saved = false;
    await act(async () => { saved = await h.result.current.edit(hard, { text: "Never email on Sunday", scope: "send_email", effect: "always_require_approval", approvals: 2 }); });
    expect(saved).toBe(true); // the dialog closes: the request is made
    expect(db.writes).toEqual([]);
    expect(db.rpcs.at(-1)).toMatchObject({ fn: "request_policy_change", args: {
      _change_type: "edit_hard_rule", _row_id: "h1",
      _new_value: { rule_text: "Never email on Sunday", action_type_pattern: "send_email", effect: "always_require_approval", required_approvals: 2 },
    } });
    expect(lastToast().title).toBe("Edit requested");

    const safe = h.result.current.rules.find((r) => r.id === "s1")!;
    await act(async () => { await h.result.current.edit(safe, { name: "Cards", pattern: "\\d{16}", action: "block" }); });
    expect(db.rpcs.at(-1)).toMatchObject({ args: { _change_type: "edit_safety_rule", _new_value: { name: "Cards", pattern: "\\d{16}", severity: "block", redact: false } } });

    await act(async () => { await h.result.current.setEnabled(safe, true); });
    expect(db.writes.at(-1)).toMatchObject({ table: "safety_rules", op: "update", patch: { enabled: true } });
  });

  it("the database refuses a direct switch-off or edit under dual control (migration guard)", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261118010000_dual_control_disable_and_edit.sql", "utf8");
    expect(sql).toMatch(/CREATE TRIGGER guard_hard_rule_weakening_trg BEFORE UPDATE ON public\.hard_rules/);
    expect(sql).toMatch(/CREATE TRIGGER guard_safety_rule_weakening_trg BEFORE UPDATE ON public\.safety_rules/);
    for (const t of ["disable_hard_rule", "disable_safety_rule", "edit_hard_rule", "edit_safety_rule"]) expect(sql).toContain(`'${t}'`);
  });
});

describe("the Edit dialog", () => {
  const item = (kind: "hard" | "safety") => ({ key: `${kind}:x`, id: "x", kind, name: "n", effect: "", scope: "", status: "active" as const, shadow: false, createdAt: "" });

  it("opens filled with the rule as it is, refuses a bad change with the reason, saves a good one", async () => {
    const onSave = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<RuleEditDialog rule={item("safety")} row={SAFE as never} busy={false} onClose={onClose} onSave={onSave} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Card numbers");
    expect((screen.getByLabelText("On a match") as HTMLSelectElement).value).toBe("redact");
    fireEvent.change(screen.getByLabelText("Text pattern"), { target: { value: ".*" } });
    fireEvent.click(screen.getByTestId("rule-edit-save"));
    expect((await screen.findByTestId("rule-edit-problem")).textContent).toMatch(/matches empty text/);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Text pattern"), { target: { value: "\\d{16}" } });
    fireEvent.click(screen.getByTestId("rule-edit-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "safety" }), { name: "Card numbers", pattern: "\\d{16}", action: "redact" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a hard rule: text, where it applies, what it does, approvals; a custom action pattern is kept", async () => {
    const onSave = vi.fn(async () => false);
    const onClose = vi.fn();
    render(<RuleEditDialog rule={item("hard")} row={{ ...HARD, action_type_pattern: "stripe_*" } as never} busy={false} onClose={onClose} onSave={onSave} />);
    expect((screen.getByLabelText("Action pattern") as HTMLInputElement).value).toBe("stripe_*");
    fireEvent.change(screen.getByLabelText("What it does"), { target: { value: "always_require_approval" } });
    fireEvent.change(screen.getByLabelText("Approvals needed"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("rule-edit-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.anything(), { text: HARD.rule_text, scope: "stripe_*", effect: "always_require_approval", approvals: 3 }));
    expect(onClose).not.toHaveBeenCalled(); // not saved: the dialog stays open with the person's changes
  });
});
