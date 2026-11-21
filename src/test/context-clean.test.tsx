// Context Day 1: Clean it, Outer Control's first screen. Paste text from any AI -> one result that follows your rules and your
// context, with what was found and what changed, Copy, the daily free allowance, your context, starter rules and measurement.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  inserted: [] as { table: string; rows: unknown }[],
  calls: [] as { url: string; body: Record<string, unknown> }[],
  reply: {} as Record<string, unknown>,
  hold: null as null | Promise<void>,
  weight: null as null | Record<string, unknown>,
  status: 200,
  captured: [] as { event: string; props: Record<string, unknown> }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "order", "limit", "in"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(res);
    q.insert = (rows: unknown[]) => {
      state.inserted.push({ table, rows });
      return { select: async () => ({ data: (rows as unknown[]).map((_, i) => ({ id: `m${i}` })), error: null }) };
    };
    return q;
  };
  return {
    supabase: { from, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
    SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1",
    SUPABASE_ANON: "anon",
  };
});
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "acc1", loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/posthog", () => ({ posthog: { capture: (event: string, props: Record<string, unknown>) => state.captured.push({ event, props }) } }));

import CleanItPanel from "@/components/control/outer/CleanItPanel";
import { FREE_CLEANS_PER_DAY, allowanceLine, rememberedContext, trailOf, isControlled, secondsLabel, type CleanResult } from "@/lib/context-clean";

const changed = {
  mode: "clean_result", status: "changed", text: "Thanks! You will get the tracking link as soon as it ships.",
  found: [{ kind: "rule", name: "No delivery promises", quote: "will arrive by Friday", why: "It promises a delivery date." }],
  edits: [{ before: "Your order will arrive by Friday", after: "You will get the tracking link as soon as it ships", why: "No delivery dates." }],
  rewrite: "passed", context: null, summary: "Rewritten to follow your rules, then checked again: it passed.", allowance: { used: 3, limit: 15 },
};

const renderPanel = () => render(<MemoryRouter><CleanItPanel accountId="acc1" /></MemoryRouter>);
const paste = (text: string) => fireEvent.change(screen.getByTestId("clean-input"), { target: { value: text } });

