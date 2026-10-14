import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({ tools: [] as unknown[], workflows: [] as unknown[], legs: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "external_tools" ? state.tools : table === "outer_control_workflows" ? state.workflows : state.legs;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
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
import { toast } from "sonner";

const T1 = { id: "t1", name: "Research Bot" };
const T2 = { id: "t2", name: "Writer Bot" };
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;

describe("WorkflowsCard", () => {
  beforeEach(() => {
    state.tools = [T1, T2]; state.workflows = []; state.legs = [];
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, workflow_id: "w1" }) })));
  });

  it("starts with an empty state that explains parallel steps", async () => {
    render(<WorkflowsCard accountId="u1" />);
    expect(await screen.findByText(/run at the same time/)).toBeTruthy();
  });

  it("builds a two-step workflow where the second step waits for the first, and sends it", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByText("New workflow"));
    fireEvent.change(screen.getByLabelText("Workflow goal"), { target: { value: "Write the brief" } });
    fireEvent.change(screen.getByLabelText("Tool for step 1"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Instruction for step 1"), { target: { value: "Gather facts" } });
    fireEvent.click(screen.getByText("Add step"));
    expect(screen.getAllByTestId("draft-leg")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Tool for step 2"), { target: { value: "t2" } });
    fireEvent.change(screen.getByLabelText("Instruction for step 2"), { target: { value: "Draft it" } });
    fireEvent.click(screen.getByLabelText("step 1"));
    fireEvent.click(screen.getByText("Start workflow"));
    await waitFor(() => expect(calls().length).toBe(1));
    const body = JSON.parse((calls()[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      action: "start_workflow", objective: "Write the brief",
      legs: [{ tool_id: "t1", instruction: "Gather facts", depends_on: [] }, { tool_id: "t2", instruction: "Draft it", depends_on: [1] }],
    });
  });

  it("refuses to send an incomplete form and says what is missing", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByText("New workflow"));
    fireEvent.click(screen.getByText("Start workflow"));
    expect(toast.error).toHaveBeenCalledWith("Step 1: choose a tool.");
    expect(calls().length).toBe(0);
  });

  it("shows each workflow with its steps, their states and what they wait for", async () => {
    state.workflows = [{ id: "w1", objective: "Write the brief", status: "awaiting_human", summary: "1 of 2 steps completed; a person is needed.", started_at: "2026-10-15T00:00:00Z" }];
    state.legs = [
      { id: "a", workflow_id: "w1", leg_no: 1, tool_id: "t1", objective: "Gather", status: "completed", stop_reason: null, final_output: "x", depends_on: [] },
      { id: "b", workflow_id: "w1", leg_no: 2, tool_id: "t2", objective: "Draft", status: "awaiting_human", stop_reason: null, final_output: null, depends_on: [1] },
    ];
    render(<WorkflowsCard accountId="u1" />);
    expect(await screen.findByText("Write the brief")).toBeTruthy();
    expect(screen.getByText(/1 of 2 steps completed/)).toBeTruthy();
    expect(screen.getByText("after step 1")).toBeTruthy();
    expect(screen.getByText(/needs you in Active sessions/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string)).toEqual({ action: "cancel_workflow", workflow_id: "w1" });
  });
});
