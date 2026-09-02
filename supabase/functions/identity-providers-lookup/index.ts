import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkIpRateLimit } from "../_shared/rate-limit.ts";

// Lets AuthModal tell "wrong password" apart from "this email only has a
// Google/Apple identity" without ever accepting an unverified password as
// valid. Wraps the get_identity_providers_for_email() SECURITY DEFINER
// function (see its migration for the disclosure-scope reasoning) behind
// this edge function specifically so the lookup can be IP rate-limited --
// GoTrue's own signIn/signUp endpoints are rate-limited, but a bare RPC
// call over PostgREST is not, which would otherwise make this an
// unthrottled email-enumeration oracle for anyone holding the public
// anon key. The DB function's own grants now only allow service_role,
// so this is the only caller that can reach it.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Wide enough for a burst of concurrent legitimate sign-in attempts (e.g.
// many testers behind one shared/corporate IP) while still bounding a
// scripted enumeration run against this specific endpoint.
const RATE_LIMIT_PER_WINDOW = 100;
const RATE_LIMIT_WINDOW_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[identity-providers-lookup] missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "server_configuration_error" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  const ipRate = await checkIpRateLimit(admin, ip, "identity-providers-lookup", RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
  if (!ipRate.allowed) {
    return json({ error: "rate_limited", message: "Too many attempts. Try again in a few minutes." }, 429);
  }

  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (typeof email !== "string" || !email.trim()) {
    return json({ error: "invalid_body" }, 400);
  }

  const { data, error } = await admin.rpc("get_identity_providers_for_email", { _email: email.trim() });
  if (error) {
    console.error("[identity-providers-lookup] RPC failed:", error.message);
    return json({ error: "lookup_failed" }, 500);
  }

  return json({ providers: data ?? [] });
});
