// youtube-oauth-start — YouTube requests its own consent screen separately
// from the bundled Google Workspace scopes (Google rejects youtube.readonly
// combined with drive.file in a single OAuth request).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  signState,
  buildGoogleAuthUrl,
  YOUTUBE_SCOPES,
  YOUTUBE_REDIRECT_URI,
} from "../_shared/gmail.ts";

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
    if (!Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || !Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")) {
      return new Response(JSON.stringify({ error: "Google OAuth is not configured on the server." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const agentId = typeof body.agentId === "string" ? body.agentId : null;
    const origin = typeof body.origin === "string" ? body.origin : "";
    const state = await signState({ u: user.id, a: agentId, o: origin, k: "youtube" });
    const url = buildGoogleAuthUrl(state, YOUTUBE_SCOPES, YOUTUBE_REDIRECT_URI, user.email ?? undefined);
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
