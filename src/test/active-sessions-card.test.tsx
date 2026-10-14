import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  tools: [] as unknown[], sessions: [] as unknown[], steps: [] as unknown[], keys: [] as unknown[], memory: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "external_tools" ? state.tools : table === "outer_control_sessions" ? state.sessions
      : table === "outer_control_session_steps" ? state.steps : table === "outer_control_memory" ? state.memory : state.keys;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit"]) q[m] = () => q;
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

import ActiveSessionsCard from "@/components/control/outer/ActiveSessionsCard";
import { toast } from "sonner";

const tool = { id: "t1", name: "Support bot", endpoint_url: "https://bot.example.com/chat", request_format: "generic_json", approved_at: null, last_ok_at: null, last_error: null, last_checked_at: null };
const session = (over: Record<string, unknown>) => ({
  id: "s1", tool_id: "t1", objective: "Draft a reply", status: "running", step_count: 1, max_steps: 5, final_output: null,
  stop_reason: null, pending_kind: null, pending_question: null, started_at: "2026-10-14T00:00:00Z", ...over,
});
const renderCard = () => render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);

describe("ActiveSessionsCard", () => {
  beforeEach(() => {
    state.tools = []; state.sessions = []; state.steps = []; state.keys = []; state.memory = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
  });

  it("invites the person to connect a tool when there is none", async () => {
    renderCard();
    expect(await screen.findByText(/No tool connected yet/)).toBeTruthy();
  });

  it("lists a connected tool with its host and approval state", async () => {
    state.tools = [tool];
    renderCard();
    expect(await screen.findByText("Support bot")).toBeTruthy();
    expect(screen.getByText("bot.example.com")).toBeTruthy();
    expect(screen.getByText(/needs first-contact approval/)).toBeTruthy();
  });

  it("a session waiting on a question shows it and sends the typed answer", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "awaiting_human", pending_kind: "question", pending_question: "Which order?" })];
    renderCard();
    expect(await screen.findByText("The tool asks: Which order?")).toBeTruthy();
    const send = screen.getByText("Send").closest("button")!;
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Order 42" } });
    fireEvent.click(send);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/outer-control-drive$/);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "answer", session_id: "s1", answer: "Order 42" });
  });

  it("a session waiting on approval links to the approval queue instead of an answer box", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "awaiting_human", pending_kind: "reply_approval" })];
    renderCard();
    expect(await screen.findByText(/reply needs your approval/)).toBeTruthy();
    expect(screen.getByText("Open the approval queue")).toBeTruthy();
    expect(screen.queryByLabelText("Your answer")).toBeNull();
  });

  it("an opened session shows its steps and result; finished sessions have no cancel", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "completed", final_output: "Here is the reply." })];
    state.steps = [{ id: "a", step_no: 1, attempt: 1, verdict: "allow", next_action: "finish", error: null, note: null, reply_text: "x" }];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    expect(await screen.findByText("Step 1 — verdict allow — accepted, finished")).toBeTruthy();
    expect(screen.getByText("Here is the reply.")).toBeTruthy();
    expect(screen.queryByText(/Cancel session/)).toBeNull();
  });

  it("a hand-off shows its summary and options, marks the recommendation, and sends the choice with the note", async () => {
    state.tools = [tool];
    state.sessions = [session({
      status: "awaiting_human", pending_kind: "handoff",
      handoff: {
        kind: "rule_exhausted", title: "Support bot keeps breaking a rule on step 1",
        summary: ["Step 1: the reply broke No price quotes.", "Nothing from the rejected replies was used."],
        options: [{ id: "retry", label: "Ask again with my note", description: "One more try." }, { id: "stop", label: "Stop the session", description: "Ends it." }],
        recommended: "retry",
      },
    })];
    renderCard();
    expect(await screen.findByText("Support bot keeps breaking a rule on step 1")).toBeTruthy();
    expect(screen.getByText("Step 1: the reply broke No price quotes.")).toBeTruthy();
    expect(screen.getByText(/Ask again with my note · recommended/)).toBeTruthy();
    expect(screen.queryByText(/Stop the session · recommended/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Note to the tool"), { target: { value: "Quote only public prices" } });
    fireEvent.click(screen.getByText(/Ask again with my note/));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "decide", session_id: "s1", option: "retry", note: "Quote only public prices" });
  });

  it("stopping from a hand-off sends no note; the remembered decisions are listed when a session is opened", async () => {
    state.tools = [tool];
    state.sessions = [session({
      status: "awaiting_human", pending_kind: "handoff",
      handoff: { kind: "tool_failed", title: "No usable reply", summary: ["Step 1: failed."], options: [{ id: "retry", label: "Try again now", description: "" }, { id: "stop", label: "Stop the session", description: "" }], recommended: "stop" },
    })];
    state.memory = [{ id: "m1", kind: "rejection", summary: "Step 1: the reply broke \"No price quotes\" and was rejected." }];
    renderCard();
    fireEvent.click(await screen.findByText(/Stop the session · recommended/));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "decide", session_id: "s1", option: "stop" });
    fireEvent.click(screen.getByText("Draft a reply"));
    expect(await screen.findByText(/Decisions remembered for later steps/)).toBeTruthy();
    expect(screen.getByText(/broke "No price quotes" and was rejected/)).toBeTruthy();
  });

  it("a workflow step is labelled as such", async () => {
    state.tools = [tool];
    state.sessions = [session({ workflow_id: "w1", leg_no: 2, status: "queued" })];
    renderCard();
    expect(await screen.findByText(/workflow step 2/)).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
  });

  it("writing the reply myself: starts from the rejected reply, sends the text, and shows what the server says when it is refused", async () => {
    state.tools = [tool];
    state.sessions = [session({
      status: "awaiting_human", pending_kind: "handoff",
      handoff: {
        kind: "rule_exhausted", title: "Support bot keeps breaking a rule", summary: ["Step 1: broke a rule."], recommended: "retry",
        options: [{ id: "retry", label: "Ask again with my note", description: "" }, { id: "edit", label: "Write the reply myself", description: "" }, { id: "stop", label: "Stop the session", description: "" }],
        draft: "I will drop table customers.",
      },
    })];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, error: "edit_refused", message: 'That text breaks "Destructive wording". Change it and try again.' }) })));
    renderCard();
    fireEvent.click(await screen.findByText("Write the reply myself"));
    const box = screen.getByLabelText("Your reply") as HTMLTextAreaElement;
    expect(box.value).toBe("I will drop table customers.");
    fireEvent.change(box, { target: { value: "Refunds are available within 30 days." } });
    fireEvent.click(screen.getByText("Use this reply"));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "decide", session_id: "s1", option: "edit", text: "Refunds are available within 30 days." });
    expect(toast.error).toHaveBeenCalledWith('That text breaks "Destructive wording". Change it and try again.');
    expect(screen.getByLabelText("Your reply")).toBeTruthy(); // stays open so the person can fix the text
    fireEvent.click(screen.getByText("Back"));
    expect(screen.queryByLabelText("Your reply")).toBeNull();
  });
});

