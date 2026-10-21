import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({ tools: [] as unknown[], workflows: [] as unknown[], legs: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "external_tools" ? state.tools : table === "outer_control_workflows" ? state.workflows : table === "outer_control_sessions" ? state.legs : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "neq", "in", "order", "limit"]) q[m] = () => q;
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

const OK_AT = new Date().toISOString();
const HEALTHY = { approved_at: OK_AT, last_ok_at: OK_AT, last_checked_at: OK_AT, last_error: null };
const T1 = { id: "t1", name: "Research Bot", ...HEALTHY };
const T2 = { id: "t2", name: "Writer Bot", ...HEALTHY };
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;

describe("WorkflowsCard", () => {
  beforeEach(() => {
    state.tools = [T1, T2]; state.workflows = []; state.legs = [];
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, workflow_id: "w1" }) })));
  });

  it("shows the last 3 workflows and keeps the rest behind View all", async () => {
    state.workflows = [1, 2, 3, 4, 5].map((n) => ({ id: `w${n}`, objective: `Goal ${n}`, status: "completed", summary: null, started_at: "2026-10-14T00:00:00Z" }));
    render(<WorkflowsCard accountId="u1" />);
    expect(await screen.findByText("Goal 1")).toBeTruthy();
    expect(screen.queryByText("Goal 4")).toBeNull();
    fireEvent.click(screen.getByText("View all (5)"));
    expect(screen.getByText("Goal 5")).toBeTruthy();
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
    expect(screen.getByText(/Needs you in Connected tools/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string)).toEqual({ action: "cancel_workflow", workflow_id: "w1" });
  });

  it("sends a conditional step: the second step runs only if the first result contains a word", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByText("New workflow"));
    fireEvent.change(screen.getByLabelText("Workflow goal"), { target: { value: "Route a request" } });
    fireEvent.change(screen.getByLabelText("Tool for step 1"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Instruction for step 1"), { target: { value: "Classify" } });
    fireEvent.click(screen.getByText("Add step"));
    fireEvent.change(screen.getByLabelText("Tool for step 2"), { target: { value: "t2" } });
    fireEvent.change(screen.getByLabelText("Instruction for step 2"), { target: { value: "Handle exchanges" } });
    fireEvent.change(screen.getByLabelText("When step 2 runs"), { target: { value: "contains" } });
    fireEvent.change(screen.getByLabelText("Condition text for step 2"), { target: { value: "exchange" } });
    fireEvent.click(screen.getByText("Start workflow"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string).legs[1]).toEqual({
      tool_id: "t2", instruction: "Handle exchanges", depends_on: [], condition: { leg: 1, op: "contains", value: "exchange" },
    });
  });

  it("an error branch needs no text, and a half-filled condition is refused", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByText("New workflow"));
    fireEvent.change(screen.getByLabelText("Workflow goal"), { target: { value: "Be robust" } });
    fireEvent.change(screen.getByLabelText("Tool for step 1"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Instruction for step 1"), { target: { value: "Main" } });
    fireEvent.click(screen.getByText("Add step"));
    fireEvent.change(screen.getByLabelText("Tool for step 2"), { target: { value: "t2" } });
    fireEvent.change(screen.getByLabelText("Instruction for step 2"), { target: { value: "Plan B" } });
    fireEvent.change(screen.getByLabelText("When step 2 runs"), { target: { value: "contains" } });
    fireEvent.click(screen.getByText("Start workflow"));
    expect(toast.error).toHaveBeenCalledWith("Step 2: say which text the condition looks for.");
    expect(calls().length).toBe(0);
    fireEvent.change(screen.getByLabelText("When step 2 runs"), { target: { value: "dep_failed" } });
    expect(screen.queryByLabelText("Condition text for step 2")).toBeNull();
    fireEvent.click(screen.getByText("Start workflow"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string).legs[1].condition).toEqual({ leg: 1, op: "dep_failed" });
  });
});



