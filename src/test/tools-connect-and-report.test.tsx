import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ tools: [] as unknown[], sessions: [] as unknown[], route: null as Record<string, unknown> | null, routeFails: false }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    const data = table === "external_tools" ? state.tools : table === "outer_control_sessions" ? state.sessions : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
    return q;
  };
  return { supabase: { from: result, auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } }, SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1", SUPABASE_ANON: "anon" };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ActiveSessionsCard from "@/components/control/outer/ActiveSessionsCard";
import { toast } from "sonner";

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const good = (id: string, name: string) => ({ id, name, endpoint_url: `https://${id}.example.com/chat`, request_format: "generic_json", approved_at: ago(500), last_ok_at: ago(3), last_checked_at: ago(3), last_error: null });
const writer = { id: "rw", name: "NazAI report writer", endpoint_url: "nazai-internal://report", request_format: "generic_json", approved_at: ago(500), last_ok_at: ago(3), last_checked_at: ago(3), last_error: null };
const render_ = () => render(<MemoryRouter><ActiveSessionsCard accountId="u1" /></MemoryRouter>);
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe("connecting a tool and generating a report", () => {
  beforeEach(() => {
    state.tools = []; state.sessions = []; state.route = null; state.routeFails = false;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "create_tool") return { ok: true, json: async () => ({ ok: true, tool: { id: "new1" } }) };
      if (body.action === "test_tool") return { ok: true, json: async () => ({ ok: true, ms: 214, sample: "ok, I am here" }) };
      if (body.action === "route_task") {
        if (state.routeFails) return { ok: false, json: async () => ({ error: "busy" }) };
        return { ok: true, json: async () => ({ ok: true, text: body.request, background: "", labels: [], count: 0, question: "", source: "ai", ...state.route }) };
      }
      return { ok: true, json: async () => ({ ok: true, task_id: "w1" }) };
    }));
  });

  it("connecting from the panel saves the tool, then tests it, and shows the real result", async () => {
    render_();
    fireEvent.click(await screen.findByTestId("connect-tool-button"));
    fireEvent.click(screen.getByTestId("custom-connector"));
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "Docs server" } });
    fireEvent.change(screen.getByLabelText("Tool address"), { target: { value: "https://docs.example.com/api" } });
    fireEvent.click(screen.getByText("Connect and test"));
    await waitFor(() => expect(calls().map((c) => c.action)).toEqual(["create_tool", "test_tool"]));
    expect(calls()[0]).toMatchObject({ name: "Docs server", endpoint_url: "https://docs.example.com/api", request_format: "generic_json" });
    expect(calls()[1]).toEqual({ action: "test_tool", tool_id: "new1" });
    await waitFor(() => expect((toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('Docs server works (214 ms). It replied: "ok, I am here"'));
  });

  it("a failed test is shown with its reason", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "create_tool") return { ok: true, json: async () => ({ ok: true, tool: { id: "new1" } }) };
      return { ok: true, json: async () => ({ ok: false, error: "The tool rejected the key (HTTP 401). Update the key and test again." }) };
    });
    render_();
    fireEvent.click(await screen.findByTestId("connect-tool-button"));
    fireEvent.click(screen.getAllByTestId("featured-tool")[0]);
    fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByText("Connect and test"));
    await waitFor(() => expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/failed the test: The tool rejected the key \(HTTP 401\)/);
  });

  it("Start task works with one tool; the internal report writer is not listed as a tool and not offered", async () => {
    state.tools = [good("a", "ChatGPT"), writer];
    render_();
    await screen.findByText("ChatGPT");
    expect(screen.getAllByTestId("tool-row").length).toBe(1);
    expect(screen.queryByText("NazAI report writer")).toBeNull();
    const btn = screen.getByTestId("start-task-button") as HTMLButtonElement;
    expect(btn.textContent).toMatch(/Start task/);
    expect(btn.disabled).toBe(false);
    expect(screen.queryByText("Generate report")).toBeNull();
  });


  // The blank box: the person describes the task; NazAI reads it about a second after typing stops.
  const describe = async (request: string) => {
    fireEvent.click(await screen.findByTestId("start-task-button"));
    expect(screen.queryAllByRole("radio")).toEqual([]);
    const box = screen.getByLabelText("Describe the task") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("");
    fireEvent.change(box, { target: { value: request } });
    expect(await screen.findByText("NazAI is reading your request…")).toBeTruthy();
  };
  const planLine = () => screen.findByTestId("task-plan-line", {}, { timeout: 3000 });
  const lastStart = () => calls().filter((c) => c.action === "start_report").at(-1);

  it("opinions: NazAI reads the request, says what it will do, and asks the chosen tools in the chosen order", async () => {
    state.tools = [good("a", "ChatGPT"), good("b", "Claude"), good("c", "Grok"), writer];
    state.route = { kind: "opinions" };
    render_();
    await describe("Should we adopt a control layer?");
    expect((await planLine()).textContent).toBe("NazAI will: Get multiple opinions");
    expect(calls().filter((c) => c.action === "route_task")).toEqual([{ action: "route_task", request: "Should we adopt a control layer?" }]);
    const change = screen.getByLabelText("Change the action") as HTMLSelectElement;
    expect(change.value).toBe("opinions");
    expect(change.options.length).toBe(14);
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.textContent).toBe("Get opinions");
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId("task-problem").textContent).toBe("Choose at least one tool to ask.");
    fireEvent.click(screen.getByLabelText("Ask Grok"));
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
    fireEvent.click(screen.getByLabelText("Ask Claude"));
    expect(screen.getByTestId("task-plan-line").textContent).toBe("NazAI will: Get multiple opinions · Grok → ChatGPT → Claude");
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "opinions", topic: "Should we adopt a control layer?", tool_ids: ["c", "a", "b"] }));
  });

  it("compare: needs 2 or 3 tools; a fourth can not be ticked", async () => {
    state.tools = [good("a", "Alpha"), good("b", "Beta"), good("c", "Gamma"), good("d", "Delta"), writer];
    state.route = { kind: "compare" };
    render_();
    await describe("Write a two-line product description for a water bottle.");
    expect((await planLine()).textContent).toBe("NazAI will: Compare answers");
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    expect(screen.getByTestId("task-problem").textContent).toBe("Choose at least 2 tools.");
    fireEvent.click(screen.getByLabelText("Ask Beta"));
    fireEvent.click(screen.getByLabelText("Ask Gamma"));
    expect((screen.getByLabelText("Ask Delta") as HTMLInputElement).disabled).toBe(true);
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.textContent).toBe("Compare");
    fireEvent.click(start);
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "compare", topic: "Write a two-line product description for a water bottle.", tool_ids: ["a", "b", "c"] }));
  });

  it("fact-check: only the claim NazAI found is sent; a tool name in the claim is content, not a choice of tool", async () => {
    state.tools = [good("a", "ChatGPT"), good("b", "Beta"), writer];
    const claim = "ChatGPT was released in 2022.\nIt was made by Google.";
    state.route = { kind: "factcheck", text: claim };
    render_();
    await describe(`Is this true?\n${claim}`);
    expect((await planLine()).textContent).toBe("NazAI will: Fact-check / challenge");
    expect(screen.getByTestId("task-text").textContent).toBe("Works on: ChatGPT was released in 2022. It was made by Google.");
    fireEvent.click(screen.getByLabelText("Ask Beta"));
    expect(screen.queryByTestId("tool-plan-named")).toBeNull();
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "factcheck", topic: claim, tool_ids: ["b"] }));
  });

  it("rewrite: the styles NazAI read are chosen; more presets and an own style can be added", async () => {
    state.tools = [good("a", "Alpha"), writer];
    state.route = { kind: "rewrite", text: "Your order has shipped.", labels: ["More formal"] };
    render_();
    await describe("Rewrite this more formally: Your order has shipped.");
    expect((await planLine()).textContent).toBe("NazAI will: Rewrite in different styles");
    expect(screen.getByRole("button", { name: "More formal" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Simpler" }));
    fireEvent.change(screen.getByLabelText("Another style"), { target: { value: "for a 10-year-old" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.textContent).toBe("Rewrite");
    fireEvent.click(start);
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "rewrite", topic: "Your order has shipped.", styles: ["More formal", "Simpler", "for a 10-year-old"], tool_ids: ["a"] }));
  });

  it("rewrite with no style read: Start waits for one", async () => {
    state.tools = [good("a", "Alpha"), writer];
    state.route = { kind: "rewrite", text: "Your order has shipped." };
    render_();
    await describe("Rewrite: Your order has shipped.");
    await planLine();
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    expect(screen.getByTestId("task-problem").textContent).toBe("Choose at least one style.");
    expect((screen.getByTestId("task-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("an unclear request: NazAI asks instead of guessing, and nothing starts until an action is chosen", async () => {
    state.tools = [good("a", "Alpha"), writer];
    state.route = { kind: "unclear", question: "Do you want this explained simply, or its key points?" };
    render_();
    await describe("Quantum entanglement links two particles so that measuring one tells you about the other.");
    expect((await screen.findByTestId("task-question", {}, { timeout: 3000 })).textContent).toBe("Do you want this explained simply, or its key points?");
    expect(screen.queryByTestId("task-plan-line")).toBeNull();
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.queryByLabelText("Ask Alpha")).toBeNull();
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "explain" } });
    expect(screen.getByTestId("task-plan-line").textContent).toBe("NazAI will: Explain simply");
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    expect(start.textContent).toBe("Explain");
    fireEvent.click(start);
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "explain", topic: "Quantum entanglement links two particles so that measuring one tells you about the other.", tool_ids: ["a"] }));
  });

  it("Change replaces NazAI's choice; a choice that takes fewer tools keeps the first ones", async () => {
    state.tools = [good("a", "Alpha"), good("b", "Beta"), writer];
    state.route = { kind: "research" };
    render_();
    await describe("Current approaches to AI safety evaluation");
    expect((await planLine()).textContent).toBe("NazAI will: Research & synthesize");
    fireEvent.click(screen.getByLabelText("Ask Beta"));
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "keypoints" } });
    expect(screen.getByTestId("task-plan-line").textContent).toBe("NazAI will: Extract key points · Beta");
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "keypoints", topic: "Current approaches to AI safety evaluation", tool_ids: ["b"] }));
  });

  it("background in the box is shown and sent with the task, for every tool", async () => {
    state.tools = [good("a", "Alpha"), good("b", "Beta"), writer];
    state.route = { kind: "decision", text: "Should we hire a second engineer or buy more ads?", background: "We are a 3-person startup with 8 months of runway." };
    render_();
    await describe("We are a 3-person startup with 8 months of runway. Should we hire a second engineer or buy more ads?");
    expect((await planLine()).textContent).toBe("NazAI will: Decision support");
    expect(screen.getByTestId("task-background").textContent).toBe("Background sent to every tool: We are a 3-person startup with 8 months of runway.");
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    fireEvent.click(screen.getByLabelText("Ask Beta"));
    expect(screen.getByTestId("task-start").textContent).toBe("Get decision support");
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()).toEqual({
      action: "start_report", task: "decision", topic: "Should we hire a second engineer or buy more ads?", background: "We are a 3-person startup with 8 months of runway.", tool_ids: ["a", "b"],
    }));
  });

  it("alternatives: the number of options NazAI read can be changed and is sent", async () => {
    state.tools = [good("a", "Alpha"), writer];
    state.route = { kind: "alternatives", text: "Names for a budgeting app", count: 4 };
    render_();
    await describe("Give me 4 names for a budgeting app");
    expect((await planLine()).textContent).toBe("NazAI will: Generate alternatives");
    const n = screen.getByLabelText("Options to ask for") as HTMLSelectElement;
    expect(n.value).toBe("4");
    fireEvent.change(n, { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(lastStart()).toEqual({ action: "start_report", task: "alternatives", topic: "Names for a budgeting app", count: 5, tool_ids: ["a"] }));
  });

  it("roles and audiences use their own lists", async () => {
    state.tools = [good("a", "Alpha"), writer];
    state.route = { kind: "roles", labels: ["Lawyer", "Investor"] };
    render_();
    await describe("Is it safe to launch without terms of service?");
    expect((await planLine()).textContent).toBe("NazAI will: Role-based answers");
    expect(screen.getByLabelText("Another role")).toBeTruthy();
    const pressed = () => screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent);
    expect(pressed()).toEqual(["Lawyer", "Investor"]);
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "adapt" } });
    expect(screen.getByLabelText("Another audience")).toBeTruthy();
    expect(screen.getByRole("button", { name: "LinkedIn" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
    fireEvent.change(screen.getByLabelText("Change the action"), { target: { value: "roles" } });
    expect(pressed()).toEqual(["Lawyer", "Investor"]);
  });

  it("when NazAI can not read the request it asks which action to use", async () => {
    state.tools = [good("a", "Alpha"), writer];
    state.routeFails = true;
    render_();
    await describe("Something about our launch");
    expect((await screen.findByTestId("task-question", {}, { timeout: 3000 })).textContent).toBe("NazAI could not read the request right now. Which of these should it do?");
    expect((screen.getByTestId("task-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a very short request is not read", async () => {
    state.tools = [good("a", "Alpha"), writer];
    render_();
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.change(screen.getByLabelText("Describe the task"), { target: { value: "hi" } });
    await new Promise((r) => setTimeout(r, 1300));
    expect(calls().filter((c) => c.action === "route_task")).toEqual([]);
    expect(screen.queryByTestId("task-plan")).toBeNull();
  });
});
