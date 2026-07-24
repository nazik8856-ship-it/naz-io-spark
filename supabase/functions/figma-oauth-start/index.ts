// figma-oauth-start — builds a real Figma OAuth2 authorization URL for the
// current authenticated NazAI user and returns it. The client opens the URL
// in a popup; Figma redirects back to figma-oauth-callback with ?code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { signState, buildAuthUrl } from "../_shared/figma.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Deno.env.get("FIGMA_CLIENT_ID") || !Deno.env.get("FIGMA_CLIENT_SECRET")) {
      return new Response(JSON.stringify({
        error: "Figma OAuth is not configured. Add FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET in Project Settings → Secrets.",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const agentId = typeof body.agentId === "string" ? body.agentId : null;
    const origin = typeof body.origin === "string" ? body.origin : "";
    const state = await signState({ u: user.id, a: agentId, o: origin });
    return new Response(JSON.stringify({ url: buildAuthUrl(state) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
