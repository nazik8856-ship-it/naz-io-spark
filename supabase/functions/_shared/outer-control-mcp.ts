// Outer Control: talking to an MCP server (Model Context Protocol, Streamable HTTP transport, JSON-RPC 2.0).
//
// A step against an MCP connector is a real MCP exchange, not a plain HTTPS post: initialize, the "initialized" notice, tools/list
// when the tool has to be found, then tools/call with the step's text. The text the tool returns is the reply and goes through
// the same rules as any other reply. The connection test does the handshake and lists the tools, so "Working" means the server
// really speaks MCP and offers something to call.
//
// Not supported, and said so in the connector form: the older two-endpoint HTTP+SSE transport (GET /sse), server-initiated
// requests, and tools that need arguments other than one piece of text.
export const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_BODY_CHARS = 1_000_000;
const MAX_TOOL_PAGES = 3;

export type McpDeps = {
  fetchImpl: typeof fetch;
  validateUrl: (u: string) => Promise<{ ok: boolean; reason?: string }>;
  timeoutMs: number;
};

export type McpTool = { name: string; description?: string; inputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] } };

export type McpEndpoint = { url: string; authHeader: string; authScheme: string; token: string };

export type McpFailure = { ok: false; error: string; httpStatus: number | null; timedOut?: boolean };

// ---------------------------------------------------------------------------------------
// Reading what the server sends back (a JSON body, or an event stream carrying the JSON-RPC response)

/** The JSON-RPC response with this id from a JSON body or a text/event-stream body; null if there is none. */
export function parseRpcBody(contentType: string, text: string, id: number): { result?: unknown; error?: { code?: number; message?: string } } | null {
  const take = (v: unknown) => {
    const o = v as { id?: unknown; result?: unknown; error?: { code?: number; message?: string } } | null;
    return o && typeof o === "object" && o.id === id ? { result: o.result, error: o.error } : null;
  };
  if (/text\/event-stream/i.test(contentType)) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      try { const hit = take(JSON.parse(data)); if (hit) return hit; } catch { /* a non-JSON event */ }
    }
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    // A batch answer is allowed by the protocol.
    return Array.isArray(parsed) ? parsed.map(take).find((x) => x) ?? null : take(parsed);
  } catch { return null; }
}

function failureOf(e: unknown): McpFailure {
  if (e instanceof Error && e.name === "TimeoutError") return { ok: false, error: "The MCP server did not answer in time.", httpStatus: null, timedOut: true };
  return { ok: false, error: "The MCP server could not be reached.", httpStatus: null };
}

function httpFailure(status: number): McpFailure {
  const why = status === 401 || status === 403 ? "The MCP server rejected the key. Update the key and test again."
    : status === 404 ? "Nothing answers at that address (HTTP 404). Check the address."
    : status === 405 ? "That address is not an MCP endpoint (it does not accept MCP requests)."
    : status === 406 ? "The server did not accept the MCP request headers."
    : status === 429 ? "The MCP server is limiting requests (HTTP 429). Try again shortly."
    : status >= 300 && status < 400 ? `The MCP server redirected the request (HTTP ${status}). Outer Control does not follow redirects: use the final address.`
    : status >= 500 ? `The MCP server is failing on its side (HTTP ${status}).`
    : `The MCP server answered HTTP ${status}.`;
  return { ok: false, error: why, httpStatus: status };
}

type Session = { id: string | null; version: string };

