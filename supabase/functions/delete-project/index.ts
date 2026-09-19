// Server-side delete for a generated website or AI agent.
//
// The client-side path (supabase.from(table).delete() straight from the
// browser, gated by RLS) went through three rounds of fixes this session --
// replacing window.confirm(), hardening error handling, then refreshing a
// possibly-stale session before the call -- and a live, reproducible case
// still had a delete silently affect zero rows despite a controlled RLS
// simulation proving the policy itself allows it for that exact user and
// row. Something about how that specific browser request's JWT reached
// PostgREST was never fully pinned down, and re-guessing client-side session
// timing was no longer a productive use of another round.
//
// This moves the operation here instead: the caller's JWT is verified
// directly (auth.getClaims on the raw token, not the ambient client's
// possibly-stale in-memory session), then the actual delete runs on the
// service-role client, scoped by an explicit user_id check in the query
// itself. RLS is not part of this request's path at all, so it can't be
// the cause of a re-occurrence.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT_PER_MINUTE = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return json({ error: "Your session has expired. Please refresh the page and sign in again." }, 401);
    }
    const userId = claims.claims.sub as string;

    const rate = await checkRateLimit(admin, userId, "delete-project", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({ error: "Too many delete requests. Try again in a moment." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "");
    const id = String(body?.id || "").trim();
    if (!id || (kind !== "agent" && kind !== "website")) {
      return json({ error: "kind ('agent'|'website') and id are required" }, 400);
    }
    const table = kind === "agent" ? "agents" : "websites";

    // The service-role client bypasses RLS entirely -- this .eq("user_id",
    // userId) IS the authorization check for this delete, not a redundant
    // extra. .select("id") confirms a row actually left the table instead
    // of trusting a no-error response that could mean zero rows matched.
    const { data, error } = await admin.from(table).delete().eq("id", id).eq("user_id", userId).select("id");
    if (error) {
      console.error("delete-project failed", { table, id, userId, error });
      return json({ error: error.message }, 500);
    }
    if (!data || data.length === 0) {
      return json({ error: "Not found, or it doesn't belong to your account." }, 404);
    }
    return json({ deleted: true, id });
  } catch (e) {
    console.error("delete-project error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
