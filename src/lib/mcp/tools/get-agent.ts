import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { serverRead } from "../server-read";

export default defineTool({
  name: "get_agent",
  title: "Get NazAI agent",
  description:
    "Get the full manifest for a specific NazAI agent (system prompt, tools, triggers, guardrails, KPIs, UI spec).",
  inputSchema: {
    agent_id: z.string().uuid().describe("The agent's UUID (from list_agents)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ agent_id }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    // The manifest, goal, role and plan are stored encrypted: read through the server, decrypted (server-read.ts).
    const { data, error } = await serverRead(ctx.getToken(), "agents", [
      { m: "select", a: ["*"] },
      { m: "eq", a: ["id", agent_id] },
      { m: "maybeSingle", a: [] },
    ]);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data)
      return { content: [{ type: "text", text: "Agent not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { agent: data },
    };
  },
});
