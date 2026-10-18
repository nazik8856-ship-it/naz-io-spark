import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    expect(onConnect).toHaveBeenCalledWith({ name: "Claude (Anthropic)", endpoint_url: "https://api.anthropic.com/v1/messages", request_format: "anthropic_messages", model: "claude-sonnet-5-5", auth_header: "x-api-key", auth_scheme: "", token: "sk-ant-123" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
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
    expect(screen.getByTestId("connector-note").textContent).toMatch(/not the MCP protocol/);
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ name: "Docs server", endpoint_url: "https://docs.example.com/mcp", request_format: "generic_json", model: undefined, token: undefined }));
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
});