beforeEach(() => {
  state.tables = { imported_projects: [], agents: [], websites: [], hard_rules: [{ id: "h", enabled: true }], safety_rules: [], meaning_rules: [] };
  state.inserted = []; state.calls = []; state.captured = []; state.status = 200; state.reply = changed; state.hold = null; state.weight = null;
  try { window.localStorage.clear(); } catch { /* none */ }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    state.calls.push({ url, body });
    if (url.endsWith("/projects")) return new Response(JSON.stringify({ ok: true, project: { id: "ctx1", name: body.name } }));
    if (body.action === "context_weight") return new Response(JSON.stringify(state.weight ?? { error: "x" }), { status: state.weight ? 200 : 404 });
    if (state.hold) await state.hold;
    return new Response(JSON.stringify(state.reply), { status: state.status });
  }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe("Clean it", () => {
  it("sends the pasted text with its source to the server, and shows the one result with what changed and what was found", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("clean-source-claude"));
    paste("Thanks! Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    const card = await screen.findByTestId("clean-result");
    const call = state.calls.find((c) => c.url.endsWith("/control-system-decide"))!;
    expect(call.body).toMatchObject({ action: "clean_text", content: "Thanks! Your order will arrive by Friday.", source: "claude", project_id: null, account_id: "acc1" });
    expect(within(card).getByTestId("clean-status").textContent).toBe("Cleaned");
    expect(within(card).getByText("Rewrite passed your rules")).toBeTruthy();
    expect(within(card).getByTestId("clean-text").textContent).toBe(changed.text);
    expect(within(card).getByTestId("clean-edits").textContent).toContain("Your order will arrive by Friday");
    expect(within(card).getByTestId("clean-found").textContent).toContain("No delivery promises");
    expect(screen.getByTestId("clean-allowance").textContent).toBe("12 of 15 free cleans left today");
  });

  it("Copy copies exactly the result; analytics get counts and labels, never the text", async () => {
    renderPanel();
    paste("Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    fireEvent.click(await screen.findByTestId("clean-copy"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(changed.text));
    expect(state.captured.map((c) => c.event)).toEqual(["context_checked", "result_copied"]);
    expect(state.captured[0].props).toMatchObject({ status: "changed", changed: true, rewrite: "passed", source: "chatgpt", with_context: false, found: 1, edits: 1 });
    expect(JSON.stringify(state.captured)).not.toMatch(/Friday|tracking/);
  });

  it("nothing to change is said plainly; blocked has nothing to copy", async () => {
    state.reply = { ...changed, status: "clean", text: "All good.", edits: [], found: [], rewrite: "not_needed", summary: "Checked against your rules: nothing to change." };
    renderPanel();
    paste("All good.");
    fireEvent.click(screen.getByTestId("clean-go"));
    expect((await screen.findByTestId("clean-status")).textContent).toBe("Nothing to change");
    expect(screen.getByTestId("clean-summary").textContent).toMatch(/nothing to change/);
    state.reply = { ...changed, status: "blocked", text: null, edits: [], rewrite: "failed_check", summary: "Blocked by your rules." };
    fireEvent.click(screen.getByTestId("clean-go"));
    await waitFor(() => expect(screen.getByTestId("clean-status").textContent).toBe("Blocked by your rules"));
    expect(screen.queryByTestId("clean-copy")).toBeNull();
  });

  it("past the daily allowance: the server's calm message, no result", async () => {
    state.status = 402;
    state.reply = { error: "free_limit", kind: "context_clean", used: 15, limit: 15, message: "Today's 15 free cleaned results are used. Everything you cleaned stays available; more cleans come back tomorrow." };
    renderPanel();
    paste("Hello there, your refund is on its way.");
    fireEvent.click(screen.getByTestId("clean-go"));
    expect((await screen.findByTestId("clean-problem")).textContent).toMatch(/come back tomorrow/);
    expect(screen.queryByTestId("clean-result")).toBeNull();
  });

  it("Clean it waits for text and refuses more than 8,000 characters before sending", () => {
    renderPanel();
    expect((screen.getByTestId("clean-go") as HTMLButtonElement).disabled).toBe(true);
    paste("x".repeat(8001));
    expect((screen.getByTestId("clean-go") as HTMLButtonElement).disabled).toBe(true);
    paste("short text is fine");
    expect((screen.getByTestId("clean-go") as HTMLButtonElement).disabled).toBe(false);
  });

  it("your context: added once (saved as an encrypted project), chosen, and sent with every clean", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("clean-add-context"));
    fireEvent.change(await screen.findByTestId("clean-context-text"), { target: { value: "Refunds within 30 days." } });
    fireEvent.click(screen.getByTestId("clean-context-save"));
    await waitFor(() => expect(state.calls.some((c) => c.url.endsWith("/projects"))).toBe(true));
    expect(state.calls.find((c) => c.url.endsWith("/projects"))!.body).toMatchObject({ action: "import_paste", text: "Refunds within 30 days.", name: "My AI context", account_id: "acc1" });
    expect(state.captured.map((c) => c.event)).toContain("context_added");
    expect(window.localStorage.getItem("nazai_clean_context:acc1")).toBe("ctx1"); // an id only, never the text
    paste("We refund within 14 days.");
    fireEvent.click(screen.getByTestId("clean-go"));
    await waitFor(() => expect(state.calls.some((c) => c.body.action === "clean_text")).toBe(true));
    expect(state.calls.find((c) => c.body.action === "clean_text")!.body.project_id).toBe("ctx1");
  });

  it("starter rules: offered when the account has no rules in plain words, saved only on Add, never in shadow mode", async () => {
    renderPanel();
    const box = await screen.findByTestId("clean-starter");
    expect(within(box).getByText(/No invented numbers/)).toBeTruthy();
    expect(state.inserted).toHaveLength(0);
    fireEvent.click(within(box).getByTestId("clean-starter-add"));
    await waitFor(() => expect(state.inserted).toHaveLength(1));
    const rows = state.inserted[0].rows as Record<string, unknown>[];
    expect(state.inserted[0].table).toBe("meaning_rules");
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ user_id: "acc1", project_id: null, enabled: true, shadow_mode: false });
    expect(state.captured.map((c) => c.event)).toContain("starter_rules_added");
  });

  it("an account with other rules in plain words still gets the starter rules it lacks (live test, 21 Nov)", async () => {
    state.tables.meaning_rules = [{ id: "m1", name: "Never promise a delivery date", enabled: true }];
    renderPanel();
    const box = await screen.findByTestId("clean-starter");
    expect(within(box).getByTestId("clean-starter-add").textContent).toBe("Add these 3");
    expect(screen.getByTestId("clean-rules-line").textContent).toMatch(/2 of your rules/);
  });

  it("only the missing ones are offered and added; none when the account has all three", async () => {
    state.tables.meaning_rules = [{ id: "m1", name: "No promises", enabled: true }];
    const first = renderPanel();
    const box = await screen.findByTestId("clean-starter");
    expect(within(box).queryByText("No promises")).toBeNull();
    fireEvent.click(within(box).getByTestId("clean-starter-add"));
    await waitFor(() => expect(state.inserted).toHaveLength(1));
    expect((state.inserted[0].rows as { name: string }[]).map((r) => r.name)).toEqual(["No invented numbers", "No professional advice as fact"]);
    first.unmount();
    state.tables.meaning_rules = ["No invented numbers", "No promises", "No professional advice as fact"].map((name, i) => ({ id: `m${i}`, name, enabled: true }));
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("clean-rules-line").textContent).toMatch(/4 of your rules/));
    expect(screen.queryByTestId("clean-starter")).toBeNull();
  });
});

