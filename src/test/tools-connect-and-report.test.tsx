import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ tools: [] as unknown[], sessions: [] as unknown[] }));

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
    state.tools = []; state.sessions = [];
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.action === "create_tool") return { ok: true, json: async () => ({ ok: true, tool: { id: "new1" } }) };
      if (body.action === "test_tool") return { ok: true, json: async () => ({ ok: true, ms: 214, sample: "ok, I am here" }) };
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

  it("opinions (the default): asks the chosen tools in the chosen order", async () => {
    state.tools = [good("a", "ChatGPT"), good("b", "Claude"), good("c", "Grok"), writer];
    render_();
    fireEvent.click(await screen.findByTestId("start-task-button"));
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Get multiple opinions/), expect.stringMatching(/^Compare answers/), expect.stringMatching(/^Fact-check \/ challenge/), expect.stringMatching(/^Rewrite in different styles/),
    ]);
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.textContent).toBe("Get opinions");
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Should we adopt a control layer?" } });
    expect(screen.getByText("Choose at least one tool to ask.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Ask Grok"));
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
    fireEvent.click(screen.getByLabelText("Ask Claude"));
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "start_report", task: "opinions", topic: "Should we adopt a control layer?", tool_ids: ["c", "a", "b"] }));
  });

  it("compare: needs 2 or 3 tools; a fourth can not be ticked", async () => {
    state.tools = [good("a", "Alpha"), good("b", "Beta"), good("c", "Gamma"), good("d", "Delta"), writer];
    render_();
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.click(screen.getByTestId("task-kind-compare"));
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Write a two-line product description for a water bottle." } });
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    expect(screen.getByTestId("task-problem").textContent).toBe("Choose at least 2 tools to compare.");
    fireEvent.click(screen.getByLabelText("Ask Beta"));
    fireEvent.click(screen.getByLabelText("Ask Gamma"));
    expect((screen.getByLabelText("Ask Delta") as HTMLInputElement).disabled).toBe(true);
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.textContent).toBe("Compare");
    fireEvent.click(start);
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "start_report", task: "compare", topic: "Write a two-line product description for a water bottle.", tool_ids: ["a", "b", "c"] }));
  });

  it("fact-check: the claim is sent as written; a tool name in the claim is content, not a choice of tool", async () => {
    state.tools = [good("a", "ChatGPT"), good("b", "Beta"), writer];
    render_();
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.click(screen.getByTestId("task-kind-factcheck"));
    const claim = "ChatGPT was released in 2022.\nIt was made by Google.";
    fireEvent.change(screen.getByLabelText("Claim or text to check"), { target: { value: claim } });
    fireEvent.click(screen.getByLabelText("Ask Beta"));
    expect(screen.queryByTestId("tool-plan-named")).toBeNull();
    fireEvent.click(screen.getByTestId("task-start"));
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "start_report", task: "factcheck", topic: claim, tool_ids: ["b"] }));
  });

  it("rewrite: needs at least one style; presets and an own style are sent with the text", async () => {
    state.tools = [good("a", "Alpha"), writer];
    render_();
    fireEvent.click(await screen.findByTestId("start-task-button"));
    fireEvent.click(screen.getByTestId("task-kind-rewrite"));
    fireEvent.change(screen.getByLabelText("Text to rewrite"), { target: { value: "Your order has shipped." } });
    fireEvent.click(screen.getByLabelText("Ask Alpha"));
    expect(screen.getByTestId("task-problem").textContent).toBe("Choose at least one style.");
    fireEvent.click(screen.getByRole("button", { name: "More formal" }));
    fireEvent.click(screen.getByRole("button", { name: "Simpler" }));
    fireEvent.change(screen.getByLabelText("Another style"), { target: { value: "for a 10-year-old" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    const start = screen.getByTestId("task-start") as HTMLButtonElement;
    expect(start.textContent).toBe("Rewrite");
    fireEvent.click(start);
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "start_report", task: "rewrite", topic: "Your order has shipped.", styles: ["More formal", "Simpler", "for a 10-year-old"], tool_ids: ["a"] }));
  });
});
