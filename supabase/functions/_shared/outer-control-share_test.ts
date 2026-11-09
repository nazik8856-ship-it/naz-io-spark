// Run with: deno test --allow-env supabase/functions/_shared/outer-control-share_test.ts
// Connector trust boundaries (security task 4): what a tool outside NazAI is sent.
import { accountIds, BODY_FIELDS, confineBody, isExternalTool, ownMemory, sharedMemory } from "./outer-control-share.ts";
import { buildToolRequest } from "./outer-control-tool-request.ts";
import type { MemoryEntry } from "./outer-control-memory.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const EXTERNAL = { endpoint_url: "https://tool.example.com/v1" };
const MCP = { endpoint_url: "https://mcp.example.com/sse", request_format: "mcp" };
const AGENT = { agent_id: "agent-1", endpoint_url: "nazai-internal://agent" };
const REPORT = { endpoint_url: "nazai-internal://report" };
const STARTER = { endpoint_url: "nazai-internal://starter/research" };

const mem = (session_id: string | null, kind: MemoryEntry["kind"], names: string[], summary: string): MemoryEntry => ({ step_no: 1, kind, rule_names: names, summary, session_id });
const TASK_MEMORY = [
  mem("step-a", "rejection", ["Rule A"], "Leg 1 · Step 1: tool A broke Rule A"),
  mem("step-b", "rule", ["Rule B"], "Leg 2 · Step 1: tool B was cleaned"),
  mem(null, "plan", [], "an older row without a step"),
];

Deno.test("only a customer's endpoint or an MCP server is external; a NazAI agent, the report writer and a starter tool are not", () => {
  assertEquals([EXTERNAL, MCP].map(isExternalTool), [true, true]);
  assertEquals([AGENT, REPORT, STARTER].map(isExternalTool), [false, false, false]);
});

Deno.test("an external tool is shown its own step's memory and rules only; a NazAI tool keeps the whole Task's", () => {
  assertEquals(ownMemory(TASK_MEMORY, "step-b").map((m) => m.summary), ["Leg 2 · Step 1: tool B was cleaned"]);
  const ext = sharedMemory(EXTERNAL, TASK_MEMORY, "step-b");
  assertEquals([ext.memory.length, ext.avoid], [1, ["Rule B"]], "tool B does not learn that tool A broke Rule A");
  const none = sharedMemory(EXTERNAL, TASK_MEMORY, "step-new");
  assertEquals([none.memory, none.avoid], [[], []], "a new step starts with nothing from the others");
  const internal = sharedMemory(AGENT, TASK_MEMORY, "step-b");
  assertEquals([internal.memory.length, internal.avoid], [3, ["Rule A", "Rule B"]]);
});

Deno.test("the body is confined to the fields its format defines; anything else is dropped and named", () => {
  const sample = { session_id: "s", step: 1, objective: "o", user_id: "leak", project: { rules: ["x"] } };
  const r = confineBody("generic_json", sample);
  assertEquals([Object.keys(r.body), r.removed], [["session_id", "step", "objective"], ["user_id", "project"]]);
  assertEquals(confineBody("openai_chat", { model: "m", messages: [], api_key_id: "k" }).removed, ["api_key_id"]);
  assertEquals(confineBody("anthropic_messages", { model: "m", max_tokens: 1, system: "s", messages: [], tools: [] }).removed, ["tools"]);
});

Deno.test("what the request builder produces today fits the allowlist exactly (nothing is dropped from a real request)", () => {
  const input = { format: "generic_json" as const, model: null, objective: "o", context: "c", rules: [], history: [], correction: null, answer: null, sessionId: "s", step: 1 };
  for (const format of ["generic_json", "openai_chat", "anthropic_messages"] as const) {
    const built = buildToolRequest({ ...input, format });
    assertEquals(confineBody(format, built.body).removed, [], format);
  }
  assertEquals(Object.keys(BODY_FIELDS).sort(), ["anthropic_messages", "generic", "openai_chat"]);
});

Deno.test("the account's ids that must never reach a tool: account, API key, Task, the tool's row and its vault reference", () => {
  const ids = accountIds({ user_id: "5d0c6b2e-1111-4222-8333-944455556666", api_key_id: null, workflow_id: "wf-12345678" }, { id: "tool-row-id-1", credentials_secret_id: "sec-1" });
  assertEquals(ids, ["5d0c6b2e-1111-4222-8333-944455556666", "wf-12345678", "tool-row-id-1"], "empty and too-short values are not used as masks");
});