async function post(
  ep: McpEndpoint, deps: McpDeps, session: Session | null, body: unknown, expectId: number | null,
): Promise<{ ok: true; result: unknown; sessionId: string | null } | McpFailure> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (ep.token) headers[ep.authHeader] = `${ep.authScheme}${ep.token}`;
  if (session) { headers["MCP-Protocol-Version"] = session.version; if (session.id) headers["Mcp-Session-Id"] = session.id; }
  let res: Response;
  try {
    res = await deps.fetchImpl(ep.url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(deps.timeoutMs) });
  } catch (e) { return failureOf(e); }
  if (res.status >= 300 && res.status < 400) return httpFailure(res.status);
  if (expectId === null) { await res.text().catch(() => ""); return res.ok ? { ok: true, result: null, sessionId: null } : httpFailure(res.status); }
  if (!res.ok) { await res.text().catch(() => ""); return httpFailure(res.status); }
  let text: string;
  try { text = (await res.text()).slice(0, MAX_BODY_CHARS); } catch (e) { return failureOf(e); }
  const rpc = parseRpcBody(res.headers.get("content-type") ?? "", text, expectId);
  if (!rpc) return { ok: false, error: "The server answered, but not with an MCP response. Check that the address is an MCP server.", httpStatus: res.status };
  if (rpc.error) return { ok: false, error: `The MCP server returned an error: ${String(rpc.error.message ?? rpc.error.code ?? "unknown").slice(0, 200)}`, httpStatus: res.status };
  return { ok: true, result: rpc.result, sessionId: res.headers.get("mcp-session-id") };
}

// ---------------------------------------------------------------------------------------
// The exchange

export type McpHandshake = { ok: true; session: Session; serverName: string | null } | McpFailure;

/** initialize, then the "initialized" notice. */
export async function mcpHandshake(ep: McpEndpoint, deps: McpDeps): Promise<McpHandshake> {
  const check = await deps.validateUrl(ep.url);
  if (!check.ok) return { ok: false, error: `The address is not allowed: ${check.reason ?? "not permitted"}.`, httpStatus: null };
  const init = await post(ep, deps, null, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "NazAI Outer Control", version: "1.0.0" } },
  }, 1);
  if (!init.ok) return init;
  const r = (init.result ?? {}) as { protocolVersion?: unknown; serverInfo?: { name?: unknown } };
  const session: Session = { id: init.sessionId, version: typeof r.protocolVersion === "string" ? r.protocolVersion : MCP_PROTOCOL_VERSION };
  const note = await post(ep, deps, session, { jsonrpc: "2.0", method: "notifications/initialized" }, null);
  if (!note.ok) return note;
  return { ok: true, session, serverName: typeof r.serverInfo?.name === "string" ? r.serverInfo.name.slice(0, 80) : null };
}

export async function mcpListTools(ep: McpEndpoint, deps: McpDeps, session: Session): Promise<{ ok: true; tools: McpTool[] } | McpFailure> {
  const tools: McpTool[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const r = await post(ep, deps, session, { jsonrpc: "2.0", id: 10 + page, method: "tools/list", params: cursor ? { cursor } : {} }, 10 + page);
    if (!r.ok) return r;
    const o = (r.result ?? {}) as { tools?: unknown; nextCursor?: unknown };
    if (Array.isArray(o.tools)) for (const t of o.tools) if (t && typeof (t as McpTool).name === "string") tools.push(t as McpTool);
    cursor = typeof o.nextCursor === "string" && o.nextCursor ? o.nextCursor : null;
    if (!cursor) break;
  }
  return { ok: true, tools };
}

/** The tool to call: the one named, or the only one the server offers. */
export function pickTool(tools: McpTool[], wanted: string | null | undefined): { ok: true; tool: McpTool } | { ok: false; error: string } {
  const name = (wanted ?? "").trim();
  if (name) {
    const hit = tools.find((t) => t.name === name);
    return hit ? { ok: true, tool: hit } : { ok: false, error: `The server has no tool named "${name}". It offers: ${tools.map((t) => t.name).slice(0, 8).join(", ") || "nothing"}.` };
  }
  if (tools.length === 1) return { ok: true, tool: tools[0] };
  if (tools.length === 0) return { ok: false, error: "The MCP server offers no tools." };
  return { ok: false, error: `The server offers ${tools.length} tools (${tools.map((t) => t.name).slice(0, 8).join(", ")}). Put the name of the one to use in the Tool name field.` };
}

const TEXT_ARGS = ["query", "prompt", "input", "text", "question", "message", "content", "instruction", "q"];

