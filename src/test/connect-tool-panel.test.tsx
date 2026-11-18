import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
const rowsFor: Record<string, unknown[]> = { agent_integrations: [{ provider: "Gmail", metadata: { services: ["drive"] } }, { provider: "Slack", metadata: null }], integration_snapshots: [] };
vi.mock("@/integrations/supabase/client", () => {
  const q = (t: string) => { const o: Record<string, unknown> = {}; const chain = () => o; Object.assign(o, { select: chain, eq: chain, order: chain, limit: chain, then: (r: (v: unknown) => void) => r({ data: rowsFor[t] ?? [], error: null }) }); return o; };
  return { supabase: { from: (t: string) => q(t), functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) } } };
});
vi.mock("@/components/agents/IntegrationConnectModal", () => ({ default: ({ integration, onClose }: { integration: { name: string }; onClose: () => void }) => <div data-testid="oauth-modal">{integration.name}<button onClick={onClose}>close-modal</button></div> }));
// The model list for a key (outer-control-drive list_models): set per test.
const drive = vi.hoisted(() => ({ calls: [] as { action: string; payload: Record<string, unknown> }[], reply: { ok: false, data: null, message: "no list in this test" } as { ok: boolean; data: unknown; message: string } }));
vi.mock("@/lib/outer-control-drive", () => ({ callDrive: async (action: string, payload: Record<string, unknown>) => { drive.calls.push({ action, payload }); return drive.reply; } }));
import ConnectToolPanel from "@/components/control/outer/ConnectToolPanel";

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const tools = [{ id: "t1", name: "Bot2", endpoint_url: "https://x.supabase.co/stub", approved_at: ago(100), last_ok_at: ago(2), last_checked_at: ago(2), last_error: null }];
const setup = (onConnect = vi.fn(async () => true)) => {
  const onOpenChange = vi.fn();
  render(<ConnectToolPanel open onOpenChange={onOpenChange} tools={tools} busy={false} onConnect={onConnect} />);
  return { onConnect, onOpenChange };
};

