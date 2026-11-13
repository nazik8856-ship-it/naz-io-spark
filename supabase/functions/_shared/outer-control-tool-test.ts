// Outer Control: the connection test. It sends a real request to the tool and only reports "works" when the tool answered
// with a readable, non-empty reply. Anything else is a failure with the reason said plainly.
import { buildToolRequest, type ToolFormat } from "./outer-control-tool-request.ts";
import { extractExternalText } from "./outer-control-intake.ts";
import { readGenericPayload } from "./outer-control-session.ts";
import { mcpTest } from "./outer-control-mcp.ts";
import { parseStrictObject } from "./model-output.ts";
import { describeNetworkFailure, networkFailureKind } from "./network-failure.ts";
import { nazaiAddressProblem } from "./outer-control-address.ts";
import { ownProjectHost } from "./egress.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type TestableTool = {
  id: string; name: string; endpoint_url: string; request_format: string; model: string | null;
  auth_header: string; auth_scheme: string; credentials_secret_id: string | null; last_ok_at: string | null;
};

export type TestDeps = {
  fetchImpl: typeof fetch;
  validateUrl: (u: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  now: () => number;
  timeoutMs: number;
};

export type TestOutcome = { ok: boolean; error: string | null; ms: number | null; sample: string | null };

/** What an HTTP failure means for the person: the cause and what to do. */
export function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403) return `The tool rejected the key (HTTP ${status}). Update the key and test again.`;
  if (status >= 300 && status < 400) return `The tool redirected the request (HTTP ${status}). Outer Control does not follow redirects: use the final address.`;
  if (status === 400 || status === 422) return `The tool did not accept the request (HTTP ${status}). Check the request format and the model name.`;
  if (status === 402) return "The tool says the account behind this key has no credit or an unpaid plan (HTTP 402). Check the account at the tool's provider.";
  if (status === 404 || status === 410) return `Nothing answers at that address (HTTP ${status}). Check the address.`;
  if (status === 413) return "The tool refused the request as too large (HTTP 413).";
  if (status === 415) return "The tool does not accept this request format (HTTP 415). Check the request format.";
  if (status === 405) return "That address does not accept requests of this kind (HTTP 405). Check the address and the request format.";
  if (status === 408 || status === 504) return `The tool took too long to answer (HTTP ${status}).`;
  if (status === 429) return "The tool is limiting requests (HTTP 429). Try again shortly.";
  if (status >= 500) return `The tool is failing on its side (HTTP ${status}).`;
  return `The tool answered HTTP ${status}.`;
}

/** Whether a 2xx answer is a real reply: readable text that is not empty. */
export function readTestReply(payload: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const generic = readGenericPayload(payload);
  const intake = generic !== null ? ({ ok: true, text: generic } as const) : extractExternalText(payload);
  if (!intake.ok) return { ok: false, error: `The tool answered, but its reply could not be read (${intake.code}).` };
  let text = intake.text;
  try {
    const o = (parseStrictObject(text) ?? {}) as { answer?: unknown };
    if (o && typeof o.answer === "string") text = o.answer;
  } catch { /* plain text */ }
  if (!text.trim() || !/[\p{L}\p{N}]/u.test(text)) return { ok: false, error: "The tool answered, but the reply was empty." };
  return { ok: true, text: text.trim() };
}

export async function runConnectionTest(admin: AnyAdmin, tool: TestableTool, deps: TestDeps): Promise<TestOutcome> {
  // NazAI's own address is not an outside tool: say so and what to do instead, before any request.
  const own = nazaiAddressProblem(tool.endpoint_url, ownProjectHost());
  if (own) return { ok: false, error: own, ms: null, sample: null };
  const check = await deps.validateUrl(tool.endpoint_url);
  if (!check.ok) return { ok: false, error: `The address is not allowed: ${check.reason}.`, ms: null, sample: null };
  let token = "";
  if (tool.credentials_secret_id) {
    const { data: secret } = await admin.rpc("read_integration_secret", { sid: tool.credentials_secret_id });
    token = String((secret as { token?: string } | null)?.token ?? "");
  }
  if (tool.request_format === "mcp") {
    // An MCP server is tested in MCP: the handshake works and the tool to use is there and takes text. Nothing is called.
    return await mcpTest({ url: tool.endpoint_url, authHeader: tool.auth_header, authScheme: tool.auth_scheme, token }, { fetchImpl: deps.fetchImpl, validateUrl: deps.validateUrl, timeoutMs: deps.timeoutMs }, tool.model, deps.now);
  }
  const ping = buildToolRequest({
    format: tool.request_format as ToolFormat, model: tool.model, objective: 'Connection test. Reply with status "done" and the answer "ok".',
    rules: [], history: [], sessionId: "connection-test", step: 0,
  });
  const headers: Record<string, string> = { "Content-Type": "application/json", ...ping.headers };
  if (token) headers[tool.auth_header] = `${tool.auth_scheme}${token}`;
  if (tool.request_format === "anthropic_messages") headers["anthropic-version"] = "2023-06-01";
  const started = deps.now();
  try {
    const res = await deps.fetchImpl(tool.endpoint_url, { method: "POST", headers, body: JSON.stringify(ping.body), redirect: "manual", signal: AbortSignal.timeout(deps.timeoutMs) });
    const text = await res.text();
    const ms = Math.max(0, deps.now() - started);
    if (!res.ok) return { ok: false, error: describeHttpFailure(res.status), ms, sample: null };
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch { /* plain text */ }
    const reply = readTestReply(payload);
    return reply.ok ? { ok: true, error: null, ms, sample: reply.text.slice(0, 80) } : { ok: false, error: reply.error, ms, sample: null };
  } catch (e) {
    return { ok: false, error: describeNetworkFailure(networkFailureKind(e)).reason, ms: null, sample: null };
  }
}