/** The arguments for a tool that takes text: the text goes into its one required string property (or the best-named string property). */
export function buildArguments(tool: McpTool, text: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const props = tool.inputSchema?.properties ?? {};
  const strings = Object.keys(props).filter((k) => props[k]?.type === "string");
  const required = tool.inputSchema?.required ?? [];
  const otherRequired = required.filter((k) => !strings.includes(k));
  if (otherRequired.length) return { ok: false, error: `The tool "${tool.name}" needs arguments Outer Control cannot fill (${otherRequired.join(", ")}). Only tools that take text are supported.` };
  const requiredStrings = required.filter((k) => strings.includes(k));
  if (requiredStrings.length > 1) return { ok: false, error: `The tool "${tool.name}" needs several text arguments (${requiredStrings.join(", ")}). Only tools that take one piece of text are supported.` };
  const key = requiredStrings[0] ?? TEXT_ARGS.find((k) => strings.includes(k)) ?? (strings.length === 1 ? strings[0] : null);
  if (!key) return { ok: false, error: `The tool "${tool.name}" has no text argument to send the request in.` };
  return { ok: true, args: { [key]: text } };
}

/** The text a tools/call result carries. A result the tool marks as an error is a failure. */
export function readToolResult(result: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const r = (result ?? {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };
  const parts = Array.isArray(r.content)
    ? r.content.map((c) => (c && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).filter((t) => t.trim())
    : [];
  const text = parts.join("\n\n").trim();
  if (r.isError === true) return { ok: false, error: `The tool reported an error: ${(text || "no details").slice(0, 300)}` };
  if (text) return { ok: true, text };
  if (r.structuredContent !== undefined) {
    try { const s = JSON.stringify(r.structuredContent); if (s && s !== "{}" && s !== "null") return { ok: true, text: s }; } catch { /* fall through */ }
  }
  return { ok: false, error: "The tool answered, but its result had no text." };
}

export type McpCallResult = { ok: true; text: string; toolName: string } | McpFailure;

/** One step: handshake, find the tool, call it with the text. */
export async function mcpCall(ep: McpEndpoint, deps: McpDeps, wantedTool: string | null | undefined, text: string): Promise<McpCallResult> {
  const hs = await mcpHandshake(ep, deps);
  if (!hs.ok) return hs;
  const listed = await mcpListTools(ep, deps, hs.session);
  if (!listed.ok) return listed;
  const picked = pickTool(listed.tools, wantedTool);
  if (!picked.ok) return { ok: false, error: picked.error, httpStatus: null };
  const args = buildArguments(picked.tool, text);
  if (!args.ok) return { ok: false, error: args.error, httpStatus: null };
  const called = await post(ep, deps, hs.session, { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: picked.tool.name, arguments: args.args } }, 20);
  if (!called.ok) return called;
  const read = readToolResult(called.result);
  return read.ok ? { ok: true, text: read.text, toolName: picked.tool.name } : { ok: false, error: read.error, httpStatus: null };
}

export type McpTestResult = { ok: boolean; error: string | null; ms: number | null; sample: string | null };

/** The connection test: the handshake works, the server offers tools, and the tool to use exists and takes text. */
export async function mcpTest(ep: McpEndpoint, deps: McpDeps, wantedTool: string | null | undefined, now: () => number): Promise<McpTestResult> {
  const started = now();
  const done = (o: { ok: boolean; error: string | null; sample: string | null }) => ({ ...o, ms: Math.max(0, now() - started) });
  const hs = await mcpHandshake(ep, deps);
  if (!hs.ok) return done({ ok: false, error: hs.error, sample: null });
  const listed = await mcpListTools(ep, deps, hs.session);
  if (!listed.ok) return done({ ok: false, error: listed.error, sample: null });
  const picked = pickTool(listed.tools, wantedTool);
  if (!picked.ok) return done({ ok: false, error: picked.error, sample: null });
  const args = buildArguments(picked.tool, "test");
  if (!args.ok) return done({ ok: false, error: args.error, sample: null });
  return done({ ok: true, error: null, sample: `${hs.serverName ?? "MCP server"}: ${listed.tools.length} tool${listed.tools.length === 1 ? "" : "s"}, using ${picked.tool.name}`.slice(0, 80) });
}
