// RBAC Phase 1: invite a teammate to the caller's account. Creates a
// pending account_members row and emails an accept link. Infrastructure
// only — this does not yet gate any real enforcement path (Phase 2).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidAccountRole, isValidEmail } from "../_shared/account-members.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const APP_BASE_URL = "https://www.nazai.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const ownerId = userData.user.id;
  const ownerEmail = userData.user.email ?? null;

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const role = String(body?.role || "");

  if (!isValidEmail(email)) return json({ error: "Enter a valid email address" }, 400);
  if (!isValidAccountRole(role)) return json({ error: "role must be owner, approver, or viewer" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: inserted, error } = await admin.from("account_members").insert({
    account_owner_id: ownerId,
    email,
    role,
    status: "pending",
  }).select("id, invite_token").maybeSingle();

  if (error) {
    // The UNIQUE (account_owner_id, email) constraint is the expected
    // conflict path — a friendlier message than the raw Postgres error.
    if (error.code === "23505") return json({ error: "That email already has an invite or membership on this account" }, 409);
    return json({ error: error.message }, 500);
  }
  if (!inserted) return json({ error: "Couldn't create the invite" }, 500);

  const acceptUrl = `${APP_BASE_URL}/team/accept?token=${inserted.invite_token}`;
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        templateName: "account-invite",
        recipientEmail: email,
        idempotencyKey: `account-invite-${inserted.id}`,
        templateData: { inviterEmail: ownerEmail, role, acceptUrl },
      }),
    });
  } catch { /* the invite row exists either way — email delivery failing shouldn't block the response */ }

  return json({ ok: true, id: inserted.id });
});
