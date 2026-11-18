// Inner Control Day 1 (#160): the chat runs a task. The card says what runs and what it costs before anything starts; Run starts it
// through control-system-decide (run_task); it shows where the Task is, then the one controlled result with what the rules did.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  invokes: [] as unknown[], startResult: { mode: "task_started", task_id: "t1" } as Record<string, unknown>,
  wf: { status: "running", final_output: null, stop_reason: null } as Record<string, unknown>,
  legs: [{ id: "s1", status: "completed" }, { id: "s2", status: "running" }, { id: "s3", status: "queued" }] as { id: string; status: string }[],
  steps: [] as { verdict: string | null }[],
  poll: null as null | (() => Promise<unknown>),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async (_n: string, o: { body: unknown }) => { state.invokes.push(o.body); return { data: state.startResult, error: null }; } },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "outer_control_sessions" ? state.legs : state.steps, error: null }).then(res);
      return q;
    },
  },
}));
vi.mock("@/lib/outer-control-read", () => ({
  ocRead: () => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq"]) q[m] = () => q; q.maybeSingle = async () => ({ data: state.wf, error: null }); return q; },
}));
vi.mock("@/hooks/usePoller", () => ({
  // Runs the check once each time the card becomes active and again on every render while active: enough to follow it in a test.
  usePoller: (run: () => Promise<unknown>, o: { active: boolean }) => { state.poll = o.active ? run : null; if (o.active) void run(); },
}));

import InnerTaskCard from "@/components/control/InnerTaskCard";
import { changedCount, excerpt, progressLine, rulesLine } from "@/lib/inner-chat-task";

const OFFER = { kind: "opinions", title: "Get multiple opinions", request: "Should a small bakery open on Sundays?", tools: ["NazAI Writer", "NazAI Analyst", "NazAI Reviewer"], credits: 0, free_left: 1, line: "Get multiple opinions with NazAI Writer, NazAI Analyst and NazAI Reviewer, every answer checked against your rules. Free (1 of 2 free NazAI tasks left)." };
const card = (over = {}) => render(<MemoryRouter><InnerTaskCard offer={{ ...OFFER, ...over }} accountId="acct" rulesActive={3} /></MemoryRouter>);

describe("the pure lines", () => {
  it("progress, rules and excerpt", () => {
    expect(progressLine(state.legs, "running")).toBe("Asking the tools: 1 of 2 answers checked against your rules…");
    expect(progressLine([{ status: "completed" }, { status: "completed" }, { status: "running" }], "running")).toBe("Writing the one controlled result…");
    expect(progressLine([], "awaiting_human")).toMatch(/needs you/);
    expect(rulesLine(3, 0)).toBe("Checked against 3 rules · nothing needed changing");
    expect(rulesLine(1, 2)).toBe("Checked against 1 rule · 2 answers changed or held by your rules");
    expect(rulesLine(0, 0)).toMatch(/no rules of your own yet/);
    expect(changedCount([{ verdict: "allow" }, { verdict: "modify" }, { verdict: "block" }, { verdict: null }])).toBe(2);
    expect(excerpt("short")).toEqual({ text: "short", more: false });
    expect(excerpt("a. ".repeat(400)).more).toBe(true);
  });
});

describe("the task card in the Inner chat", () => {
  beforeEach(() => {
    state.invokes = []; state.startResult = { mode: "task_started", task_id: "t1" };
    state.wf = { status: "running", final_output: null, stop_reason: null }; state.steps = [];
    state.legs = [{ id: "s1", status: "completed" }, { id: "s2", status: "running" }, { id: "s3", status: "queued" }];
  });

  it("says what runs and what it costs; nothing starts until Run", () => {
    card();
    expect(screen.getByTestId("inner-task-offer-line").textContent).toBe(OFFER.line);
    expect(screen.getByTestId("inner-task-run").textContent).toBe("Run it (free)");
    expect(state.invokes).toEqual([]);
    fireEvent.click(screen.getByTestId("inner-task-decline"));
    expect(screen.getByTestId("inner-task-card").dataset.phase).toBe("declined");
    expect(screen.getByText("Not run. Nothing was charged.")).toBeTruthy();
    expect(state.invokes).toEqual([]);
  });

  it("a paid task says its credits on the button", () => {
    card({ credits: 1, free_left: 0 });
    expect(screen.getByTestId("inner-task-run").textContent).toBe("Run it (1 credit)");
  });

  it("Run starts it through run_task, follows it, then shows the result with what the rules did", async () => {
    card();
    fireEvent.click(screen.getByTestId("inner-task-run"));
    await waitFor(() => expect(state.invokes).toEqual([{ action: "run_task", kind: "opinions", request: OFFER.request, account_id: "acct" }]));
    expect((await screen.findByTestId("inner-task-progress")).textContent).toMatch(/1 of 2 answers checked/);
    state.wf = { status: "completed", final_output: "BOTTOM LINE\nOpen on Sundays from 8 to 12 [1][2].", stop_reason: null };
    state.steps = [{ verdict: "allow" }, { verdict: "modify" }];
    await act(async () => { await state.poll?.(); }); // the next check
    expect((await screen.findByTestId("inner-task-result")).textContent).toBe("BOTTOM LINE\nOpen on Sundays from 8 to 12 [1][2].");
    expect(screen.getByTestId("inner-task-rules").textContent).toBe("Checked against 3 rules · 1 answer changed or held by your rules");
    expect(screen.getByTestId("inner-task-open").textContent).toMatch(/Outer Control/);
  });

  it("a Task that ends without a result says why; a start that fails stays on the offer with the reason", async () => {
    state.wf = { status: "failed", final_output: null, stop_reason: "Every tool failed." };
    card();
    fireEvent.click(screen.getByTestId("inner-task-run"));
    expect((await screen.findByTestId("inner-task-ended")).textContent).toBe("Every tool failed.");
    state.startResult = { error: "no_credits", message: "You have no credits left." };
    card();
    fireEvent.click(screen.getAllByTestId("inner-task-run").at(-1)!);
    expect((await screen.findByRole("alert")).textContent).toBe("You have no credits left.");
  });
});
