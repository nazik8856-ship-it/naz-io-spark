// shopify-oauth-start — validates a `foo.myshopify.com` domain, stores a
// short-lived server-side transaction keyed by a random state, and returns
// the Shopify authorization URL for the client to open in a popup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAuthUrl, isConfigured, normalizeShop, SHOPIFY_SCOPES } from "../_shared/shopify.ts";
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
    const rate = await checkRateLimit(admin, user.id, "shopify-oauth-start", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return new Response(JSON.stringify({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!isConfigured()) {
      return new Response(JSON.stringify({
        not_configured: true,
        error: "Shopify OAuth is not configured yet. Add SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const shop = normalizeShop(body.shop);
    if (!shop) {
      return new Response(JSON.stringify({
        error: "Enter a valid Shopify store domain (e.g. mystore.myshopify.com).",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const origin = typeof body.origin === "string" ? body.origin : "";

    const state = randomState();
    await admin.from("shopify_oauth_transactions").delete().lt("expires_at", new Date().toISOString());
    const { error: txErr } = await admin.from("shopify_oauth_transactions").insert({
      state,
      user_id: user.id,
      shop_domain: shop,
      request_origin: origin || null,
    });
    if (txErr) throw new Error(`Could not initialize Shopify OAuth: ${txErr.message}`);

    return new Response(
      JSON.stringify({ url: buildAuthUrl(shop, state, SHOPIFY_SCOPES), shop }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
