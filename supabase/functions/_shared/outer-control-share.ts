// Connector trust boundaries (general data security, task 4; docs/connector-trust-boundaries.md).
//
// A tool outside NazAI receives only what its own step needs. This module is the one place that says what that is, so it is a rule
// the code enforces and a test can check, not a habit of the request builder:
//
//   1. Memory: a step's request carries the memory of THAT step only. A Task's memory is shared by all its steps (so NazAI's own
//      decisions stay consistent), but one tool's rejections and rule hits, written about another tool's reply, are not shown to
//      this tool. The same goes for the list of rules "already triggered" (`avoid`).
//   2. Shape: the body is confined to the fields the request format defines. A field added to the request later is dropped before
//      sending until it is listed here on purpose.
//   3. Identifiers: the account's own ids (account, API key, Task, the tool's row and its vault reference) are never in the body.
//
// What does not change: a NazAI agent, the report writer and a starter tool run inside NazAI for the same account and keep the
// full view. What reaches a tool from earlier steps is only what a step declares it depends on (outer-control-workflow.ts).
import { ruleNamesSeen, type MemoryEntry } from "./outer-control-memory.ts";
import { REPORT_TOOL_URL } from "./outer-control-report.ts";
import { isStarterUrl } from "./outer-control-starter.ts";

export type ShareTool = { agent_id?: string | null; endpoint_url: string; request_format?: string | null };

/** A tool that runs outside NazAI: a customer's endpoint or an MCP server. */
export function isExternalTool(tool: ShareTool): boolean {
  return !tool.agent_id && !tool.endpoint_url.startsWith(REPORT_TOOL_URL) && !isStarterUrl(tool.endpoint_url);
}

/** The memory entries written by this step only. Entries without a step (older rows) are not shared. */
export function ownMemory(memory: MemoryEntry[], sessionId: string): MemoryEntry[] {
  return memory.filter((m) => m.session_id === sessionId);
}

/** What an external tool is shown of the Task's memory: this step's lines, and the rules this step's replies already triggered. */
export function sharedMemory(tool: ShareTool, memory: MemoryEntry[], sessionId: string): { memory: MemoryEntry[]; avoid: string[] } {
  const visible = isExternalTool(tool) ? ownMemory(memory, sessionId) : memory;
  return { memory: visible, avoid: ruleNamesSeen(visible) };
}

/** The top-level fields of each request format. Everything else is dropped before the request leaves. */
export const BODY_FIELDS: Record<string, readonly string[]> = {
  generic: ["session_id", "step", "objective", "context", "rules", "accepted", "correction", "answer", "memory", "avoid", "constraints", "response_contract", "instruction"],
  openai_chat: ["model", "messages"],
  anthropic_messages: ["model", "max_tokens", "system", "messages"],
};

/** The body with only the fields its format defines; `removed` names what was dropped. */
export function confineBody(format: string | null | undefined, body: Record<string, unknown>): { body: Record<string, unknown>; removed: string[] } {
  const allowed = BODY_FIELDS[format === "openai_chat" || format === "anthropic_messages" ? format : "generic"];
  const out: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(body)) { if (allowed.includes(k)) out[k] = v; else removed.push(k); }
  return { body: out, removed };
}

type Ids = { user_id: string; api_key_id?: string | null; workflow_id?: string | null };

/** The values that identify the account inside NazAI. Masked out of whatever an external tool is sent. */
export function accountIds(s: Ids, tool: { id: string; credentials_secret_id?: string | null }): string[] {
  return [s.user_id, s.api_key_id, s.workflow_id, tool.id, tool.credentials_secret_id].filter((v): v is string => typeof v === "string" && v.length >= 8);
}
