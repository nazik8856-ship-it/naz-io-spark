import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
    const { data, error } = await sb(ctx)
      .from("agent_events")
      .select("id, run_id, kind, payload, created_at")
      .eq("agent_id", agent_id)
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { events: data ?? [] },
    };
  },
});
