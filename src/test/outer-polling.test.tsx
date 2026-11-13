// Lighter polling on the Outer screens (docs/outer-control-polling.md): a refresh while a Task runs reads only what can change,
// and a refresh that fails keeps the list on screen.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ hits: [] as string[], workflows: [] as unknown[], failWorkflows: false }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    state.hits.push(table);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "neq", "in", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      if (table === "outer_control_workflows" && state.failWorkflows) return Promise.resolve({ data: null, error: { message: "down" } }).then(res);
      const data = table === "outer_control_workflows" ? state.workflows : [];
      return Promise.resolve({ data, error: null }).then(res);
    };
    return q;
  };
  return {
    supabase: { from: result, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
    SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1",
    SUPABASE_ANON: "anon",
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WorkflowsCard from "@/components/control/outer/WorkflowsCard";

const running = { id: "w1", objective: "Write the brief", status: "running", summary: null, started_at: "2026-10-14T00:00:00Z" };
const setHidden = (h: boolean) => {
  Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("Workflows card polling", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); state.hits = []; state.workflows = [running]; state.failWorkflows = false; setHidden(false); });
  afterEach(() => { vi.useRealTimers(); setHidden(false); });

  it("the first read loads everything; a refresh while the Task runs does not re-read tools or agents", async () => {
    render(<WorkflowsCard accountId="u1" />);
    await screen.findByText("Write the brief");
    const first = [...state.hits];
    expect(first).toContain("external_tools");
    expect(first).toContain("agents");
    state.hits = [];
    await vi.advanceTimersByTimeAsync(3_100);
    expect(state.hits).toContain("outer_control_workflows");
    expect(state.hits).not.toContain("external_tools");
    expect(state.hits).not.toContain("agents");
  });

  it("a failed refresh keeps the list on screen and waits longer before the next one", async () => {
    render(<WorkflowsCard accountId="u1" />);
    await screen.findByText("Write the brief");
    state.failWorkflows = true;
    state.hits = [];
    await vi.advanceTimersByTimeAsync(3_100);                  // fails
    expect(screen.getByText("Write the brief")).toBeTruthy();  // still there
    const afterFail = state.hits.filter((t) => t === "outer_control_workflows").length;
    state.hits = [];
    await vi.advanceTimersByTimeAsync(3_100);                  // 6 s back-off: nothing yet
    expect(state.hits.filter((t) => t === "outer_control_workflows").length).toBe(0);
    expect(afterFail).toBeGreaterThan(0);
  });

  it("asks for nothing while the tab is hidden", async () => {
    render(<WorkflowsCard accountId="u1" />);
    await screen.findByText("Write the brief");
    setHidden(true);
    state.hits = [];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.hits).toEqual([]);
  });
});
