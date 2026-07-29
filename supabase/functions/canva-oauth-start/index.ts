// canva-oauth-start — builds a Canva Connect OAuth2 authorization URL for the
// current authenticated NazAI user with only the scope groups the user picked
// on the pre-consent screen. Client opens the URL in a popup; Canva redirects
// back to canva-oauth-callback with ?code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAuthUrl, resolveCanvaScopes, generatePkce, generateRandomBase64Url, isConfigured } from "../_shared/canva.ts";

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
        not_configured: true,
        error: "Canva OAuth is not configured yet. Add CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in Project Settings → Secrets.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const groups: string[] = Array.isArray(body.groups) ? body.groups.map((x: unknown) => String(x)) : [];
    const scopes = resolveCanvaScopes(groups);
    if (!scopes.length) {
      return new Response(JSON.stringify({ error: "No scopes selected." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const origin = typeof body.origin === "string" ? body.origin : "";
    const { verifier, challenge } = await generatePkce();
    const state = generateRandomBase64Url(32);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Keep the verifier out of the browser and out of OAuth state. The callback
    // atomically consumes this short-lived row using the opaque random state.
    await admin.from("canva_oauth_transactions").delete().lt("expires_at", new Date().toISOString());
    const { error: transactionError } = await admin.from("canva_oauth_transactions").insert({
      state,
      user_id: user.id,
      code_verifier: verifier,
      scope_groups: groups,
      request_origin: origin || null,
    });
    if (transactionError) throw new Error(`Could not initialize Canva OAuth: ${transactionError.message}`);

    const authorizationUrl = buildAuthUrl(state, scopes, challenge);
    return new Response(JSON.stringify({ url: authorizationUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
