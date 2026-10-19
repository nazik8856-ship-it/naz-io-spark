import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { buildActivity, checkConnector, describeClosure, FEATURED_TOOLS, featuredPayload, healthSummary, keyPageUrl, searchConnectors, toolHealth } from "@/lib/outer-control-tools-ui";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("tool health", () => {
  const base = { approved_at: ago(500), last_ok_at: null, last_checked_at: null, last_error: null };
  it("Failed carries the reason from the test", () => {
    expect(toolHealth({ ...base, last_checked_at: ago(2), last_error: "The tool rejected the key (HTTP 401)." }, NOW)).toEqual({ key: "failed", label: "Failed", reason: "The tool rejected the key (HTTP 401)." });
  });
  it("a tool that was never tested Needs attention", () => {
    expect(toolHealth(base, NOW)).toMatchObject({ key: "attention", label: "Needs attention", reason: expect.stringMatching(/Not tested yet/) });
  });
  it("Working needs a good test that is recent; an old one needs attention again", () => {
    expect(toolHealth({ ...base, last_checked_at: ago(3), last_ok_at: ago(3) }, NOW)).toEqual({ key: "working", label: "Working", reason: "Test passed 3 min ago." });
    expect(toolHealth({ ...base, last_checked_at: ago(25 * 60), last_ok_at: ago(25 * 60) }, NOW).key).toBe("attention");
  });
  it("a working tool without the first approval Needs attention and says so", () => {
    expect(toolHealth({ ...base, approved_at: null, last_checked_at: ago(1), last_ok_at: ago(1) }, NOW).reason).toMatch(/approve contacting this tool/);
  });
  it("a failed test wins over an older good one", () => {
    expect(toolHealth({ ...base, last_checked_at: ago(1), last_ok_at: ago(60), last_error: "The tool did not answer in time." }, NOW).key).toBe("failed");
  });
  it("summarises the list", () => {
    expect(healthSummary([], NOW)).toBe("No tools connected");
    expect(healthSummary([{ ...base, last_checked_at: ago(1), last_ok_at: ago(1) }, base], NOW)).toBe("2 tools · 1 working · 1 needs attention");
  });
});

describe("featured tools and the custom connector", () => {
  it("each featured tool has an https address, a format and the right auth header for its provider", () => {
    expect(FEATURED_TOOLS.slice(0, 4).map((f) => f.id)).toEqual(["openai", "anthropic", "gemini", "grok"]);
    expect(new Set(FEATURED_TOOLS.map((f) => f.id)).size).toBe(FEATURED_TOOLS.length);
    for (const f of FEATURED_TOOLS) expect(new URL(f.endpoint_url).protocol).toBe("https:");
    const a = FEATURED_TOOLS.find((f) => f.id === "anthropic")!;
    expect(featuredPayload(a, " sk-ant-key ")).toMatchObject({ request_format: "anthropic_messages", auth_header: "x-api-key", auth_scheme: "", token: "sk-ant-key", model: "claude-sonnet-5-5" });
    expect(featuredPayload(FEATURED_TOOLS[0], "k", "gpt-x").model).toBe("gpt-x");
  });
  it("checks the custom connector form and explains what it can not do", () => {
    const ok = { name: "Mine", url: "https://tool.example.com/api", format: "generic_json", token: "", model: "" };
    expect(checkConnector(ok)).toEqual({ errors: [], notes: [] });
    expect(checkConnector({ ...ok, name: " " }).errors).toEqual(["Give the tool a name."]);
    expect(checkConnector({ ...ok, url: "" }).errors).toEqual(["Enter the tool's address."]);
    expect(checkConnector({ ...ok, url: "tool.example.com" }).errors[0]).toMatch(/not a web address/);
    expect(checkConnector({ ...ok, url: "http://tool.example.com" }).errors[0]).toMatch(/https/);
    expect(checkConnector({ ...ok, url: "https://u:p@tool.example.com" }).errors[0]).toMatch(/user name and password/);
    expect(checkConnector({ ...ok, url: "https://tool.example.com/mcp" }).notes[0]).toMatch(/Choose "MCP server" as the format/);
    const mcp = checkConnector({ ...ok, url: "https://tool.example.com/mcp", format: "mcp" });
    expect(mcp.errors).toEqual([]);
    expect(mcp.notes[0]).toMatch(/speak the MCP protocol/);
    expect(checkConnector({ ...ok, url: "https://tool.example.com/sse", format: "mcp" }).notes[1]).toMatch(/older MCP transport/);
    expect(checkConnector({ ...ok, format: "anthropic_messages" }).notes[0]).toMatch(/need a model/);
  });
});

