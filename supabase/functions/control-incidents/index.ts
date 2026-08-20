// Incident list + resolution. Incidents are opened automatically by
// sendCriticalAlert() (see _shared/incidents.ts) whenever something
// actually went wrong — an automatic kill-switch trip, a circuit-breaker
// trip, the gate itself failing closed, or a self-audit regression.
//
// GET  /control-incidents            — list the caller's incidents (status
//                                       filter via ?status=open|resolved)
// POST /control-incidents/:id/resolve — mark one resolved with a note
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { triggerWebhooks } from "../_shared/webhooks.ts";

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

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);

  const resolveMatch = url.pathname.match(/\/([0-9a-fA-F-]{36})\/resolve\/?$/);
  if (req.method === "POST" && resolveMatch) {
    const incidentId = resolveMatch[1];
    const body = await req.json().catch(() => ({}));
    const note = String(body?.note || "").slice(0, 2000);

    const { data: existing } = await admin
      .from("incidents").select("id, user_id, status, kind, action_type, provider").eq("id", incidentId).maybeSingle();
    const row = existing as { id?: string; user_id?: string; status?: string; kind?: string; action_type?: string | null; provider?: string | null } | null;
    if (!row?.id) return json({ error: "not_found" }, 404);
    if (row.user_id !== userId) {
      // Active team members with approver/owner role can also resolve --
      // same tier as approval co-sign, since resolving is an action, not
      // just viewing (Phase 2 already grants viewers read-only access).
      // Must run as the calling user (userClient), not the service-role
      // admin client -- is_account_member() reads auth.uid() internally,
      // which is null under the service role.
      const { data: isMember } = await userClient.rpc("is_account_member", { _account_owner_id: row.user_id, _min_role: "approver" });
      if (!isMember) return json({ error: "forbidden" }, 403);
    }
    if (row.status === "resolved") {
      return json({ ok: true, already_resolved: true, id: incidentId });
    }

    const { data: updated, error } = await admin.from("incidents").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolution_note: note || null,
    }).eq("id", incidentId).eq("status", "open") // atomic: only the first resolve wins
      .select("id").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (updated) {
      await triggerWebhooks(admin, userId, "incident_resolved", {
        incident_id: incidentId, kind: row.kind, action_type: row.action_type, provider: row.provider, note: note || null,
      });
    }
    return json({ ok: true, id: incidentId, resolved: true });
  }

  if (req.method === "GET") {
    const status = url.searchParams.get("status");
    let query = admin
      .from("incidents")
      .select("id, kind, status, summary, action_type, provider, decision_id, opened_at, resolved_at, resolved_by, resolution_note")
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(200);
    if (status === "open" || status === "resolved") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    const incidents = data ?? [];
    return json({
      incidents,
      summary: {
        total: incidents.length,
        open: incidents.filter((i: { status: string }) => i.status === "open").length,
      },
    });
  }

  return json({ error: "GET or POST /:id/resolve only" }, 405);
});
