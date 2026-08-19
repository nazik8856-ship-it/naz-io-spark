// RBAC Phase 1: accept a pending team invite by token. The caller must be
// logged in (any NazAI account) — accepting attaches THEIR user id to the
// membership row as member_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const memberId = userData.user.id;
  const memberEmail = (userData.user.email ?? "").toLowerCase();

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "GET") {
    // Preview the invite before the user commits to accepting it.
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);
    const { data } = await admin.from("account_members")
      .select("role, status, email").eq("invite_token", token).maybeSingle();
    if (!data) return json({ error: "not_found" }, 404);
    return json({ role: data.role, status: data.status, invited_email: data.email });
  }

  if (req.method !== "POST") return json({ error: "GET or POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");
  if (!token) return json({ error: "token required" }, 400);

  const { data: invite } = await admin.from("account_members")
    .select("id, email, status, account_owner_id").eq("invite_token", token).maybeSingle();
  if (!invite) return json({ error: "not_found", message: "This invite link is invalid." }, 404);
  if (invite.status !== "pending") {
    return json({ error: "already_resolved", message: `This invite has already been ${invite.status}.` }, 409);
  }
  if (String(invite.email).toLowerCase() !== memberEmail) {
    return json({ error: "email_mismatch", message: "This invite was sent to a different email address than your account." }, 403);
  }
  if (invite.account_owner_id === memberId) {
    return json({ error: "self_invite", message: "You can't accept an invite to your own account." }, 400);
  }

  // Atomic: only the first accept wins.
  const { data: updated, error } = await admin.from("account_members")
    .update({ member_id: memberId, status: "active", accepted_at: new Date().toISOString() })
    .eq("id", invite.id).eq("status", "pending")
    .select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return json({ error: "duplicate_membership", message: "You're already a member of this account." }, 409);
    return json({ error: error.message }, 500);
  }
  if (!updated) return json({ error: "already_resolved", message: "This invite was just resolved by another request." }, 409);

  return json({ ok: true });
});
