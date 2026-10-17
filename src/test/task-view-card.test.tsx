import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, neq: [] as unknown[][], drive: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = () => q;
    q.neq = (...a: unknown[]) => { state.neq.push([table, ...a]); return q; };
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(res);
    return q;
  };
  return { supabase: { from: result, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } }, SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1", SUPABASE_ANON: "anon" };
});
vi.mock("@/lib/outer-control-drive", () => ({ callDrive: (...a: unknown[]) => state.drive(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WorkflowsCard from "@/components/control/outer/WorkflowsCard";
import { taskArtifact } from "./artifact-fixture";

const wf = (o: Record<string, unknown>) => ({
  id: "w1", objective: "Reply to Dana", status: "running", summary: "1 of 3 steps completed.", started_at: "2026-10-17T00:00:00Z",
  kind: "chain", current_leg: 2, steps_total: 3, steps_done: 1, final_output: null, final_leg: null, failed_leg: null, stop_reason: null, origin: null, ...o,
});
const leg = (n: number, status: string) => ({ id: `l${n}`, workflow_id: "w1", leg_no: n, tool_id: "t1", objective: "x", status, stop_reason: null, final_output: null, depends_on: n > 1 ? [n - 1] : [] });

describe("WorkflowsCard as the Task view", () => {
  beforeEach(() => {
    state.neq = []; state.drive = vi.fn(async () => ({ ok: true, data: { ok: true, created: true }, message: "" }));
    state.tables = { external_tools: [{ id: "t1", name: "Research Bot" }], agents: [{ id: "a1", name: "Support Agent" }], outer_control_workflows: [wf({})], outer_control_sessions: [leg(1, "completed"), leg(2, "running"), leg(3, "queued")], outer_control_task_handoffs: [] };
  });

  it("shows where a running Task is and leaves one-tool runs to the sessions list", async () => {
    render(<WorkflowsCard accountId="u1" />);
    const row = await screen.findByTestId("workflow-row");
    expect(within(row).getAllByTestId("status-badge")[0].textContent).toBe("Running");
    expect(within(row).getAllByTestId("status-reason")[0].textContent).toMatch(/Step 2 of 3 is running; 1 done/);
    expect(state.neq.some((c) => c[0] === "outer_control_workflows" && c[1] === "kind" && c[2] === "single")).toBe(true);
  });

  it("shows the final artifact (controlled result) when the Task completed with a valid one", async () => {
    state.tables.outer_control_workflows = [wf({ status: "completed", current_leg: null, steps_done: 1, steps_total: 1, final_output: "Dear Dana, returns take thirty days.", final_leg: 1, summary: "All 1 steps completed.", final_artifact: taskArtifact() })];
    state.tables.outer_control_sessions = [leg(1, "completed")];
    render(<WorkflowsCard accountId="u1" />);
    const row = await screen.findByTestId("workflow-row");
    expect(within(row).getAllByTestId("status-badge")[0].textContent).toBe("Completed");
    expect(within(row).getByTestId("final-artifact-output").textContent).toBe("Dear Dana, returns take thirty days.");
  });

  it("never shows Completed without a valid final artifact: it shows Failed and says why, with no result", async () => {
    state.tables.outer_control_workflows = [wf({ status: "completed", current_leg: null, steps_done: 3, final_output: "Dear Dana", final_leg: 3, final_artifact: null })];
    render(<WorkflowsCard accountId="u1" />);
    const row = await screen.findByTestId("workflow-row");
    expect(within(row).getAllByTestId("status-badge")[0].textContent).toBe("Failed");
    expect(within(row).getAllByTestId("status-reason")[0].textContent).toMatch(/not accepted: no final artifact is stored/);
    expect(screen.queryByTestId("final-artifact")).toBeNull();
    expect(row.textContent).not.toMatch(/Dear Dana/);
  });

  it("shows a stopped Task as Partially completed with the step and reason, and no final result", async () => {
    state.tables.outer_control_workflows = [wf({ status: "failed", current_leg: null, failed_leg: 2, stop_reason: "The result of step 1 breaks No codename, so it was not passed to step 2.", final_output: "stale" })];
    render(<WorkflowsCard accountId="u1" />);
    const row = await screen.findByTestId("workflow-row");
    expect(within(row).getAllByTestId("status-badge")[0].textContent).toBe("Partially completed");
    expect(within(row).getAllByTestId("status-reason")[0].textContent).toMatch(/1 of 3 steps completed\. The result of step 1 breaks No codename/);
    expect(screen.queryByTestId("final-artifact")).toBeNull();
  });

  it("lists every hand-off with what the rules did, and names an external agent as the origin", async () => {
    state.tables.outer_control_workflows = [wf({ origin: { kind: "external_agent", source_model: "ChatGPT" } })];
    state.tables.outer_control_task_handoffs = [
      { id: "h0", task_id: "w1", from_leg: null, from_label: "ChatGPT", to_leg: 1, outcome: "modified", rules: ["Secrets"], note: "Removed text matching Secrets before passing it to step 1." },
      { id: "h1", task_id: "w1", from_leg: 1, from_label: "Research Bot", to_leg: 2, outcome: "passed", rules: [], note: "Passed to step 2 unchanged." },
    ];
    render(<WorkflowsCard accountId="u1" />);
    expect(await screen.findByText(/Started by an external agent \(ChatGPT\)/)).toBeTruthy();
    const list = await screen.findByTestId("task-handoffs");
    expect(list.textContent).toMatch(/Hand-offs between steps \(2\)/);
    expect(list.textContent).toMatch(/ChatGPT → step 1: Removed text matching Secrets/); expect(list.textContent).toMatch(/Step 1 → step 2: Passed to step 2 unchanged\./);
  });

  it("adds one of the account's agents as a step through the drive function", async () => {
    render(<WorkflowsCard accountId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "New workflow" }));
    fireEvent.change(await screen.findByLabelText("Agent to add as a step"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    await waitFor(() => expect(state.drive).toHaveBeenCalledWith("create_agent_tool", { agent_id: "a1" }));
  });
});
