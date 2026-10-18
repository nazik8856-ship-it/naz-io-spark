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

  it("Generate report needs two tools; the internal report writer is not listed as a tool and not offered", async () => {
    state.tools = [good("a", "ChatGPT"), writer];
    render_();
    await screen.findByText("ChatGPT");
    expect(screen.getAllByTestId("tool-row").length).toBe(1);
    expect(screen.queryByText("NazAI report writer")).toBeNull();
    expect((screen.getByTestId("generate-report-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks the chosen tools in the chosen order and starts the report", async () => {
    state.tools = [good("a", "ChatGPT"), good("b", "Claude"), good("c", "Grok"), writer];
    render_();
    fireEvent.click(await screen.findByTestId("generate-report-button"));
    const start = screen.getByText("Generate report", { selector: "button:not([data-testid])" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Report topic"), { target: { value: "Should we adopt a control layer?" } });
    fireEvent.click(screen.getByLabelText("Ask Grok"));
    expect(screen.getByText("Choose at least 2 tools to ask.")).toBeTruthy();
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Ask ChatGPT"));
    fireEvent.click(screen.getByLabelText("Ask Claude"));
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(calls().at(-1)).toEqual({ action: "start_report", topic: "Should we adopt a control layer?", tool_ids: ["c", "a", "b"] }));
  });
});