describe("WorkflowsCard: goal Tasks", () => {
  const goalTask = (over: Record<string, unknown> = {}) => ({
    id: "g1", objective: "Find the return rules", status: "running", summary: "1 of 2 criteria met; round 1 of 4.", started_at: "2026-10-20T00:00:00Z", kind: "chain",
    mode: "goal", max_rounds: 4, rounds_used: 1, blocked_reason: null, final_artifact: null,
    criteria_state: [
      { id: "c1", text: "States the return window", met: true, evidence: "within thirty days of purchase", round: 1 },
      { id: "c2", text: "States the refund time", met: false, evidence: null, round: null },
    ], ...over,
  });
  beforeEach(() => {
    state.tools = [T1, T2, { id: "rw", name: "NazAI report writer", endpoint_url: "nazai-internal://report" }]; state.workflows = []; state.legs = [];
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, task_id: "g1" }) })));
  });

  it("shows a running goal Task as In progress with its criteria, the evidence and the round", async () => {
    state.workflows = [goalTask()];
    render(<WorkflowsCard accountId="u1" />);
    expect((await screen.findByTestId("goal-headline")).textContent).toBe("In progress");
    expect(screen.getByTestId("goal-rounds").textContent).toBe("Round 1 of 4");
    expect(screen.getByTestId("goal-met").textContent).toMatch(/1 of 2 done criteria met/);
    const rows = screen.getAllByTestId("goal-criterion");
    expect(rows.map((r) => r.getAttribute("data-met"))).toEqual(["true", "false"]);
    expect(rows[0].textContent).toMatch(/within thirty days of purchase/);
    expect(screen.queryByTestId("goal-blocked")).toBeNull();
  });

  it("shows a blocked goal Task with the reason and three ways out, and sends the owner's choice", async () => {
    state.workflows = [goalTask({ status: "awaiting_human", blocked_reason: "4 rounds were used and these criteria are still not met: \"States the refund time\". Accept the result as it is, allow more rounds, or stop." })];
    render(<WorkflowsCard accountId="u1" />);
    expect((await screen.findByTestId("goal-headline")).textContent).toBe("Blocked");
    expect(screen.getByTestId("goal-blocked").textContent).toMatch(/4 rounds were used/);
    fireEvent.click(screen.getByText("Allow 2 more rounds"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string)).toEqual({ action: "task_decide", task_id: "g1", decision: "more" });
    fireEvent.click(screen.getByText("Accept as done"));
    await waitFor(() => expect(calls().length).toBe(2));
    expect(JSON.parse((calls()[1][1] as RequestInit).body as string).decision).toBe("accept");
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(calls().length).toBe(3));
    expect(JSON.parse((calls()[2][1] as RequestInit).body as string).decision).toBe("stop");
  });

  it("does not offer more rounds at the maximum", async () => {
    state.workflows = [goalTask({ status: "awaiting_human", blocked_reason: "Rounds used up.", max_rounds: 10, rounds_used: 10 })];
    render(<WorkflowsCard accountId="u1" />);
    const more = await screen.findByText("Allow 2 more rounds");
    expect((more as HTMLButtonElement).disabled).toBe(true);
  });

  it("points to Inner Control when a NazAI agent took part in the Task, and not otherwise", async () => {
    state.tools = [T1, { id: "ag1", name: "Agent: Support", agent_id: "a-1" }];
    state.workflows = [goalTask({ status: "completed", blocked_reason: null })];
    state.legs = [{ id: "l1", workflow_id: "g1", leg_no: 1, tool_id: "t1", objective: "x", status: "completed", stop_reason: null, final_output: "x", depends_on: [], final_artifact: null },
      { id: "l2", workflow_id: "g1", leg_no: 2, tool_id: "ag1", objective: "y", status: "completed", stop_reason: null, final_output: "y", depends_on: [1], final_artifact: null }];
    const { unmount } = render(<WorkflowsCard accountId="u1" />);
    const note = await screen.findByTestId("task-agent-note");
    expect(note.textContent).toMatch(/recorded in Inner Control/);
    expect(note.querySelector("a")?.getAttribute("href")).toBe("/control-system");
    unmount();
    state.legs = [state.legs[0]];
    render(<WorkflowsCard accountId="u1" />);
    await screen.findByTestId("goal-progress");
    expect(screen.queryByTestId("task-agent-note")).toBeNull();
  });

  it("a steps Task shows no goal panel", async () => {
    state.workflows = [{ id: "w1", objective: "Write the brief", status: "running", summary: null, started_at: "2026-10-20T00:00:00Z", kind: "chain", mode: "steps" }];
    render(<WorkflowsCard accountId="u1" />);
    await screen.findByText("Write the brief");
    expect(screen.queryByTestId("goal-progress")).toBeNull();
  });

  it("starts a goal Task: goal, criteria per line, up to three tools in order, rounds; the report writer is not offered", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByTestId("new-goal-task"));
    expect(screen.queryByLabelText("Ask NazAI report writer")).toBeNull();
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Find the return rules for premium customers" } });
    fireEvent.change(screen.getByLabelText("Done criteria"), { target: { value: "States the return window\nStates the refund time" } });
    fireEvent.click(screen.getByLabelText("Ask Writer Bot"));
    fireEvent.click(screen.getByLabelText("Ask Research Bot"));
    fireEvent.change(screen.getByLabelText("Most rounds"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string)).toEqual({
      action: "start_goal", goal: "Find the return rules for premium customers", criteria: ["States the return window", "States the refund time"], tool_ids: ["t2", "t1"], max_rounds: 3,
    });
  });

  it("refuses to start without a goal or a tool, and without criteria sends none", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByTestId("new-goal-task"));
    fireEvent.click(screen.getByText("Start"));
    expect((toast.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("Describe the goal.");
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Find it" } });
    fireEvent.click(screen.getByText("Start"));
    expect((toast.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("Choose at least one tool to ask.");
    expect(calls().length).toBe(0);
    fireEvent.click(screen.getByLabelText("Ask Research Bot"));
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string).criteria).toBeUndefined();
  });

  it("goal form: tools named in the goal are offered; Yes ticks them in the order named and they are sent in that order", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByTestId("new-goal-task"));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Ask Writer Bot and Research Bot for the return rules" } });
    expect(screen.getByTestId("tool-plan-named").textContent).toMatch(/You named Writer Bot and Research Bot/);
    fireEvent.click(screen.getByText("Yes, use them"));
    expect(screen.getByTestId("tool-plan-summary").textContent).toBe("Will ask: 1. Writer Bot (named in your request) → 2. Research Bot (named in your request)");
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string)).toMatchObject({ tool_ids: ["t2", "t1"] });
  });

  it("goal form: a named tool that was not ticked blocks Start until the person decides; Keep sends confirm_override", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByTestId("new-goal-task"));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Ask Writer Bot for the return rules" } });
    fireEvent.click(screen.getByLabelText("Ask Research Bot"));
    expect((screen.getByText("Start") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Keep my choice"));
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => expect(calls().length).toBe(1));
    expect(JSON.parse((calls()[0][1] as RequestInit).body as string)).toMatchObject({ tool_ids: ["t1"], confirm_override: true });
  });
});