describe("Clean it: the pieces", () => {
  it("the daily allowance is the same number in the website, the server and the database", () => {
    const server = readFileSync(join(__dirname, "../../supabase/functions/_shared/context-clean.ts"), "utf8");
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261121010000_context_clean.sql"), "utf8");
    expect(FREE_CLEANS_PER_DAY).toBe(15);
    expect(server).toContain(`FREE_CLEANS_PER_DAY = ${FREE_CLEANS_PER_DAY};`);
    expect(sql).toContain(`WHEN 'context_clean' THEN ${FREE_CLEANS_PER_DAY}`);
  });

  it("allowance line, and the remembered context (or the one named My AI context)", () => {
    expect(allowanceLine({ used: 15, limit: 15 })).toBe("0 of 15 free cleans left today");
    expect(allowanceLine(null)).toBeNull();
    expect(rememberedContext("acc1", ["p1", "p2"], { p1: "Docs", p2: "My AI context" })).toBe("p2");
    window.localStorage.setItem("nazai_clean_context:acc1", "p1");
    expect(rememberedContext("acc1", ["p1", "p2"], { p1: "Docs", p2: "My AI context" })).toBe("p1");
    window.localStorage.setItem("nazai_clean_context:acc1", "none");
    expect(rememberedContext("acc1", ["p1", "p2"], { p1: "Docs", p2: "My AI context" })).toBeNull();
  });
});

const clean = { ...changed, status: "clean", text: "Thanks for your order, we will email you when it ships.", found: [], edits: [], rewrite: "not_needed", rules_applied: 6, summary: "Checked against your rules: nothing to change." };

