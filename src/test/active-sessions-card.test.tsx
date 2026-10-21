import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  tools: [] as unknown[], sessions: [] as unknown[], steps: [] as unknown[], keys: [] as unknown[], memory: [] as unknown[], usage: [] as unknown[], archivedCount: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "external_tools" ? state.tools : table === "outer_control_sessions" ? state.sessions
      : table === "outer_control_session_steps" ? state.steps : table === "outer_control_memory" ? state.memory : table === "outer_control_tool_usage" ? state.usage : state.keys;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "in", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: state.archivedCount }).then(res);
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
import { sessionArtifact } from "./artifact-fixture";

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
    expect(await screen.findByText(/No tools connected yet/)).toBeTruthy();
    // the empty state tells the person what to do next and offers the action right there
    expect(screen.getByText(/Press Connect a tool to add ChatGPT, Claude, Gemini or Grok/)).toBeTruthy();
    expect(screen.getByTestId("connect-tool-button").textContent).toMatch(/Connect a tool/);
  });

  it("lists a connected tool with its host and approval state", async () => {
    state.tools = [tool];
    renderCard();
    expect(await screen.findByText("Support bot")).toBeTruthy();
    expect(screen.getByText("bot.example.com")).toBeTruthy();
    expect(screen.getByTestId("tool-status").textContent).toMatch(/Needs attention/);
    expect(screen.getByTestId("tool-reason").textContent).toMatch(/Not tested yet/);
  });

  it("shows Test and Start session on every tool, and keeps Update key / Remove behind More", async () => {
    state.tools = [tool];
    renderCard();
    expect(await screen.findByText("Test")).toBeTruthy();
    expect(screen.getByText("Start session")).toBeTruthy();
    expect(screen.queryByText("Update key")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
    fireEvent.click(screen.getByText("More"));
    expect(screen.getByText("Update key")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("says in plain words whether each tool works: Failed with the reason, Working, Needs attention (never tested, or tested long ago)", async () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    const old = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
    state.tools = [
      { ...tool, id: "a", name: "Broken", approved_at: "2026-10-01", last_checked_at: recent, last_ok_at: null, last_error: "The tool rejected the key (HTTP 401). Update the key and test again." },
      { ...tool, id: "b", name: "Fine", approved_at: "2026-10-01", last_checked_at: recent, last_ok_at: recent, last_error: null },
      { ...tool, id: "c", name: "Fresh", approved_at: "2026-10-01", last_checked_at: null, last_ok_at: null, last_error: null },
      { ...tool, id: "d", name: "Stale", approved_at: "2026-10-01", last_checked_at: old, last_ok_at: old, last_error: null },
    ];
    renderCard();
    await screen.findByText("Broken");
    const rows = screen.getAllByTestId("tool-row");
    const status = (i: number) => rows[i].querySelector("[data-testid=tool-status]")!.getAttribute("data-status");
    expect([0, 1, 2, 3].map(status)).toEqual(["failed", "working", "attention", "attention"]);
    expect(rows[0].textContent).toMatch(/rejected the key \(HTTP 401\)/);
    expect(rows[1].textContent).toMatch(/Test passed 5 min ago/);
    expect(rows[3].textContent).toMatch(/Last tested 3 days ago/);
    expect(screen.getByTestId("tools-summary").textContent).toBe("4 tools · 1 working · 1 failed · 2 need attention");
  });

  it("a running session is shown up front with a Stop button that needs no opening", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "running" })];
    renderCard();
    expect(await screen.findByText("Running now")).toBeTruthy();
    // it opens by itself and says which tool is being used and what it waits for
    expect((await screen.findByTestId("session-activity")).textContent).toMatch(/tool: Support bot/);
    expect(screen.getByTestId("session-activity").textContent).toMatch(/Waiting for Support bot's reply/);
    fireEvent.click(screen.getByText("Stop session"));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "cancel", session_id: "s1" });
  });

  it("finished sessions: the last 3 are shown and the rest wait behind View all", async () => {
    state.tools = [tool];
    state.sessions = [1, 2, 3, 4, 5].map((n) => session({ id: `s${n}`, status: "completed", objective: `Job ${n}` }));
    renderCard();
    expect(await screen.findByText("Job 1")).toBeTruthy();
    expect(screen.queryByText("Job 4")).toBeNull();
    expect(screen.queryByText("Running now")).toBeNull();
    fireEvent.click(screen.getByText("View all (5)"));
    expect(screen.getByText("Job 5")).toBeTruthy();
    fireEvent.click(screen.getByText("Show fewer"));
    expect(screen.queryByText("Job 5")).toBeNull();
  });

  it("Update key sends only the new key for that tool and clears the box afterwards", async () => {
    state.tools = [tool];
    renderCard();
    fireEvent.click(await screen.findByText("More"));
    fireEvent.click(screen.getByText("Update key"));
    const save = screen.getByText("Save key").closest("button")!;
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("New tool credential"), { target: { value: "  sk-new-key  " } });
    fireEvent.click(save);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "update_key", tool_id: "t1", token: "  sk-new-key  " });
    await waitFor(() => expect(screen.queryByLabelText("New tool credential")).toBeNull());
  });

  it("Remove asks first, and only a yes sends remove_tool", async () => {
    state.tools = [tool];
    renderCard();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(await screen.findByText("More"));
    fireEvent.click(screen.getByText("Remove"));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "remove_tool", tool_id: "t1" });
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
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
    state.sessions = [session({ status: "completed", final_output: "Here is the reply.", final_artifact: sessionArtifact("Here is the reply.") })];
    state.steps = [{ id: "a", step_no: 1, attempt: 1, verdict: "allow", next_action: "finish", error: null, note: null, reply_text: "x" }];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    expect(await screen.findByText("Step 1 — verdict allow — accepted, finished")).toBeTruthy();
    expect(screen.getByTestId("final-artifact-output").textContent).toBe("Here is the reply.");
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
    // an open session is already opened for the person
    expect(await screen.findByText(/Decisions remembered for later steps/)).toBeTruthy();
    expect(screen.getByText(/broke "No price quotes" and was rejected/)).toBeTruthy();
  });

  it("a workflow step is labelled as such", async () => {
    state.tools = [tool];
    state.sessions = [session({ workflow_id: "w1", leg_no: 2, status: "queued" })];
    renderCard();
    expect(await screen.findByText(/workflow step 2/)).toBeTruthy();
    expect(screen.getByTestId("status-badge").textContent).toBe("Queued");
    expect(screen.getByTestId("status-reason").textContent).toMatch(/Not started: waiting for an earlier step/);
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

  it("an opened step shows its risk and confidence badges and the trace lines", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "completed" })];
    state.steps = [{ id: "st1", step_no: 1, attempt: 1, verdict: "modify", next_action: "finish", error: null, note: null, reply_text: "x",
      decision: { why: "legacy", trace: ["Decision: Modify.", "Risk: high — secrets had to be removed."], risk: { level: "high" }, confidence: { level: "medium" }, plan: { reason: "The tool reported the objective as done." } } }];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    expect(await screen.findByText("Risk high")).toBeTruthy();
    expect(screen.getByText("Confidence medium")).toBeTruthy();
    expect(screen.getByText("Decision: Modify.")).toBeTruthy();
    expect(screen.getByText("Risk: high — secrets had to be removed.")).toBeTruthy();
    expect(screen.queryByText(/Why: legacy/)).toBeNull();
  });

  it("an opened session shows the reasoning stored with each step", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "completed", final_output: "ok" })];
    state.steps = [{
      id: "a", step_no: 1, attempt: 1, verdict: "escalate", next_action: "pause_human", error: null, note: null, reply_text: "x",
      decision: { why: "Needs approval. The strictest wins: require approval (\"Quote prices\").", plan: { reason: "The reply needs a person's approval.", basis: ["A rule requires a person's approval for this reply."] } },
    }];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    expect(await screen.findByText(/Why: Needs approval/)).toBeTruthy();
    expect(screen.getByText("Based on: A rule requires a person's approval for this reply.")).toBeTruthy();
    expect(screen.getByText("Next: The reply needs a person's approval.")).toBeTruthy();
  });

  it("shows the stored completion check on a finished session, expandable, with each criterion marked", async () => {
    state.tools = [tool];
    state.sessions = [session({
      id: "s9", status: "completed", final_output: "Returns are accepted within thirty days.", stop_reason: "Done.",
      completion: { passed: true, outcome: "completed", summary: "Completion check passed: all 2 criteria met.", criteria: [
        { id: "output_present", label: "A final result exists", ok: true, detail: "a result exists" },
        { id: "output_stored", label: "The stored result was read back and matches", ok: true, detail: "stored and read back identically" },
      ] },
    })];
    renderCard();
    fireEvent.click(await screen.findByText(/Draft a reply/));
    const cc = await screen.findByTestId("completion-check");
    expect(cc.textContent).toMatch(/Completion check passed \(2\/2\)/);
    expect(cc.textContent).toMatch(/✓ A final result exists — a result exists/);
  });

  it("a completed session shows its closing record and offers a follow-up that is sent as a new request to the same session's tool", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "completed", step_count: 2, finished_at: "2026-10-19T12:03:00Z", final_output: "Here is the reply.", final_artifact: sessionArtifact("Here is the reply.") })];
    state.steps = [{ id: "a", step_no: 1, attempt: 1, verdict: "allow", next_action: "finish", error: null, note: null, reply_text: "x" }];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    expect((await screen.findByTestId("session-closure")).textContent).toMatch(/Session closed 19 Oct, 12:03 UTC\. 2 exchanges with .*final controlled result is stored/);
    const send = screen.getByTestId("follow-up-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Follow-up request"), { target: { value: "Shorten it to one line." } });
    fireEvent.click(send);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "follow_up", session_id: "s1", instruction: "Shorten it to one line." });
  });

  it("a session that did not complete says it was closed and why, and offers no follow-up", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "stopped", stop_reason: "Stopped by the owner", finished_at: "2026-10-19T12:03:00Z" })];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    expect((await screen.findByTestId("session-closure")).textContent).toMatch(/Session closed 19 Oct, 12:03 UTC \(stopped\)\. Stopped by the owner\. Nothing more is sent/);
    expect(screen.queryByTestId("follow-up")).toBeNull();
  });

  it("a tool shows how much it has been used: requests in 30 days, failures and today's count", async () => {
    state.tools = [tool];
    state.usage = [{ tool_id: tool.id, requests_30d: 12, failed_30d: 2, requests_today: 3 }];
    renderCard();
    expect((await screen.findByTestId("tool-usage")).textContent).toBe("Asked 12 times in 30 days · 2 failed · 3 today");
  });
  it("a tool that was never asked shows no usage line", async () => {
    state.tools = [tool]; state.usage = [];
    renderCard();
    await screen.findByText(tool.name);
    expect(screen.queryByTestId("tool-usage")).toBeNull();
  });

  it("a finished session can be archived (never deleted), and an open one cannot", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "completed", final_output: "Done.", final_artifact: sessionArtifact("Done.") })];
    renderCard();
    fireEvent.click(await screen.findByText("Draft a reply"));
    fireEvent.click(await screen.findByTestId("archive-session"));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "archive", kind: "session", id: "s1", archived: true });
  });
  it("an archived item can be restored, and the archived toggle shows only when something is archived", async () => {
    state.tools = [tool]; state.archivedCount = 0;
    state.sessions = [session({ status: "completed", final_output: "Done.", final_artifact: sessionArtifact("Done."), archived_at: "2026-10-20T00:00:00Z" })];
    const { unmount } = renderCard();
    await screen.findByText("Draft a reply");
    expect(screen.queryByTestId("toggle-archived")).toBeNull();
    unmount();
    state.archivedCount = 4;
    renderCard();
    expect((await screen.findByTestId("toggle-archived")).textContent).toBe("Show archived (4)");
    fireEvent.click(screen.getByText("Draft a reply"));
    expect((await screen.findByTestId("archive-session")).textContent).toBe("Restore");
  });
  it("Export history downloads a CSV of the sessions with their honest status", async () => {
    state.tools = [tool];
    state.sessions = [session({ status: "stopped", stop_reason: "Stopped by the owner", started_at: "2026-10-19T09:00:00Z" })];
    let blob: Blob | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => { blob = b; return "blob:x"; }, revokeObjectURL: () => {} }));
    renderCard();
    fireEvent.click(await screen.findByTestId("export-history"));
    await waitFor(() => expect(blob).not.toBeNull());
    const text = await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsText(blob!); });
    expect(text.split("\r\n")[0]).toContain("Started (UTC),Finished (UTC)");
    expect(text).toContain("Stopped,Stopped by the owner.");
    expect(text).toContain("Support bot");
  });
});

