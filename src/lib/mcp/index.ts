import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAgents from "./tools/list-agents";
import getAgent from "./tools/get-agent";
import listAgentEvents from "./tools/list-agent-events";
import listProjects from "./tools/list-projects";
import runAgent from "./tools/run-agent";

// The OAuth issuer MUST be the direct Supabase host (not the Lovable Cloud proxy).
// Hardcoded, matching src/integrations/supabase/client.ts's own SUPABASE_URL
// and its exact reasoning: guarantee this always targets the correct
// backend regardless of whatever (or whether any) VITE_SUPABASE_PROJECT_ID
// a given build/hosting environment injects. The previous env-var-based
// version silently baked in the OLD pre-migration project's ref into the
// deployed function (whatever build environment produced it had that var
// still set to the old project) -- found by diffing the checked-in
// generated supabase/functions/mcp/index.ts against a fresh local build.
const projectRef = "ekuodpaaiugzywfcmjeo";

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
