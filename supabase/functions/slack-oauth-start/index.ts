// slack-oauth-start — builds a real Slack OAuth v2 authorization URL using
// only the bot scopes the user checked on the NazAI pre-consent screen.
// The client opens the URL in a popup; Slack redirects back to
// slack-oauth-callback with ?code & ?state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAuthUrl, isConfigured, scopesForGroups, SLACK_DEFAULT_GROUPS } from "../_shared/slack.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Confirmed zero rate-limit coverage across every OAuth start/callback
// endpoint. Human-driven (one click per connection attempt), so this is
// generous -- sized against a scripted loop, not normal use.
const RATE_LIMIT_PER_MINUTE = 10;

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const rate = await checkRateLimit(admin, user.id, "slack-oauth-start", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return new Response(JSON.stringify({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!isConfigured()) {
      return new Response(JSON.stringify({
        not_configured: true,
        error: "Slack OAuth is not configured yet. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in Project Settings → Secrets.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = await req.json().catch(() => ({}));
    const origin = typeof body.origin === "string" ? body.origin : "";
    const requestedGroups: string[] = Array.isArray(body.groups) && body.groups.length
      ? body.groups.filter((g: unknown): g is string => typeof g === "string")
      : SLACK_DEFAULT_GROUPS;
    const scopes = scopesForGroups(requestedGroups);
    if (!scopes.length) {
      return new Response(JSON.stringify({ error: "No valid scopes selected." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const state = randomState();
    await admin.from("slack_oauth_transactions").delete().lt("expires_at", new Date().toISOString());
    const { error: txErr } = await admin.from("slack_oauth_transactions").insert({
      state,
      user_id: user.id,
      scope_groups: requestedGroups,
      request_origin: origin || null,
    });
    if (txErr) throw new Error(`Could not initialize Slack OAuth: ${txErr.message}`);

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
