import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { serverRead, asJson } from "../server-read";

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
    // An agent's role and goal are stored encrypted: read through the server, decrypted (server-read.ts).
    const { data, error } = await serverRead(ctx.getToken(), "agents", [
      { m: "select", a: ["id, name, slug, role, goal, status, autonomy, schedule_label, next_run_at, created_at"] },
      { m: "order", a: ["created_at", { ascending: false }] },
      { m: "limit", a: [limit ?? 50] },
    ]);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { agents: asJson(data ?? []) },
    };
  },
});
