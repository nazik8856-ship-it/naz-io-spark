// "Outer NazAI" plan, item 3: create / list / revoke API keys.
//
// A NazAI user manages their own keys here (verify_jwt = true — normal
// logged-in-user function). The raw secret is generated here, hashed, and
// returned to the caller EXACTLY ONCE on creation — matching how every
// professional API-key product (Stripe, etc.) handles this. It is never
// persisted in plaintext and never retrievable again after this response;
// api_keys.key_hash is the only thing stored (see the schema migration for
// why a fast indexed hash, not bcrypt, is the correct primitive here).
//
// "15 more items" plan, item 2: this function originally always acted on
// the CALLER's own user id -- meaning an invited team owner viewing a
// shared account could never actually create or revoke a key for that
// account, only their own, even after the frontend page and the table's
// RLS both learned about team accounts. Every route now accepts an
// optional account_id and, when it names an account other than the
// caller's own, verifies the caller genuinely holds the 'owner' role on
// it via the same is_account_member() RPC the DB's own RLS policies use --
// this can't just rely on RLS the way the frontend's plain SELECT can,
// since every write here goes through the service-role admin client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex, generateRawKey, displayPrefixFor } from "../_shared/api-key-auth.ts";
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { isValidOnUncertainPolicy } from "../_shared/api-key-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);
  const url = new URL(req.url);

  // ---- POST /api-keys/:id/revoke -------------------------------------------
  const revokeMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/revoke\/?$/);
  if (req.method === "POST" && revokeMatch) {
    const keyId = revokeMatch[1];
    const body = await req.json().catch(() => ({}));
    const targetUserId = await resolveAccountScope(userClient, userId, body?.account_id, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data, error } = await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("user_id", targetUserId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ ok: true, already_revoked: true });
    return json({ ok: true, revoked: true });
  }

  // ---- POST /api-keys/:id/policy ---------------------------------------
  // "Zero human review" plan, item 1: lets an account set (or change) a
  // key's on_uncertain auto-resolve policy without needing a UI panel for
  // it yet -- a direct API call, same as the rest of this backend-only
  // round. Default stays 'human_review' (today's exact behavior) for any
  // key that never calls this.
  const policyMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/policy\/?$/);
  if (req.method === "POST" && policyMatch) {
    const keyId = policyMatch[1];
    const body = await req.json().catch(() => ({}));
    if (!isValidOnUncertainPolicy(body?.on_uncertain)) {
      return json({ error: "on_uncertain must be one of: human_review, auto_deny, auto_allow" }, 400);
    }
    const targetUserId = await resolveAccountScope(userClient, userId, body?.account_id, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data, error } = await admin
      .from("api_keys")
      .update({ on_uncertain: body.on_uncertain })
      .eq("id", keyId)
      .eq("user_id", targetUserId)
      .select("id, on_uncertain")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "Key not found for this account." }, 404);
    return json({ ok: true, ...data });
  }

  // ---- GET /api-keys --------------------------------------------------------
  if (req.method === "GET") {
    const targetUserId = await resolveAccountScope(userClient, userId, url.searchParams.get("account_id"), "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data, error } = await admin
      .from("api_keys")
      .select("id, name, key_prefix, scopes, on_uncertain, last_used_at, revoked_at, expires_at, created_at")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, keys: data ?? [] });
  }

  // ---- POST /api-keys ---------------------------------------------------
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim().slice(0, 120);
    if (!name) return json({ error: "A name is required for the key (e.g. \"Production integration\")." }, 400);
    if (body?.on_uncertain !== undefined && !isValidOnUncertainPolicy(body.on_uncertain)) {
      return json({ error: "on_uncertain must be one of: human_review, auto_deny, auto_allow" }, 400);
    }

    const targetUserId = await resolveAccountScope(userClient, userId, body?.account_id, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const rawKey = generateRawKey();
    const keyHash = await sha256Hex(rawKey);
    const displayPrefix = displayPrefixFor(rawKey);

    const { data, error } = await admin
      .from("api_keys")
      .insert({
        user_id: targetUserId, name, key_prefix: displayPrefix, key_hash: keyHash,
        ...(body.on_uncertain ? { on_uncertain: body.on_uncertain } : {}),
      })
      .select("id, name, key_prefix, scopes, on_uncertain, created_at")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "Couldn't create the key" }, 500);

    return json({ ok: true, key: rawKey, ...data });
  }

  return json({ error: "Method not allowed" }, 405);
});
