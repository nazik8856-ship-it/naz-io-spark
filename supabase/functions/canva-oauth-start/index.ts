// canva-oauth-start — builds a Canva OAuth2 authorization URL for the current
// authenticated NazAI user using ONLY the scope groups the user checked in the
// pre-consent screen. Mirrors gmail-oauth-start / figma-oauth-start.
//
// If CANVA_CLIENT_ID / CANVA_CLIENT_SECRET are unset, returns a clear
// "not configured yet" error instead of half-opening a broken auth URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { signState, buildAuthUrl, scopesForGroups, isConfigured, CANVA_SCOPE_GROUPS } from "../_shared/canva.ts";

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
    if (!isConfigured()) {
      return new Response(JSON.stringify({
        error: "Canva OAuth is not configured yet. Ask the workspace owner to add CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in Project Settings → Secrets.",
        not_configured: true,
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const origin = typeof body.origin === "string" ? body.origin : "";
    const rawGroups = Array.isArray(body.groups) ? body.groups : [];
    const groups: string[] = rawGroups.filter((g: unknown): g is string => typeof g === "string" && g in CANVA_SCOPE_GROUPS);
    if (!groups.length) {
      return new Response(JSON.stringify({ error: "Select at least one permission to continue." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const scopes = scopesForGroups(groups);
    // User-level storage: ignore any agentId — connections are shared across
    // every project the user owns (same as Google/Figma).
    const state = await signState({ u: user.id, a: null, o: origin, g: groups });
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
