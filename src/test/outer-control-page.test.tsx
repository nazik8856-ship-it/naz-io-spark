import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "neq", "contains", "in", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(res);
    return q;
  };
  return {
    supabase: { from: result, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
    SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1",
    SUPABASE_ANON: "anon",
  };
});
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "u1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import OuterControlSystem from "@/pages/OuterControlSystem";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const row = (n: number, verdict: string, trust = 90) => ({
  id: `e${n}`, source_model: `Bot ${n}`, verdict, trust_score: trust, summary: `Why ${n}`, created_at: minutesAgo(n), content_kind: "text", action_type: null,
  executed: false, matches: [], input_excerpt: `before ${n}`, output_text: `after ${n}`, action_params: null, corrected_params: null, execution_summary: null,
  changes: [], next_step: null, shadow_matches: [], approval_id: null,
});
const tool = { id: "t1", name: "Support bot", endpoint_url: "https://bot.example.com/chat", request_format: "generic_json", approved_at: "2026-10-01", last_ok_at: null, last_error: null, last_checked_at: "2026-10-02" };
const renderPage = () => render(<MemoryRouter><OuterControlSystem /></MemoryRouter>);

describe("Outer Control page", () => {
  beforeEach(() => {
    state.tables = {
      api_keys: [{ id: "k1", name: "Key 1" }],
      external_tools: [tool],
      hard_rules: [{ id: "h1", agent_id: null, api_key_id: null, enabled: true }],
      safety_rules: [],
      outer_control_evaluations: [row(1, "allow", 100), row(2, "modify", 80), row(3, "block", 60), row(4, "allow"), row(5, "allow"), row(6, "allow"), row(7, "allow"), row(8, "allow")]
        .map((r, i) => ({ ...r, api_key_id: i === 0 ? "k1" : null })),
    };
  });

  it("default view has the three sections and nothing else", async () => {
    renderPage();
    const status = await screen.findByTestId("status-bar");
    expect(within(status).getByText("Outer Control is active")).toBeTruthy();
    expect(screen.getByTestId("active-sessions-card")).toBeTruthy();
    expect(screen.getByTestId("recent-decisions")).toBeTruthy();
    // hidden until asked for
    expect(screen.queryByTestId("advanced-panel")).toBeNull();
    expect(screen.queryByTestId("workflows-card")).toBeNull();
    expect(screen.queryByLabelText("Verdict health network")).toBeNull();
    expect(screen.queryByText(/Changed, blocked or escalated/)).toBeNull();
    expect(screen.queryByText(/Setup progress/)).toBeNull();
  });

  it("the status bar shows the trust score and a one-line health text", async () => {
    renderPage();
    await screen.findByTestId("status-bar");
    expect(screen.getByTestId("trust-score").textContent).toBe("86"); // (100 + 80 + 60 + 5 * 90) / 8 = 86.25
    expect(screen.getByTestId("health-text").textContent).toBe("8 replies checked in the last 7 days; 2 changed, blocked or sent for approval.");
  });

  it("lists only the last 6 decisions, labelled Allow / Modify / Block, with the rest behind View all", async () => {
    renderPage();
    const list = await screen.findByTestId("recent-decisions");
    expect(within(list).getAllByTestId("decision-row")).toHaveLength(6);
    expect(within(list).getAllByText("Allow").length).toBeGreaterThan(0);
    expect(within(list).getByText("Modify")).toBeTruthy();
    expect(within(list).getByText("Block")).toBeTruthy();
    expect(within(list).queryByText("Why 1")).toBeNull(); // detail closed
    fireEvent.click(within(list).getByText("View all (8)"));
    expect(within(list).getAllByTestId("decision-row")).toHaveLength(8);
  });

  it("a decision's reasoning and before/after text open only for the row you click", async () => {
    renderPage();
    const list = await screen.findByTestId("recent-decisions");
    fireEvent.click(within(list).getByText("Bot 2"));
    expect(within(list).getByText("Why 2")).toBeTruthy();
    expect(within(list).getByText("before 2")).toBeTruthy();
    expect(within(list).queryByText("Why 3")).toBeNull();
  });

  it("Advanced opens a window over the page with the graph, the stats and the workflows", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Advanced"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Advanced", { selector: "h2" })).toBeTruthy();
    expect(within(dialog).getByLabelText("Verdict health network")).toBeTruthy();
    expect(within(dialog).getByText("Changed, blocked or escalated")).toBeTruthy();
    expect(within(dialog).getByTestId("workflows-card")).toBeTruthy();
    // it is a window, not a block added to the bottom of the page
    expect(screen.getByTestId("recent-decisions").contains(dialog)).toBe(false);
    expect(document.querySelector('[data-testid="advanced-panel"]')).toBe(dialog);
  });

  it("the Advanced window closes with its close button and with Escape", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Advanced"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Close").closest("button")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByText("Advanced"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("workflows-card")).toBeNull();
  });

  it("clicking outside the Advanced window closes it", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Advanced"));
    await screen.findByRole("dialog");
    const overlay = document.querySelector("[data-state='open'].fixed.inset-0") as HTMLElement;
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the Advanced button stands out: filled, with a glow, and larger than the API docs link", async () => {
    renderPage();
    const btn = (await screen.findByText("Advanced")).closest("button")!;
    expect(btn.className).toMatch(/bg-cyan-500\/20/);
    expect(btn.className).toMatch(/shadow-/);
    expect(btn.className).toMatch(/text-sm/);
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("API docs is a small secondary link, not a big button", async () => {
    renderPage();
    const link = await screen.findByText("API docs");
    expect(link.className).toMatch(/text-xs/);
    expect(link.className).not.toMatch(/border/);
  });

  it("an API key that never received traffic is one click away in 'needs attention', not a big card", async () => {
    state.tables.api_keys = [{ id: "k1", name: "Key 1" }, { id: "k2", name: "Idle key" }];
    renderPage();
    const bar = await screen.findByTestId("status-bar");
    expect(within(bar).queryByText(/never received traffic/)).toBeNull();
    fireEvent.click(await within(bar).findByText(/thing needs attention|things need attention/));
    expect(within(bar).getByText('API key "Idle key" has never received traffic.')).toBeTruthy();
    expect(within(bar).getByText("Send test evaluation")).toBeTruthy();
  });

  it("a brand-new account (key, no tools, no decisions) gets helpful empty states", async () => {
    state.tables.external_tools = [];
    state.tables.outer_control_evaluations = [];
    renderPage();
    expect(await screen.findByText(/No tools connected yet/)).toBeTruthy();
    expect(screen.getByText(/No decisions yet/)).toBeTruthy();
    expect(screen.getByTestId("health-text").textContent).toMatch(/Connect a tool and start a session/);
    expect(screen.getByTestId("trust-score").textContent).toBe("—");
    await waitFor(() => expect(screen.getAllByText("Connect a tool").length).toBeGreaterThan(0));
  });
});
