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
  name: "list_agents",
  title: "List NazAI agents",
  description:
    "List all NazAI AI agents owned by the signed-in user, including id, name, role, goal, status, autonomy, and schedule.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Max agents to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("agents")
      .select("id, name, slug, role, goal, status, autonomy, schedule_label, next_run_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { agents: data ?? [] },
    };
  },
});
