// gmail-oauth-start — build a Google OAuth authorization URL for the current
// user and return it. Client opens it in a popup / new tab; Google redirects
// to gmail-oauth-callback which stores tokens in agent_integrations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { signState, buildGoogleAuthUrl, scopesForGoogleKind, GMAIL_REDIRECT_URI } from "../_shared/gmail.ts";
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
    const rate = await checkRateLimit(admin, user.id, "gmail-oauth-start", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return new Response(JSON.stringify({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || !Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")) {
      return new Response(JSON.stringify({ error: "Google OAuth is not configured on the server." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    // User-level storage: ignore any agentId that was passed in. Connections
    // are shared across every project a user owns.
    const origin = typeof body.origin === "string" ? body.origin : "";
    const kind = typeof body.kind === "string" ? body.kind : "gmail";
    const state = await signState({ u: user.id, a: null, o: origin, k: kind });
    // Single-use, mirroring Canva/Notion/Shopify/Slack's own DB-backed
    // transaction pattern -- verifyState's HMAC + expiry check alone let a
    // leaked/replayed state be redeemed more than once inside its window.
    await admin.from("gmail_oauth_transactions").delete().lt("expires_at", new Date().toISOString());
    const { error: txErr } = await admin.from("gmail_oauth_transactions").insert({ state, user_id: user.id });
    if (txErr) throw new Error(`Could not initialize Gmail OAuth: ${txErr.message}`);
    const url = buildGoogleAuthUrl(state, scopesForGoogleKind(kind), GMAIL_REDIRECT_URI, user.email ?? undefined);
    return new Response(JSON.stringify({ url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