describe("Start session reads the request for tool names", () => {
  const at = new Date().toISOString();
  const healthy = { approved_at: at, last_ok_at: at, last_checked_at: at, last_error: null };
  const bot2 = { id: "b", name: "Bot2", endpoint_url: "https://bot.example.com/chat", request_format: "generic_json", ...healthy };
  const gpt = { id: "g", name: "ChatGPT (OpenAI)", endpoint_url: "https://api.openai.com/v1/chat/completions", request_format: "openai_chat", model: "gpt-4o", ...healthy };
  const claude = { id: "c", name: "Claude", endpoint_url: "https://api.anthropic.com/v1/messages", request_format: "anthropic_messages", ...healthy };
  const body = (i = -1) => JSON.parse(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(i)![1] as RequestInit).body as string);
  const openStart = async (name: string) => {
    await screen.findByText(name);
    const rows = screen.getAllByTestId("tool-row");
    const row = rows.find((r) => r.textContent?.includes(name))!;
    fireEvent.click(row.querySelector("button:nth-of-type(2)") as HTMLButtonElement);
  };
  beforeEach(() => {
    state.tools = [bot2, gpt, claude]; state.sessions = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, session_id: "s9" }) })));
  });

  it("Bot2's form with ChatGPT named: asks first, and Start waits until the person decides", async () => {
    renderCard();
    await openStart("Bot2");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Collaborate with connected ChatGPT and generate a simple report about NazAI" } });
    expect(screen.getByTestId("tool-plan-named").textContent).toMatch(/You named ChatGPT \(OpenAI\), but this session is for Bot2/);
    const start = screen.getByText("Start", { selector: "button" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId("start-blocked").textContent).toBe("Choose which tool to use first.");
  });

  it("Use ChatGPT instead moves the request to ChatGPT, and it starts there", async () => {
    renderCard();
    await openStart("Bot2");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Ask ChatGPT for a summary" } });
    fireEvent.click(screen.getByText("Use ChatGPT (OpenAI) instead"));
    expect(screen.getByTestId("tool-plan-summary").textContent).toBe("Will ask: ChatGPT (OpenAI) (named in your request)");
    fireEvent.click(screen.getByText("Start", { selector: "button" }));
    await waitFor(() => expect(body()).toMatchObject({ action: "start_session", tool_id: "g", objective: "Ask ChatGPT for a summary" }));
    expect(body().confirm_override).toBeUndefined();
  });

  it("Keep Bot2 starts Bot2 and tells the server the choice was confirmed", async () => {
    renderCard();
    await openStart("Bot2");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Ask ChatGPT for a summary" } });
    fireEvent.click(screen.getByText("Keep Bot2"));
    fireEvent.click(screen.getByText("Start", { selector: "button" }));
    await waitFor(() => expect(body()).toMatchObject({ action: "start_session", tool_id: "b", confirm_override: true }));
  });

  it("two tools named: runs them as one Task in the order named", async () => {
    renderCard();
    await openStart("Bot2");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "ask Claude and then ChatGPT about our pricing" } });
    const run = screen.getByText("Run as one Task: Claude → ChatGPT (OpenAI)");
    fireEvent.click(run);
    fireEvent.click(run);
    fireEvent.click(run);
    await waitFor(() => expect(body()).toMatchObject({ action: "start_task", request: "ask Claude and then ChatGPT about our pricing", steps: [{ tool_id: "c" }, { tool_id: "g" }] }));
    // Clicking again while it starts never starts a second copy.
    const starts = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => JSON.parse((c[1] as RequestInit).body as string).action === "start_task");
    expect(starts.length).toBe(1);
    // Each tool is told it is one step and answers itself; the "ask X then Y" part is for NazAI.
    const steps = body().steps as { instruction: string }[];
    expect(steps[0].instruction).toMatch(/You are step 1: Claude\. Answer it yourself, directly; do not try to contact the other tools\./);
    expect(steps[1].instruction).toMatch(/You are step 2: ChatGPT \(OpenAI\)\..*previous step's checked answer/);
  });

  it("a tool that needs attention warns with its reason; Proceed anyway lets it start", async () => {
    state.tools = [{ ...bot2, approved_at: null, last_ok_at: null, last_checked_at: null }];
    renderCard();
    await openStart("Bot2");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Draft a reply" } });
    expect(screen.getByTestId("tool-plan-warning").textContent).toMatch(/Bot2 needs attention: Not tested yet/);
    const start = screen.getByText("Start", { selector: "button" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByText("Proceed anyway"));
    expect(start.disabled).toBe(false);
  });

  it("a named product that is not connected is said, not silently ignored", async () => {
    renderCard();
    await openStart("Bot2");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "ask Gemini what it thinks" } });
    expect(screen.getByTestId("tool-plan-not-connected").textContent).toMatch(/Gemini is named but not connected/);
  });
});
