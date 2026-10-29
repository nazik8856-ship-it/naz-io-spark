import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

// Data encryption, front 3: an event's details are stored encrypted, so they are read through the outer-control-read edge
// function (as the signed-in user, decrypted), the same way the website reads them.
async function readEvents(token: string, agentId: string, limit: number) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/outer-control-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_PUBLISHABLE_KEY! },
    body: JSON.stringify({ table: "agent_events", ops: [
      { m: "select", a: ["id, run_id, kind, payload, created_at"] },
      { m: "eq", a: ["agent_id", agentId] },
      { m: "order", a: ["created_at", { ascending: false }] },
      { m: "limit", a: [limit] },
    ] }),
  });
  const body = (await resp.json().catch(() => null)) as { data: unknown[] | null; error: { message: string } | null } | null;
  return body ?? { data: null, error: { message: `Could not read events (HTTP ${resp.status}).` } };
}

export default defineTool({
  name: "list_agent_events",
  title: "List agent events",
  description:
    "List the most recent runtime events (reasoning, tool_call, tool_result, action, finished, error) for a NazAI agent.",
  inputSchema: {
    agent_id: z.string().uuid().describe("The agent's UUID."),
    limit: z.number().int().min(1).max(200).optional().describe("Max events (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ agent_id, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await readEvents(ctx.getToken(), agent_id, limit ?? 50);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { events: data ?? [] },
    };
  },
});
