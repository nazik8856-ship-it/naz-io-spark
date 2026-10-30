// First-value onboarding on Outer Control: a new account starts its first controlled task without the API key step, chooses who
// runs it (NazAI's starter AI or its own AI), and gets the full interface once its first tasks are done.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  user: null as unknown,
  updateUser: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/useActiveAccount", () => ({ useActiveAccount: () => ({ accountId: "u1", loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const q: Record<string, unknown> = {};
    let head = false;
    for (const m of ["eq", "is", "not", "neq", "contains", "in", "order", "limit", "like", "gte"]) q[m] = () => q;
    q.select = (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; };
    q.maybeSingle = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      const rows = state.tables[table] ?? [];
      return Promise.resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, error: null, count: rows.length }).then(res);
    };
    return q;
  };
  return {
    supabase: { from: result, rpc: () => Promise.resolve({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }), updateUser: state.updateUser } },
    SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1",
    SUPABASE_ANON: "anon",
  };
});

import OuterControlSystem from "@/pages/OuterControlSystem";
import { firstValueStage } from "@/components/onboarding/FirstValueBanner";
import { isInternalTool, isStarterTool } from "@/lib/outer-control-tools-ui";

const STARTERS = [
  { id: "st1", name: "NazAI Writer", endpoint_url: "nazai-internal://starter/writer", request_format: "generic_json", approved_at: "2026-10-30", last_ok_at: "2026-10-30", last_error: null, last_checked_at: "2026-10-30" },
  { id: "st2", name: "NazAI Analyst", endpoint_url: "nazai-internal://starter/analyst", request_format: "generic_json", approved_at: "2026-10-30", last_ok_at: "2026-10-30", last_error: null, last_checked_at: "2026-10-30" },
];
const drive: { action: string }[] = [];
const renderAt = (at: string) => render(
  <MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path="/control-system/outer" element={<OuterControlSystem />} />
      <Route path="/dashboard" element={<div>dashboard page</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("first-value onboarding: Outer Control", () => {
  beforeEach(() => {
    state.updateUser.mockClear(); drive.length = 0;
    state.user = { id: "u1", created_at: new Date().toISOString(), user_metadata: {} };
    state.tables = { api_keys: [], external_tools: [], outer_control_workflows: [], outer_control_sessions: [], imported_projects: [], agents: [], websites: [] };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      drive.push(body);
      if (body.action === "starter_tools") { state.tables.external_tools = STARTERS; return new Response(JSON.stringify({ ok: true, tools: STARTERS, used: 0, free: 2 })); }
      if (body.action === "route_task") return new Response(JSON.stringify({ ok: true, kind: "opinions", text: body.request, background: "", labels: [], count: 0, question: "", source: "ai" }));
      return new Response(JSON.stringify({ ok: true }));
    }));
  });

  it("a new account sees its first task, not the API key step, the Inner / Outer switch or the dashboard parts", async () => {
    renderAt("/control-system/outer");
    const banner = await screen.findByTestId("first-value-banner");
    expect(banner.getAttribute("data-stage")).toBe("start");
    expect(screen.queryByText(/Set up API access/)).toBeNull();
    expect(screen.queryByText("Inner")).toBeNull();
    expect(screen.queryByTestId("status-bar")).toBeNull();
    expect(screen.queryByTestId("recent-decisions")).toBeNull();
    expect(screen.getByTestId("active-sessions-card")).toBeTruthy();
  });

  it("an older account without a key or a tool still gets the setup step", async () => {
    state.user = { id: "u1", created_at: "2026-01-01T00:00:00Z", user_metadata: {} };
    renderAt("/control-system/outer");
    expect(await screen.findByText(/Set up API access/)).toBeTruthy();
    expect(screen.queryByTestId("first-value-banner")).toBeNull();
  });

  it("Start now asks who runs the task; NazAI sets up its starter AI and opens Start task", async () => {
    renderAt("/control-system/outer?start=first");
    fireEvent.click(await screen.findByTestId("first-task-nazai"));
    await waitFor(() => expect(drive.map((d) => d.action)).toContain("starter_tools"));
    expect(await screen.findByTestId("task-panel")).toBeTruthy();
  });

  it("with only NazAI's starter AI, Start task ticks its tools and the task is free", async () => {
    state.tables.external_tools = STARTERS;
    renderAt("/control-system/outer?start=task");
    fireEvent.change(await screen.findByLabelText("Describe the task"), { target: { value: "Should we launch a free plan?" } });
    expect(await screen.findByText("Free · one of your 2 free NazAI tasks", {}, { timeout: 4000 })).toBeTruthy();
    for (const t of STARTERS) expect((screen.getByLabelText(`Ask ${t.name}`) as HTMLInputElement).checked).toBe(true);
  });

  it("\"I'll connect my own AI\" opens Connect a tool", async () => {
    renderAt("/control-system/outer?start=first");
    fireEvent.click(await screen.findByTestId("first-task-manual"));
    expect(await screen.findByTestId("connect-panel")).toBeTruthy();
    expect(drive.map((d) => d.action)).not.toContain("starter_tools");
  });

  it("the starter AI is listed as NazAI's own AI, with no key to update", async () => {
    state.tables.external_tools = STARTERS;
    renderAt("/control-system/outer");
    await screen.findByTestId("first-value-banner");
    expect((await screen.findAllByText("NazAI's own AI · free for your first 2 tasks")).length).toBe(2);
  });

  it("a first result ready: Open full NazAI marks the account and goes to the full interface", async () => {
    state.tables.outer_control_workflows = [{ status: "completed" }];
    renderAt("/control-system/outer");
    await waitFor(() => expect(screen.getByTestId("first-value-banner").getAttribute("data-stage")).toBe("ready"));
    fireEvent.click(screen.getByTestId("first-value-open-full"));
    expect(await screen.findByText("dashboard page")).toBeTruthy();
    expect(state.updateUser).toHaveBeenCalledWith({ data: { first_value_done: true } });
  });

  it("after two finished tasks the full interface opens from then on, without a click", async () => {
    state.tables.outer_control_workflows = [{ status: "completed" }, { status: "completed" }];
    renderAt("/control-system/outer");
    await waitFor(() => expect(screen.getByTestId("first-value-banner").getAttribute("data-stage")).toBe("finished"));
    await waitFor(() => expect(state.updateUser).toHaveBeenCalledWith({ data: { first_value_done: true } }));
  });
});

describe("first-value onboarding: pieces", () => {
  it("stages follow the tasks: start, running, ready after one, finished after two", () => {
    expect(firstValueStage({ done: 0, running: false })).toBe("start");
    expect(firstValueStage({ done: 0, running: true })).toBe("running");
    expect(firstValueStage({ done: 1, running: true })).toBe("ready");
    expect(firstValueStage({ done: 2, running: false })).toBe("finished");
  });

  it("the starter AI is internal but shown as a tool; the report writer stays hidden", () => {
    expect(isStarterTool("nazai-internal://starter/writer")).toBe(true);
    expect(isInternalTool("nazai-internal://starter/writer")).toBe(false);
    expect(isInternalTool("nazai-internal://report")).toBe(true);
    expect(isStarterTool("https://api.openai.com/v1")).toBe(false);
  });
});
