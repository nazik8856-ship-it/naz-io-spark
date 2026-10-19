// Run with: deno test supabase/functions/_shared/outer-control-mcp_test.ts
import { buildArguments, mcpCall, mcpTest, parseRpcBody, pickTool, readToolResult, type McpDeps, type McpEndpoint, type McpTool } from "./outer-control-mcp.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const ep: McpEndpoint = { url: "https://mcp.example.com/mcp", authHeader: "Authorization", authScheme: "Bearer ", token: "tok-1" };
const search: McpTool = { name: "search", inputSchema: { properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } };

type Seen = { method: string; headers: Record<string, string>; params: any }[];
/** A small MCP server: answers initialize / notifications / tools/list / tools/call, as JSON or as an event stream. */
function server(o: { sse?: boolean; tools?: McpTool[]; callResult?: unknown; status?: Record<string, number>; sessionId?: string; pages?: McpTool[][] } = {}) {
  const seen: Seen = [];
  const reply = (id: number, result: unknown, init: ResponseInit = {}) => {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
    return o.sse
      ? new Response(`event: message\ndata: ${payload}\n\n`, { ...init, headers: { "content-type": "text/event-stream", ...(init.headers as object) } })
      : new Response(payload, { ...init, headers: { "content-type": "application/json", ...(init.headers as object) } });
  };
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push({ method: body.method, headers: init.headers as Record<string, string>, params: body.params });
    if (o.status?.[body.method]) return new Response("nope", { status: o.status[body.method] });
    if (body.method === "initialize") return reply(body.id, { protocolVersion: "2025-03-26", serverInfo: { name: "Docs server" }, capabilities: {} }, { headers: o.sessionId ? { "mcp-session-id": o.sessionId } : {} });
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    if (body.method === "tools/list") {
      const page = o.pages ? o.pages[body.params?.cursor ? Number(body.params.cursor) : 0] : (o.tools ?? [search]);
      const next = o.pages && !(body.params?.cursor ? Number(body.params.cursor) : 0) + 1 >= o.pages.length ? String((body.params?.cursor ? Number(body.params.cursor) : 0) + 1) : undefined;
      return reply(body.id, { tools: page, ...(next ? { nextCursor: next } : {}) });
    }
    if (body.method === "tools/call") return reply(body.id, o.callResult ?? { content: [{ type: "text", text: "Returns are accepted within 30 days." }] });
    return new Response("?", { status: 400 });
  }) as unknown as typeof fetch;
  const deps: McpDeps = { fetchImpl, validateUrl: () => Promise.resolve({ ok: true }), timeoutMs: 5000 };
  return { deps, seen };
}