describe("searching connectors", () => {
  const names = (q: string) => searchConnectors(FEATURED_TOOLS, q).map((f) => f.id);
  it("finds by name, company, product and what it is known for, ignoring case", () => {
    expect(names("chatgpt")).toEqual(["openai"]);
    expect(names("CLAUDE")).toEqual(["anthropic"]);
    expect(names("google")).toEqual(["gemini"]);
    expect(names("xai")).toEqual(["grok"]);
    expect(names("llama")).toEqual(expect.arrayContaining(["groq", "fireworks"]));
    expect(names("search")).toContain("perplexity");
  });
  it("every word must match; an empty search returns everything; no match returns nothing", () => {
    expect(names("open llama")).toEqual(expect.arrayContaining(["groq", "fireworks"]));
    expect(names("claude gemini")).toEqual([]);
    expect(names("   ")).toHaveLength(FEATURED_TOOLS.length);
    expect(names("zzzz")).toEqual([]);
  });
  it("uses each company's real name: Groq (the chip maker) and Grok (xAI) are two different tools", () => {
    const n = Object.fromEntries(FEATURED_TOOLS.map((f) => [f.id, f.name]));
    expect(n).toMatchObject({ openai: "ChatGPT (OpenAI)", anthropic: "Claude (Anthropic)", gemini: "Gemini (Google)", grok: "Grok (xAI)", groq: "Groq", mistral: "Mistral AI", perplexity: "Perplexity", deepseek: "DeepSeek", openrouter: "OpenRouter" });
    expect(FEATURED_TOOLS.find((f) => f.id === "groq")!.blurb).toMatch(/Groq, not Grok/);
  });
  it("every connector has an https address and its own auth header", () => {
    for (const f of FEATURED_TOOLS) { expect(existsSync(`public${f.icon}`)).toBe(true); expect(f.endpoint_url.startsWith("https://")).toBe(true); expect(f.keyLabel.length).toBeGreaterThan(3); expect(f.keyStep.length).toBeGreaterThan(10); expect(new URL(keyPageUrl(f)).hostname).toContain("."); expect(f.model.length).toBeGreaterThan(1); }
  });
});

describe("session activity", () => {
  const base = { toolName: "Bot2", completion: null, pendingKind: null, stepCount: 0, maxSteps: 5 } as const;
  it("a session that just started says which tool it is waiting for", () => {
    expect(buildActivity({ ...base, status: "running", steps: [] }).map((l) => l.text)).toEqual(["Waiting for Bot2's reply (step 1 of at most 5)…"]);
  });
  it("lists what was asked, what the rules did, what was removed, and what happens next, in order", () => {
    const lines = buildActivity({
      ...base, status: "running", stepCount: 1,
      steps: [
        { step_no: 1, attempt: 1, verdict: "modify", next_action: "continue", error: null, note: null, decision: { applied: ["Secrets"], changes: [{ name: "Secrets", count: 2 }], risk: { level: "medium" }, confidence: { level: "high" } } },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual([
      "Step 1: asked Bot2.",
      "Your rules changed the reply (Secrets); the cleaned version is used.",
      'Removed 2× "Secrets" from the reply.',
      "Risk medium · confidence high.",
      "Then: accepted, asked for another round.",
      "Waiting for Bot2's reply (step 2 of at most 5)…",
    ]);
    expect(lines.find((l) => l.key === "1.1.chg.Secrets")!.tone).toBe("warn");
  });
  it("shows a failed exchange with its reason and a rejected reply as blocked", () => {
    const lines = buildActivity({ ...base, status: "failed", steps: [
      { step_no: 1, attempt: 1, verdict: null, next_action: "retry_same", error: "The tool answered HTTP 503.", note: null },
      { step_no: 1, attempt: 2, verdict: "block", next_action: "reject", error: null, note: null, decision: { applied: ["No codename"] } },
    ] });
    expect(lines.map((l) => l.text)).toContain("Bot2 gave no usable reply: The tool answered HTTP 503.");
    expect(lines.map((l) => l.text)).toContain("Your rules blocked the reply (No codename).");
    expect(lines.find((l) => l.text.startsWith("Then: rejected"))!.tone).toBe("bad");
  });
  it("ends with the completion check, and invents nothing for a phase with no record", () => {
    const criteria = [{ id: "a", label: "a", ok: true, detail: "d" }, { id: "b", label: "b", ok: true, detail: "d" }];
    const done = buildActivity({ ...base, status: "completed", completion: { passed: true, outcome: "completed", summary: "ok", criteria }, steps: [
      { step_no: 1, attempt: 1, verdict: "allow", next_action: "finish", error: null, note: null },
    ] });
    expect(done.at(-1)).toMatchObject({ key: "completion", tone: "ok", text: "Completion check passed (2/2)." });
    expect(done.some((l) => l.tone === "live")).toBe(false);
    expect(buildActivity({ ...base, status: "awaiting_human", pendingKind: "handoff", steps: [] }).at(-1)!.text).toBe("Waiting for your decision on how to continue.");
    expect(buildActivity({ ...base, status: "queued", steps: [] })[0].text).toMatch(/Not started/);
  });
});

describe("the end of a session", () => {
  const base = { finished_at: "2026-10-19T09:05:00Z", step_count: 1, stop_reason: null, toolName: "Bot2" };
  it("a completed session says when it closed, how many exchanges, and that the result is stored", () => {
    expect(describeClosure({ ...base, status: "completed" })).toEqual({ tone: "ok", text: "Session closed 19 Oct, 09:05 UTC. 1 exchange with Bot2. The final controlled result is stored above, and nothing more is sent to the tool in this session." });
  });
  it("a session that ended another way says how and why", () => {
    expect(describeClosure({ ...base, status: "failed", stop_reason: "The tool could not be reached" })?.text).toBe("Session closed 19 Oct, 09:05 UTC (failed). The tool could not be reached. Nothing more is sent to the tool in this session.");
    expect(describeClosure({ ...base, status: "cancelled" })?.text).toMatch(/\(cancelled\)\. Nothing more is sent/);
  });
  it("an open session has no closing record yet", () => {
    for (const status of ["queued", "running", "awaiting_human"]) expect(describeClosure({ ...base, status })).toBeNull();
    expect(describeClosure({ ...base, status: "completed", finished_at: null })).toBeNull();
  });
});
