// GAP 5 (Final Assembly & Consistency Checker): POST /final-assembly-check
// { kind: "website", website_id } | { kind: "agent", agent_id }
//
// Re-validates the COMPLETE, currently-live package against the account's
// CURRENT rule set right before it's delivered/published -- catching
// emergent issues a generation-time-only gate structurally can't: a rule
// added after generation, or (for a website) a hand-edit made through the
// builder after the generation-time scan already ran. The real logic
// lives in _shared/final-assembly-check.ts so agent-runtime's own
// first-deploy gate can call it directly (same reasoning
// outer-control-text-review.ts was extracted for) -- this is the
// externally-callable form, used by GeneratedDashboard.tsx's publish flow.
//
// Authenticated with the caller's own JWT (not service-role): this
// account's existing RLS policies are what actually enforce that a caller
// can only check/repair their own agent or website, same posture
// capability-status/index.ts already established for a comparable
// JWT-scoped read/write endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAgentAssembly, checkWebsiteAssembly } from "../_shared/final-assembly-check.ts";
import { reportEdgeException } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    if (body?.kind === "website" && typeof body?.website_id === "string") {
      const report = await checkWebsiteAssembly(supabase, userId, body.website_id);
      return json(report, report.ok ? 200 : 404);
    }
    if (body?.kind === "agent" && typeof body?.agent_id === "string") {
      const report = await checkAgentAssembly(supabase, userId, body.agent_id);
      return json(report, report.ok ? 200 : 404);
    }
    return json({ error: "invalid_request", message: `kind must be "website" (with website_id) or "agent" (with agent_id).` }, 400);
  } catch (e) {
    await reportEdgeException(e, { function: "final-assembly-check" });
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