describe("Clean it: the details", () => {
  it("Micro-interaction: a precise timer and a thin progress line while it works (no spinner); the result then appears", async () => {
    let release = () => {};
    state.hold = new Promise<void>((r) => { release = r; });
    renderPanel();
    paste("Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    expect(await screen.findByTestId("clean-working")).toBeTruthy();
    expect(screen.getByTestId("clean-timer").textContent).toMatch(/^\d+\.\ds$/);
    expect(screen.getByTestId("clean-progress")).toBeTruthy();
    expect(document.querySelector(".animate-spin")).toBeNull();
    release();
    const card = await screen.findByTestId("clean-result");
    expect(card.className).toContain("nz-reveal");
    expect(screen.queryByTestId("clean-progress")).toBeNull();
  });

  it("Control Pulse: 'Outer Control is active' pulses softly; Clean it makes it stronger (when pressed and when the rules are applied)", async () => {
    renderPanel();
    const pulse = screen.getByTestId("control-pulse");
    expect(pulse.textContent).toContain("Outer Control is active");
    expect(pulse.querySelector(".nz-pulse")).toBeTruthy();
    expect(screen.queryByTestId("control-pulse-surge")).toBeNull();
    paste("Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    expect((await screen.findByTestId("control-pulse-surge")).className).toContain("nz-pulse-strong");
  });

  it("Rule Application Trail: rules applied → fixes made → items blocked, each one clickable with its own colour", async () => {
    state.reply = { ...changed, rules_applied: 7 };
    renderPanel();
    paste("Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    const trail = await screen.findByTestId("clean-trail");
    expect(trail.textContent).toBe("7 rules applied→1 fix made→0 items blocked");
    expect(within(trail).getByTestId("trail-rules").className).toContain("text-cyan-200");
    expect(within(trail).getByTestId("trail-fixes").className).toContain("text-emerald-200");
    for (const id of ["trail-rules", "trail-fixes", "trail-blocked"]) expect(within(trail).getByTestId(id).className).toContain("nz-marker");
    fireEvent.click(within(trail).getByTestId("trail-fixes"));
    expect(screen.getByTestId("clean-edits").className).toContain("nz-focus");
  });

  it("Controlled Result Seal and Trust Signature: on a result that passed, never on one that did not", async () => {
    renderPanel();
    paste("Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    expect((await screen.findByTestId("clean-seal")).textContent).toBe("Controlled by NazAI");
    expect(screen.getByTestId("clean-signature").textContent).toBe("Verified against your rules • Not shared • Controlled output");
    state.reply = { ...changed, status: "blocked", text: null, edits: [], rewrite: "failed_check", summary: "Blocked by your rules." };
    fireEvent.click(screen.getByTestId("clean-go"));
    await waitFor(() => expect(screen.getByTestId("clean-status").textContent).toBe("Blocked by your rules"));
    expect(screen.queryByTestId("clean-seal")).toBeNull();
    expect(screen.queryByTestId("clean-signature")).toBeNull();
    expect(screen.getByTestId("trail-blocked").textContent).toBe("1 item blocked");
    expect(screen.getByTestId("trail-blocked").className).toContain("text-rose-200");
  });

  it("Quiet Confidence: a fully clean result dims the input and becomes the focus, until the text is changed", async () => {
    state.reply = clean;
    renderPanel();
    paste("Thanks for your order, we will email you when it ships.");
    fireEvent.click(screen.getByTestId("clean-go"));
    await waitFor(() => expect(screen.getByTestId("clean-result").getAttribute("data-elevated")).toBe("true"));
    expect(screen.getByTestId("clean-input-area").getAttribute("data-quiet")).toBe("true");
    paste("Thanks for your order, we will email you when it ships. Promise!");
    expect(screen.getByTestId("clean-input-area").getAttribute("data-quiet")).toBe("false");
    expect(screen.getByTestId("clean-result").getAttribute("data-elevated")).toBe("false");
  });

  it("Quiet Confidence is never shown when something was changed or found", async () => {
    renderPanel();
    paste("Your order will arrive by Friday.");
    fireEvent.click(screen.getByTestId("clean-go"));
    await screen.findByTestId("clean-result");
    expect(screen.getByTestId("clean-input-area").getAttribute("data-quiet")).toBe("false");
  });

  it("Context Weight: five thin marks, filled by how much of the context a clean reads, with the exact numbers on hover", async () => {
    state.tables.imported_projects = [{ id: "ctx1", user_id: "acc1", name: "My AI context", updated_at: "2026-11-21" }];
    state.weight = { mode: "context_weight", name: "My AI context", used: 2400, total: 2400, limit: 6000 };
    renderPanel();
    const w = await screen.findByTestId("context-weight");
    await waitFor(() => expect(w.getAttribute("data-filled")).toBe("2"));
    expect(w.getAttribute("title")).toBe("Reads all 2,400 characters of your context (up to 6,000)");
    expect(state.calls.find((c) => c.body.action === "context_weight")!.body).toMatchObject({ project_id: "ctx1", account_id: "acc1" });
  });

  it("the context weight says when a long context is cut", async () => {
    state.tables.imported_projects = [{ id: "ctx1", user_id: "acc1", name: "My AI context", updated_at: "2026-11-21" }];
    state.weight = { mode: "context_weight", used: 6000, total: 9120, limit: 6000 };
    renderPanel();
    const w = await screen.findByTestId("context-weight");
    await waitFor(() => expect(w.getAttribute("data-filled")).toBe("5"));
    expect(w.getAttribute("title")).toBe("Reads the first 6,000 of 9,120 characters of your context");
  });

  it("small touches: the keyboard shortcut cleans, Copy turns into Copied, and hovering a change marks its new words", async () => {
    renderPanel();
    paste("Your order will arrive by Friday.");
    fireEvent.keyDown(screen.getByTestId("clean-input"), { key: "Enter", ctrlKey: true });
    await screen.findByTestId("clean-result");
    fireEvent.click(screen.getByTestId("clean-copy"));
    await waitFor(() => expect(screen.getByTestId("clean-copy").textContent?.trim()).toBe("Copied"));
    fireEvent.mouseEnter(within(screen.getByTestId("clean-edits")).getAllByRole("listitem")[0]);
    expect(screen.getByTestId("clean-text").querySelector("mark")?.textContent).toBe("You will get the tracking link as soon as it ships");
    expect(screen.getByTestId("clean-text").textContent).toBe(changed.text);
  });
});

describe("Clean it details: the numbers", () => {
  const base = changed as unknown as CleanResult;
  it("trail: replaced words are fixes; removed words, and a blocked or held text, are blocked", () => {
    expect(trailOf({ ...base, rules_applied: 3 })).toEqual({ rules: 3, fixes: 1, blocked: 0 });
    expect(trailOf({ ...base, edits: [{ before: "a", after: "", why: "" }, { before: "b", after: "c", why: "" }] })).toEqual({ rules: 0, fixes: 1, blocked: 1 });
    expect(trailOf({ ...base, status: "blocked", text: null, edits: [] })).toEqual({ rules: 0, fixes: 0, blocked: 1 });
    expect(trailOf({ ...base, status: "changed", edits: [], rewrite: "unavailable" })).toEqual({ rules: 0, fixes: 0, blocked: 1 }); // the rules' cut version
  });
  it("only a result that passed is 'controlled'; seconds are precise to a tenth", () => {
    expect(isControlled(base)).toBe(true);
    expect(isControlled({ ...base, status: "flagged" })).toBe(false);
    expect(isControlled({ ...base, status: "held", text: null })).toBe(false);
    expect(secondsLabel(4230)).toBe("4.2s");
  });
});