describe("ConnectToolPanel", () => {
  it("has the three parts: Connected (with status), Featured and Custom", () => {
    setup();
    const panel = screen.getByTestId("connect-panel");
    expect(within(panel).getByText("Connected")).toBeTruthy();
    expect(within(screen.getByTestId("panel-connected")).getByText("Bot2")).toBeTruthy();
    expect(screen.getByTestId("panel-connected").textContent).toMatch(/Working/);
    expect(screen.getAllByTestId("featured-tool").map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/ChatGPT/), expect.stringMatching(/Claude/), expect.stringMatching(/Gemini/), expect.stringMatching(/Grok/)]));
    expect(screen.getByTestId("custom-connector").textContent).toMatch(/Add custom connector/);
  });

  it("a featured tool only asks for the key and connects with its address, format and header filled in", async () => {
    const { onConnect, onOpenChange } = setup();
    fireEvent.click(screen.getAllByTestId("featured-tool")[1]);
    const connect = screen.getByText("Connect and test") as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-123" } });
    fireEvent.click(connect);
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    expect(onConnect).toHaveBeenCalledWith({ name: "Claude (Anthropic)", endpoint_url: "https://api.anthropic.com/v1", request_format: "anthropic_messages", model: "claude-sonnet-5-5", auth_header: "x-api-key", auth_scheme: "", token: "sk-ant-123" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Groq: the base address is shown with where requests go; a safe model is chosen; the key's own list replaces the suggestions", async () => {
    drive.calls = [];
    drive.reply = { ok: true, data: { ok: true, models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "moonshotai/kimi-k3"] }, message: "" };
    const { onConnect } = setup();
    fireEvent.click(screen.getAllByTestId("featured-tool").find((b) => /Groq/.test(b.textContent ?? ""))!);
    expect(screen.getByTestId("featured-address").textContent).toBe("https://api.groq.com/openai/v1");
    expect(screen.getByTestId("featured-calls").textContent).toBe("Requests go to https://api.groq.com/openai/v1/chat/completions");
    const select = screen.getByTestId("model-select") as HTMLSelectElement;
    expect(select.value).toBe("openai/gpt-oss-20b"); // the free-tier friendly default
    expect([...select.options].map((o) => o.value)).toEqual(["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "__other__"]);
    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_live_key_123" } });
    await waitFor(() => expect(screen.getByTestId("model-status").textContent).toMatch(/3 models available for this key/));
    expect(drive.calls.at(-1)).toEqual({ action: "list_models", payload: { endpoint_url: "https://api.groq.com/openai/v1", request_format: "openai_chat", auth_header: "Authorization", auth_scheme: "Bearer ", token: "gsk_live_key_123" } });
    // gpt-oss-20b is not open to this key: the first suggestion it can use is selected; suggestions first, then the rest.
    await waitFor(() => expect((screen.getByTestId("model-select") as HTMLSelectElement).value).toBe("openai/gpt-oss-120b"));
    expect([...(screen.getByTestId("model-select") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "moonshotai/kimi-k3", "__other__"]);
    fireEvent.click(screen.getByText("Connect and test"));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ endpoint_url: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", token: "gsk_live_key_123" })));
  });

  it("when the list can not be read the reason is shown and the suggestions stay; Other takes any model name", async () => {
    drive.reply = { ok: false, data: null, message: "The tool rejected the key (HTTP 401). Called: GET https://api.groq.com/openai/v1/models → HTTP 401." };
    setup();
    fireEvent.click(screen.getAllByTestId("featured-tool").find((b) => /Groq/.test(b.textContent ?? ""))!);
    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_wrong_key" } });
    await waitFor(() => expect(screen.getByTestId("model-status").textContent).toMatch(/Could not read the model list: The tool rejected the key \(HTTP 401\)\. Called: GET https:\/\/api\.groq\.com\/openai\/v1\/models/));
    expect((screen.getByTestId("model-select") as HTMLSelectElement).value).toBe("openai/gpt-oss-20b");
    fireEvent.change(screen.getByTestId("model-select"), { target: { value: "__other__" } });
    fireEvent.change(screen.getByTestId("model-other"), { target: { value: "my-fine-tune" } });
    expect((screen.getByTestId("model-other") as HTMLInputElement).value).toBe("my-fine-tune");
  });

  it("a custom OpenAI-style connector says where requests go", () => {
    setup();
    fireEvent.click(screen.getByTestId("custom-connector"));
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "My Groq" } });
    fireEvent.change(screen.getByLabelText("Request format"), { target: { value: "openai_chat" } });
    fireEvent.change(screen.getByLabelText("Tool address"), { target: { value: "https://api.groq.com/openai/v1/chat/completions" } });
    expect(screen.getByTestId("custom-calls").textContent).toMatch(/Requests go to https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions\./);
  });

  it("the custom connector needs a name and an https address, warns about MCP addresses, and sends name + address", async () => {
    const { onConnect } = setup();
    fireEvent.click(screen.getByTestId("custom-connector"));
    const connect = screen.getByText("Connect and test") as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "Docs server" } });
    fireEvent.change(screen.getByLabelText("Tool address"), { target: { value: "http://docs.example.com/mcp" } });
    expect(screen.getByText(/must start with https/)).toBeTruthy();
    expect(connect.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Tool address"), { target: { value: "https://docs.example.com/mcp" } });
    expect(screen.getByTestId("connector-note").textContent).toMatch(/Choose "MCP server" as the format/);
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ name: "Docs server", endpoint_url: "https://docs.example.com/mcp", request_format: "generic_json", model: undefined, token: undefined }));
  });

  it("an MCP connector: choose the MCP format, name the tool, and it is saved as an MCP connector", async () => {
    const { onConnect } = setup();
    fireEvent.click(screen.getByTestId("custom-connector"));
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "Docs server" } });
    fireEvent.change(screen.getByLabelText("Tool address"), { target: { value: "https://docs.example.com/mcp" } });
    fireEvent.change(screen.getByLabelText("Request format"), { target: { value: "mcp" } });
    expect(screen.getAllByTestId("connector-note")[0].textContent).toMatch(/speak the MCP protocol/);
    fireEvent.change(screen.getByLabelText("MCP tool name"), { target: { value: "search_docs" } });
    fireEvent.click(screen.getByText("Connect and test"));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ name: "Docs server", endpoint_url: "https://docs.example.com/mcp", request_format: "mcp", model: "search_docs", token: undefined }));
  });

  it("stays open when the server did not save the tool", async () => {
    const { onOpenChange } = setup(vi.fn(async () => false));
    fireEvent.click(screen.getByTestId("custom-connector"));
    fireEvent.change(screen.getByLabelText("Tool name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Tool address"), { target: { value: "https://x.example.com" } });
    fireEvent.click(screen.getByText("Connect and test"));
    await new Promise((r) => setTimeout(r, 30));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId("custom-form")).toBeTruthy();
  });

  it("search finds a connector by name or company and shows nothing for a miss, offering a custom connector with the typed name", () => {
    setup();
    const box = screen.getByLabelText("Search connectors");
    fireEvent.change(box, { target: { value: "google" } });
    expect(screen.getAllByTestId("featured-tool").map((b) => b.textContent)).toEqual([expect.stringMatching(/Gemini/)]);
    expect(screen.getByTestId("search-status").textContent).toBe("1 connector found");
    fireEvent.change(box, { target: { value: "zzz-unknown" } });
    expect(screen.queryAllByTestId("featured-tool").length).toBe(0);
    expect(screen.getByTestId("no-results").textContent).toMatch(/No connector matches "zzz-unknown"/);
    expect(screen.getByTestId("custom-connector").textContent).toMatch(/Add "zzz-unknown" as a custom connector/);
    fireEvent.click(screen.getByTestId("custom-connector"));
    expect((screen.getByLabelText("Tool name") as HTMLInputElement).value).toBe("zzz-unknown");
  });

  it("the search box is a labelled search field and every connector is a real button reachable by keyboard", () => {
    setup();
    expect(screen.getByRole("searchbox", { name: "Search connectors" })).toBeTruthy();
    for (const b of screen.getAllByTestId("featured-tool")) expect(b.tagName).toBe("BUTTON");
    expect(screen.getAllByTestId("featured-tool").length).toBeGreaterThanOrEqual(8);
  });

  it("every provider shows where to get a key: a link that opens its key page in a new tab and three short steps", () => {
    setup();
    const count = screen.getAllByTestId("featured-tool").length;
    for (let i = 0; i < count; i++) {
      fireEvent.click(screen.getAllByTestId("featured-tool")[i]);
      const link = screen.getByTestId("get-key-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+(\/|$)/);
      expect(link.getAttribute("target")).toBe("_blank"); expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(screen.getByTestId("get-key").querySelectorAll("li").length).toBe(3);
      fireEvent.click(screen.getByText("Back"));
    }
  });

  it("Gemini points at Google's key page and says to sign in with a Google account", () => {
    setup();
    fireEvent.click(screen.getAllByTestId("featured-tool")[2]);
    expect((screen.getByTestId("get-key-link") as HTMLAnchorElement).href).toBe("https://aistudio.google.com/apikey");
    expect(screen.getByTestId("get-key").textContent).toMatch(/Sign in with your Google account and choose Create API key/);
  });

  it("has two clear groups: AI models and Productivity & Data, then the custom connector last", async () => {
    setup();
    const panel = screen.getByTestId("connect-panel");
    const heads = within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(["Connected", "AI models", "Productivity & Data", "Custom"]);
    const group = screen.getByTestId("productivity-group");
    expect(within(group).getAllByTestId("productivity-tool").map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/Google Drive/), expect.stringMatching(/Slack/), expect.stringMatching(/Notion/), expect.stringMatching(/Figma/)]));
    expect(within(panel).queryByText("Featured")).toBeNull();
  });

  it("shows each productivity tool's real state: Connected with Disconnect, or Not connected with Connect", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByTestId("productivity-tool").find((r) => /Google Drive/.test(r.textContent ?? ""))?.textContent).toMatch(/Connected.*Disconnect/));
    const row = (n: string) => screen.getAllByTestId("productivity-tool").find((r) => r.textContent?.includes(n))!;
    expect(row("Slack").textContent).toMatch(/Disconnect/);
    expect(row("Notion").textContent).toMatch(/Not connected.*Connect/);
    expect(within(row("Google Calendar")).queryByText("Disconnect")).toBeNull();
  });

  it("Connect opens the existing sign-in window and hides the panel meanwhile", async () => {
    setup();
    const notion = screen.getAllByTestId("productivity-tool").find((r) => r.textContent?.includes("Notion"))!;
    fireEvent.click(within(notion).getByTestId("productivity-connect"));
    expect(screen.getByTestId("oauth-modal").textContent).toMatch(/Notion/);
    expect(screen.queryByTestId("connect-panel")).toBeNull();
    fireEvent.click(screen.getByText("close-modal"));
    expect(await screen.findByTestId("connect-panel")).toBeTruthy();
  });

  it("Disconnect asks first", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByTestId("productivity-tool").find((r) => r.textContent?.includes("Slack"))?.textContent).toMatch(/Disconnect/));
    const slack = screen.getAllByTestId("productivity-tool").find((r) => r.textContent?.includes("Slack"))!;
    fireEvent.click(within(slack).getByTestId("productivity-disconnect"));
    expect(await screen.findByText("Disconnect Slack?")).toBeTruthy();
  });

  it("search filters both groups", () => {
    setup();
    fireEvent.change(screen.getByTestId("connector-search"), { target: { value: "notion" } });
    expect(screen.getAllByTestId("productivity-tool")).toHaveLength(1);
    expect(screen.queryAllByTestId("featured-tool")).toHaveLength(0);
    fireEvent.change(screen.getByTestId("connector-search"), { target: { value: "zzzz" } });
    expect(screen.getByTestId("no-productivity")).toBeTruthy();
  });

  it("a connected AI tool has a Test button", () => {
    const onTest = vi.fn();
    render(<ConnectToolPanel open onOpenChange={vi.fn()} tools={tools} onConnect={vi.fn(async () => true)} onTest={onTest} />);
    fireEvent.click(screen.getByTestId("panel-test"));
    expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("in Generator (no AI-model connect) only the productivity group shows, and Use in prompt hands the row back", async () => {
    const onUse = vi.fn();
    render(<ConnectToolPanel open onOpenChange={vi.fn()} onUse={onUse} />);
    const panel = screen.getByTestId("connect-panel");
    expect(within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Productivity & Data"]);
    expect(screen.queryByTestId("custom-connector")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("use-in-prompt").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId("use-in-prompt")[0]);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
  });

  describe("Your NazAI agents", () => {
    const withAgents = (agents: { id: string; name: string }[], onAddAgent = vi.fn(async () => true), toolList = tools) => {
      render(<ConnectToolPanel open onOpenChange={vi.fn()} tools={toolList} busy={false} onConnect={vi.fn(async () => true)} agents={agents} onAddAgent={onAddAgent} />);
      return onAddAgent;
    };
    it("with no agent it says so and links to creating one", () => {
      withAgents([]);
      expect(screen.getByTestId("no-agents").textContent).toMatch(/no NazAI agents yet/);
      expect(screen.getByTestId("create-agent").getAttribute("href")).toBe("/generator-home");
      expect(screen.queryByTestId("panel-agent")).toBeNull();
    });
    it("lists each agent with an Add button, and Add hands the agent over", async () => {
      const onAdd = withAgents([{ id: "a1", name: "Sales bot" }, { id: "a2", name: "Support bot" }]);
      expect(screen.getAllByTestId("panel-agent").map((r) => r.textContent)).toEqual(["Sales botAdd", "Support botAdd"]);
      fireEvent.click(screen.getAllByTestId("add-agent")[0]);
      await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ id: "a1", name: "Sales bot" }));
    });
    it("an agent that is already a tool shows Added instead of Add", () => {
      withAgents([{ id: "a1", name: "Sales bot" }], vi.fn(async () => true), [...tools, { ...tools[0], id: "t9", name: "Agent: Sales bot", endpoint_url: "nazai-agent://a1" }]);
      expect(screen.getByTestId("panel-agent").textContent).toMatch(/Added/);
      expect(screen.queryByTestId("add-agent")).toBeNull();
    });
    it("without the agent handler (Generator) the section is not shown", () => {
      render(<ConnectToolPanel open onOpenChange={vi.fn()} tools={tools} busy={false} onConnect={vi.fn(async () => true)} />);
      expect(screen.queryByTestId("agents-group")).toBeNull();
    });
  });
});
