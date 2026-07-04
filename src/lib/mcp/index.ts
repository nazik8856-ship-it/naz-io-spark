import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAgents from "./tools/list-agents";
import getAgent from "./tools/get-agent";
import listAgentEvents from "./tools/list-agent-events";
import listProjects from "./tools/list-projects";
import runAgent from "./tools/run-agent";

// The OAuth issuer MUST be the direct Supabase host (not the Lovable Cloud proxy).
// Read the project ref from the Vite-inlined env var so this file stays
// import-safe at build time and cold start.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "nazai-mcp",
  title: "NazAI",
  version: "0.1.0",
  instructions:
    "Tools for NazAI, an AI-agent generator. Use `list_agents` to see the user's agents, `get_agent` for the full manifest, `list_agent_events` for recent runtime activity, `list_projects` for generated websites/missions, and `run_agent` to trigger a manual run.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listAgents, getAgent, listAgentEvents, listProjects, runAgent],
});
