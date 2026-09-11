// Incident list + lifecycle. Incidents are opened automatically by
// sendCriticalAlert() (see _shared/incidents.ts) whenever something
// actually went wrong — an automatic kill-switch trip, a circuit-breaker
// trip, the gate itself failing closed, or a self-audit regression.
//
// GET  /control-incidents                — list the caller's incidents
//                                           (status filter via
//                                           ?status=open|acknowledged|resolved)
// POST /control-incidents/:id/acknowledge — mark someone has seen it
// POST /control-incidents/:id/assign      — claim it, or assign to another
//                                            active approver+ team member
//                                            (body: { assignee_id: string|null })
// POST /control-incidents/:id/resolve     — mark resolved with a note and
//                                            an optional root_cause_category /
//                                            related_incident_id
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ROOT_CAUSE_CATEGORIES, isValidRootCauseCategory } from "../_shared/incidents.ts";
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

  // Shared by every mutating endpoint below: loads the incident and
  // confirms the caller may act on it (the account owner, or an active
  // team member with approver/owner role -- same tier as approval
  // co-sign, since acting on an incident is an action, not just viewing).
  // Must run is_account_member() as the calling user (userClient), not
  // the service-role admin client, since it reads auth.uid() internally.
  async function loadAuthorizedIncident(incidentId: string) {
    const { data: existing } = await admin
      .from("incidents")
      .select("id, user_id, status, kind, action_type, provider, assigned_to")
      .eq("id", incidentId).maybeSingle();
    const row = existing as {
      id?: string; user_id?: string; status?: string; kind?: string;
      action_type?: string | null; provider?: string | null; assigned_to?: string | null;
    } | null;
    if (!row?.id) return { row: null, forbidden: false };
    if (row.user_id === userId) return { row, forbidden: false };
    const { data: isMember } = await userClient.rpc("is_account_member", { _account_owner_id: row.user_id, _min_role: "approver" });
    return { row, forbidden: !isMember };
  }

  const acknowledgeMatch = url.pathname.match(/\/([0-9a-fA-F-]{36})\/acknowledge\/?$/);
  if (req.method === "POST" && acknowledgeMatch) {
    const incidentId = acknowledgeMatch[1];
    const { row, forbidden } = await loadAuthorizedIncident(incidentId);
    if (!row) return json({ error: "not_found" }, 404);
    if (forbidden) return json({ error: "forbidden" }, 403);
    if (row.status !== "open") {
      return json({ ok: true, already_acknowledged: row.status !== "open", id: incidentId, status: row.status });
    }

    const { data: updated, error } = await admin.from("incidents").update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    }).eq("id", incidentId).eq("status", "open") // atomic: only the first acknowledge wins
      .select("id").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (updated) {
      await triggerWebhooks(admin, row.user_id!, "incident_acknowledged", {
        incident_id: incidentId, kind: row.kind, action_type: row.action_type, provider: row.provider,
      });
    }
    return json({ ok: true, id: incidentId, status: "acknowledged" });
  }

  const assignMatch = url.pathname.match(/\/([0-9a-fA-F-]{36})\/assign\/?$/);
  if (req.method === "POST" && assignMatch) {
    const incidentId = assignMatch[1];
    const { row, forbidden } = await loadAuthorizedIncident(incidentId);
    if (!row) return json({ error: "not_found" }, 404);
    if (forbidden) return json({ error: "forbidden" }, 403);
    if (row.status === "resolved") return json({ error: "already_resolved" }, 409);

    const body = await req.json().catch(() => ({}));
    // Omitted or absent entirely -> claim it for the caller (the common
    // case, one click). Explicit null -> unassign. Any other id must
    // resolve to a real, active approver+ member of this incident's
    // account -- assigning to someone who couldn't even act on it would
    // be a dead end.
    let assigneeId: string | null;
    if (!("assignee_id" in body) || body.assignee_id === undefined) {
      assigneeId = userId;
    } else if (body.assignee_id === null) {
      assigneeId = null;
    } else if (typeof body.assignee_id === "string") {
      if (body.assignee_id === row.user_id) {
        assigneeId = body.assignee_id; // the account owner is always eligible
      } else {
        const { data: memberRow } = await admin
          .from("account_members")
          .select("member_id")
          .eq("account_owner_id", row.user_id)
          .eq("member_id", body.assignee_id)
          .eq("status", "active")
          .in("role", ["approver", "owner"])
          .maybeSingle();
        if (!memberRow) return json({ error: "invalid_assignee" }, 400);
        assigneeId = body.assignee_id;
      }
    } else {
      return json({ error: "assignee_id must be a string or null" }, 400);
    }

    const { error } = await admin.from("incidents").update({ assigned_to: assigneeId }).eq("id", incidentId);
    if (error) return json({ error: error.message }, 500);
    await triggerWebhooks(admin, row.user_id!, "incident_assigned", {
      incident_id: incidentId, kind: row.kind, assigned_to: assigneeId,
    });
    return json({ ok: true, id: incidentId, assigned_to: assigneeId });
  }

  const resolveMatch = url.pathname.match(/\/([0-9a-fA-F-]{36})\/resolve\/?$/);
  if (req.method === "POST" && resolveMatch) {
    const incidentId = resolveMatch[1];
    const body = await req.json().catch(() => ({}));
    const note = String(body?.note || "").slice(0, 2000);
    if (body?.root_cause_category !== undefined && body.root_cause_category !== null && !isValidRootCauseCategory(body.root_cause_category)) {
      return json({ error: `root_cause_category must be one of: ${ROOT_CAUSE_CATEGORIES.join(", ")}` }, 400);
    }
    const rootCauseCategory = isValidRootCauseCategory(body?.root_cause_category) ? body.root_cause_category : null;
    const relatedIncidentId = typeof body?.related_incident_id === "string" ? body.related_incident_id : null;

    const { row, forbidden } = await loadAuthorizedIncident(incidentId);
    if (!row) return json({ error: "not_found" }, 404);
    if (forbidden) return json({ error: "forbidden" }, 403);
    if (row.status === "resolved") {
      return json({ ok: true, already_resolved: true, id: incidentId });
    }
    // A related incident must be real, belong to the same account, and not
    // be the incident itself -- otherwise this becomes a way to leak
    // whether an arbitrary uuid exists, link across accounts, or record an
    // incident as its own cause.
    if (relatedIncidentId) {
      if (relatedIncidentId === incidentId) return json({ error: "an incident cannot be related to itself" }, 400);
      const { data: relatedRow } = await admin.from("incidents").select("id").eq("id", relatedIncidentId).eq("user_id", row.user_id!).maybeSingle();
      if (!relatedRow) return json({ error: "invalid_related_incident_id" }, 400);
    }

    const { data: updated, error } = await admin.from("incidents").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolution_note: note || null,
      root_cause_category: rootCauseCategory,
      related_incident_id: relatedIncidentId,
    }).eq("id", incidentId).neq("status", "resolved") // atomic: only the first resolve wins, from open or acknowledged
      .select("id").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (updated) {
      // Must be row.user_id (the incident's own account owner), not the
      // calling userId -- a team member resolving on someone else's
      // account must never fire webhooks configured on the team member's
      // own separate account. Found during review: this line used to read
      // `userId` (pre-dating acknowledge/assign, which already got this
      // right), a real cross-tenant leak if that team member happens to
      // have their own webhooks configured elsewhere.
      await triggerWebhooks(admin, row.user_id!, "incident_resolved", {
        incident_id: incidentId, kind: row.kind, action_type: row.action_type, provider: row.provider, note: note || null,
        root_cause_category: rootCauseCategory, related_incident_id: relatedIncidentId,
      });
    }
    return json({ ok: true, id: incidentId, resolved: true });
  }

  if (req.method === "GET") {
    const status = url.searchParams.get("status");
    let query = admin
      .from("incidents")
      .select("id, kind, status, summary, action_type, provider, decision_id, opened_at, acknowledged_at, acknowledged_by, assigned_to, resolved_at, resolved_by, resolution_note, root_cause_category, related_incident_id")
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(200);
    if (status === "open" || status === "acknowledged" || status === "resolved") query = query.eq("status", status);
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

  return json({ error: "GET, or POST /:id/acknowledge, /:id/assign, /:id/resolve" }, 405);
});
