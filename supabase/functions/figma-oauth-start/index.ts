// figma-oauth-start — builds a real Figma OAuth2 authorization URL for the
// current authenticated NazAI user and returns it. The client opens the URL
// in a popup; Figma redirects back to figma-oauth-callback with ?code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { signState, buildAuthUrl, scopesForGroups, FIGMA_DEFAULT_GROUPS } from "../_shared/figma.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Confirmed zero rate-limit coverage across every OAuth start/callback
// endpoint. Human-driven (one click per connection attempt), so this is
// generous -- sized against a scripted loop, not normal use.
const RATE_LIMIT_PER_MINUTE = 10;

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
    // increment_rate_limit is service_role-only -- a separate admin client is
    // needed purely for this check, the rest of the handler stays on `supabase`.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const rate = await checkRateLimit(admin, user.id, "figma-oauth-start", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return new Response(JSON.stringify({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    const requestedGroups: string[] = Array.isArray(body.groups) && body.groups.length
      ? body.groups.filter((g: unknown): g is string => typeof g === "string")
      : FIGMA_DEFAULT_GROUPS;
    const scopes = scopesForGroups(requestedGroups);
    if (!scopes.length) {
      return new Response(JSON.stringify({ error: "No valid scopes selected." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const state = await signState({ u: user.id, a: agentId, o: origin, g: requestedGroups });
    return new Response(JSON.stringify({ url: buildAuthUrl(state, scopes) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