Deno.test("a full call: handshake, list, call; the text of the result is the reply; every request carries the key", async () => {
  const s = server();
  const r = await mcpCall(ep, s.deps, null, "What is the refund policy?");
  assertEquals(r, { ok: true, text: "Returns are accepted within 30 days.", toolName: "search" });
  assertEquals(s.seen.map((x) => x.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  assert(s.seen.every((x) => x.headers.Authorization === "Bearer tok-1" && /application\/json, text\/event-stream/.test(x.headers.Accept)), "key and Accept header on every request");
  assertEquals(s.seen[3].params, { name: "search", arguments: { query: "What is the refund policy?" } });
});

Deno.test("an event-stream server works the same, and its session id is sent back on every later request", async () => {
  const s = server({ sse: true, sessionId: "sess-9" });
  const r = await mcpCall(ep, s.deps, "search", "hello");
  assert(r.ok, JSON.stringify(r));
  assertEquals(s.seen[0].headers["Mcp-Session-Id"], undefined, "no session id on the first request");
  assert(s.seen.slice(1).every((x) => x.headers["Mcp-Session-Id"] === "sess-9" && x.headers["MCP-Protocol-Version"] === "2025-03-26"), "later requests carry the session id and protocol version");
});

Deno.test("tools are found across pages", async () => {
  const s = server({ pages: [[{ name: "a" }], [search]] });
  const r = await mcpCall(ep, s.deps, "search", "q");
  assert(r.ok && r.toolName === "search", JSON.stringify(r));
});

Deno.test("which tool: the named one, the only one, or a clear message", () => {
  assertEquals(pickTool([search], null).ok, true);
  assertEquals((pickTool([search, { name: "other" }], "other") as { ok: true; tool: McpTool }).tool.name, "other");
  assertEquals((pickTool([search, { name: "other" }], "missing") as { ok: false; error: string }).error, 'The server has no tool named "missing". It offers: search, other.');
  assert(/offers 2 tools/.test((pickTool([search, { name: "other" }], "") as { error: string }).error), "asks which one to use");
  assertEquals(pickTool([], null).ok, false);
});

Deno.test("the text goes into the tool's one required text argument, and a tool that needs more is refused plainly", () => {
  assertEquals(buildArguments(search, "hi"), { ok: true, args: { query: "hi" } });
  assertEquals(buildArguments({ name: "t", inputSchema: { properties: { foo: { type: "string" } } } }, "hi"), { ok: true, args: { foo: "hi" } });
  assertEquals(buildArguments({ name: "t", inputSchema: { properties: { prompt: { type: "string" }, other: { type: "string" } } } }, "hi"), { ok: true, args: { prompt: "hi" } });
  assert(!buildArguments({ name: "t", inputSchema: { properties: { id: { type: "number" } }, required: ["id"] } }, "hi").ok, "a required number cannot be filled");
  assert(!buildArguments({ name: "t", inputSchema: { properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] } }, "hi").ok, "two required texts cannot be filled");
  assert(!buildArguments({ name: "t" }, "hi").ok, "no schema, no text argument");
});

Deno.test("a result: text blocks joined; an error result is a failure; empty is a failure", () => {
  assertEquals(readToolResult({ content: [{ type: "text", text: "one" }, { type: "image", data: "x" }, { type: "text", text: "two" }] }), { ok: true, text: "one\n\ntwo" });
  assertEquals(readToolResult({ content: [{ type: "text", text: "boom" }], isError: true }), { ok: false, error: "The tool reported an error: boom" });
  assertEquals(readToolResult({ content: [] }).ok, false);
  assertEquals(readToolResult({ structuredContent: { rows: 3 } }), { ok: true, text: '{"rows":3}' });
});

Deno.test("failures say what is wrong: wrong key, wrong address, not an MCP server, a redirect, an unreachable server", async () => {
  const msg = async (deps: McpDeps) => { const r = await mcpCall(ep, deps, null, "x"); return r.ok ? "ok" : r.error; };
  assert(/rejected the key/.test(await msg(server({ status: { initialize: 401 } }).deps)), "401");
  assert(/HTTP 404/.test(await msg(server({ status: { initialize: 404 } }).deps)), "404");
  assert(/redirected/.test(await msg({ ...server().deps, fetchImpl: (() => Promise.resolve(new Response("", { status: 302 }))) as unknown as typeof fetch })), "redirect");
  assert(/not with an MCP response/.test(await msg({ ...server().deps, fetchImpl: (() => Promise.resolve(new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } }))) as unknown as typeof fetch })), "a web page");
  assert(/could not be reached/.test(await msg({ ...server().deps, fetchImpl: (() => Promise.reject(new Error("down"))) as unknown as typeof fetch })), "unreachable");
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  const r = await mcpCall(ep, { ...server().deps, fetchImpl: (() => Promise.reject(timeout)) as unknown as typeof fetch }, null, "x");
  assertEquals(r.ok === false && r.timedOut, true);
  assert(/not allowed/.test(await msg({ ...server().deps, validateUrl: () => Promise.resolve({ ok: false, reason: "resolved to private/loopback ip 10.0.0.1" }) })), "the address is checked first");
});

Deno.test("a JSON-RPC error from the server is reported with its message", async () => {
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, error: { code: -32602, message: "Invalid params" } }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await mcpCall(ep, { ...server().deps, fetchImpl }, null, "x");
  assertEquals(r.ok === false && r.error, "The MCP server returned an error: Invalid params");
});

Deno.test("the test lists the tools and checks the one to use, and calls nothing", async () => {
  const s = server({ tools: [search, { name: "other" }] });
  let t = 0; const now = () => (t += 40);
  const ok = await mcpTest(ep, s.deps, "search", now);
  assertEquals([ok.ok, ok.error, ok.sample], [true, null, "Docs server: 2 tools, using search"]);
  assert(!s.seen.some((x) => x.method === "tools/call"), "no tool was called by the test");
  const bad = await mcpTest(ep, server({ tools: [search, { name: "other" }] }).deps, "nope", now);
  assertEquals(bad.ok, false);
  assert(/offers:/.test(bad.error ?? ""), "lists what it offers");
});

Deno.test("an event stream is read for the response with the right id, skipping other events", () => {
  const body = 'event: ping\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assertEquals(parseRpcBody("text/event-stream", body, 7), { result: { ok: true }, error: undefined });
  assertEquals(parseRpcBody("text/event-stream", body, 8), null);
  assertEquals(parseRpcBody("application/json", "not json", 1), null);
});
