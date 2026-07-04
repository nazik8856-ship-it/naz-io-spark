import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "run_agent",
  title: "Run NazAI agent now",
  description:
    "Manually trigger a run of a NazAI agent against its connected business tools. Returns the run summary.",
  inputSchema: {
    agent_id: z.string().uuid().describe("The agent's UUID."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  handler: async ({ agent_id }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const url = `${process.env.SUPABASE_URL}/functions/v1/agent-runtime`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.getToken()}`,
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
      },
      body: JSON.stringify({ agentId: agent_id, trigger: "mcp" }),
    });
    const text = await resp.text();
    if (!resp.ok)
      return { content: [{ type: "text", text: `Run failed (${resp.status}): ${text}` }], isError: true };
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    return {
      content: [{ type: "text", text: typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2) }],
      structuredContent: { result: parsed },
    };
  },
});
