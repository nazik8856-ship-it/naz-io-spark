// Consumes agent pending_approval events. Approves → dispatches the queued
// external action (send_email / http_post / generic). Rejects → logs and moves on.
// Input: { eventId: string, action: "approve" | "reject", note?: string }
//
// This queue is per-agent (manifest guardrails), not the org-wide quorum
// queue in `pending_approvals` — a single click here always resolves it, by
// design. What it must NOT skip is the deterministic control gate: a kill
// switch flipped, a hard rule added, or a circuit breaker tripped AFTER this
// item was queued must still stop it from actually running now.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runControlGate } from "../_shared/control-gate.ts";
import { claimRowOnce, releaseRowClaim } from "../_shared/idempotency.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Confirmed zero rate-limit coverage on this endpoint. A human approve/
// reject click is naturally low-frequency; this is sized to allow a real
// burst of queued items being worked through at once without ever letting
// a misbehaving/scripted caller hammer the gate re-check + dispatch path.
const RATE_LIMIT_PER_MINUTE = 30;

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
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const rate = await checkRateLimit(admin, userId, "agent-approval", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const eventId = String(body.eventId || "").trim();
    const action = String(body.action || "").trim();
    const note = String(body.note || "").slice(0, 400);
    if (!eventId || !["approve", "reject"].includes(action)) {
      return json({ error: "eventId and action=approve|reject required" }, 400);
    }

    const { data: evt, error: evtErr } = await admin.from("agent_events")
      .select("id, agent_id, run_id, user_id, kind, payload")
      .eq("id", eventId).maybeSingle();
    if (evtErr || !evt) return json({ error: "Event not found" }, 404);
    if (evt.user_id !== userId) return json({ error: "Forbidden" }, 403);
    if (evt.kind !== "pending_approval") return json({ error: "Not a pending_approval" }, 400);

    // Idempotency: atomically claim this event row before doing anything
    // else. The prior "SELECT for an existing resolution, then decide" check
    // was read-then-act -- two concurrent approve clicks on the same eventId
    // could both pass it before either logged its resolution, both re-run
    // the gate below, and both dispatch the real action. claimRowOnce is a
    // single UPDATE ... WHERE resolved_at IS NULL, so only one concurrent (or
    // retried) request can ever win it.
    const claimed = await claimRowOnce(admin, "agent_events", eventId, "resolved_at");
    if (!claimed) {
      const { data: existing } = await admin.from("agent_events")
        .select("id, kind")
        .eq("agent_id", evt.agent_id)
        .in("kind", ["approval_granted", "approval_rejected"])
        .contains("payload", { original_event_id: eventId })
        .limit(1).maybeSingle();
      if (existing) return json({ ok: true, alreadyResolved: existing.kind });
      // Claimed by another in-flight request that hasn't logged its
      // resolution event yet -- fail toward NOT re-running the action.
      return json({ ok: true, alreadyResolved: "in_progress" });
    }

    const logEvent = (kind: string, payload: Record<string, unknown>) =>
      admin.from("agent_events").insert({
        agent_id: evt.agent_id, run_id: evt.run_id, user_id: userId, kind, payload,
      });

    const payload = (evt.payload as Record<string, unknown>) || {};
    const actionType = String(payload.action || "");

    if (action === "reject") {
      await logEvent("approval_rejected", { original_event_id: eventId, action: actionType, note });
      return json({ ok: true, resolved: "rejected" });
    }

    // Re-check the SAME deterministic gate control-engine and agent-runtime
    // use — spend cap, kill switch, hard rules, circuit breaker, safety
    // scanner — before this queued item is actually carried out. Being
    // approved once does not exempt an action from a safety condition that
    // changed while it sat in the queue.
    if (actionType === "send_email" || actionType === "http_post") {
      const gateParams = (payload.payload as Record<string, unknown>) || {};
      const gate = await runControlGate(admin, {
        userId,
        actionType,
        provider: actionType === "send_email" ? "Gmail" : "webhook",
        description: `Approved ${actionType} from an agent's manifest-guardrail queue (event ${eventId}).`,
        params: gateParams,
        agentId: evt.agent_id as string | null,
        runId: evt.run_id as string | null,
        origin: "agent-approval",
      });
      if (!gate.ok) {
        await logEvent("approval_rejected", {
          original_event_id: eventId,
          action: actionType,
          reason: `Stopped by the control gate at execute time: ${gate.reason}`,
          gate_source: gate.source,
        });
        return json({
          ok: false,
          resolved: "blocked",
          error: gate.source ?? "control_gate",
          message: gate.reason ?? "Stopped by the control system before it could run.",
        }, 409);
      }
    }

    // Approve → dispatch the action.
    if (actionType === "send_email") {
      const p = (payload.payload as Record<string, unknown>) || {};
      const to = String(p.to || "").trim();
      const subject = String(p.subject || "").slice(0, 200);
      const bodyText = String(p.body || "").slice(0, 6000);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !bodyText) {
        await logEvent("approval_rejected", { original_event_id: eventId, action: actionType, reason: "invalid queued payload" });
        return json({ error: "Queued email payload invalid" }, 400);
      }
      const { data: agentRow } = await admin.from("agents").select("manifest").eq("id", evt.agent_id).maybeSingle();
      const agentName = ((agentRow?.manifest as Record<string, unknown>)?.name as string) || "Agent";
      try {
        const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
          body: JSON.stringify({
            templateName: "agent-notification",
            recipientEmail: to,
            idempotencyKey: `approval-${eventId}`,
            templateData: { subject, body: bodyText, agentName },
          }),
        });
        const respBody = await r.json().catch(() => ({}));
        const ok = r.ok && (respBody?.success !== false);
        // A genuine delivery failure isn't a resolved outcome -- release the
        // claim so a real retry (re-clicking approve) isn't permanently
        // blocked, same release-on-failure shape /approvals/:id/execute uses.
        if (!ok) await releaseRowClaim(admin, "agent_events", eventId, "resolved_at");
        await logEvent("approval_granted", {
          original_event_id: eventId,
          action: actionType,
          note,
          result_ref: respBody?.messageId ?? null,
          ok,
          summary: ok ? `Email delivered to ${to} — "${subject}"` : `Delivery failed: ${respBody?.error || `HTTP ${r.status}`}`,
        });
        await logEvent("action", { type: "send_email", target: to, ok, result_ref: respBody?.messageId ?? null, summary: ok ? `Approved & sent: ${subject}` : `Approved but delivery failed` });
        return json({ ok, resolved: "approved", result: respBody });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        await releaseRowClaim(admin, "agent_events", eventId, "resolved_at");
        await logEvent("approval_granted", { original_event_id: eventId, action: actionType, ok: false, summary: `Send exception: ${msg}` });
        return json({ ok: false, error: msg }, 500);
      }
    }

    if (actionType === "http_post") {
      const p = (payload.payload as Record<string, unknown>) || {};
      const url = String(p.url || "").trim();
      const bodyObj = (p.body && typeof p.body === "object") ? p.body : {};
      if (!/^https:\/\//.test(url)) {
        await logEvent("approval_rejected", { original_event_id: eventId, action: actionType, reason: "invalid queued url" });
        return json({ error: "Queued http_post url invalid" }, 400);
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "NazAI-Agent/1.0" },
          body: JSON.stringify(bodyObj),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const respText = (await r.text().catch(() => "")).slice(0, 200);
        if (!r.ok) await releaseRowClaim(admin, "agent_events", eventId, "resolved_at");
        await logEvent("approval_granted", {
          original_event_id: eventId, action: actionType, note,
          ok: r.ok, summary: `${r.status} ${respText}`,
        });
        await logEvent("action", { type: "http_post", target: url, ok: r.ok, result_ref: null, summary: `Approved: ${r.status} ${respText}` });
        return json({ ok: r.ok, resolved: "approved", status: r.status });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        await releaseRowClaim(admin, "agent_events", eventId, "resolved_at");
        await logEvent("approval_granted", { original_event_id: eventId, action: actionType, ok: false, summary: `POST exception: ${msg}` });
        return json({ ok: false, error: msg }, 500);
      }
    }

    // Generic request_approval (or unknown action): just record approval so agent can resume.
    await logEvent("approval_granted", { original_event_id: eventId, action: actionType, note, ok: true, summary: "Operator approved." });
    return json({ ok: true, resolved: "approved" });
  } catch (e) {
    console.error("agent-approval error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
