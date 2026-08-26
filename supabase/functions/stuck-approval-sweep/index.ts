// "Zero human review" plan, item 5: scheduled sweep (pg_cron), same shape
// as retention-sweep / approval-escalation-sweep. A safety net for the
// exact gap those two don't cover -- items 1/2's per-key policy and item
// 4's live callback only ever resolve a "needs a second look" outcome at
// the MOMENT it's first created; nothing before this covered a
// pending_approvals row that's somehow already stuck (an old decision
// from before a policy was ever set, a callback whose request crashed
// before its own bounded wait ran, or any other edge case).
//
// Deliberately scoped to ONLY rows whose api key has an automatic
// on_uncertain policy configured. An account that has kept "human_review"
// (today's default, and every internal-agent-originated approval, which
// never has an api_key_id at all) is completely untouched here -- this is
// a backstop for automation that already opted in, never a way to
// silently override someone who is still deliberately relying on a human
// to look.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isStuckPastMaxWait, resolveSweepFallback, STUCK_APPROVAL_MAX_WAIT_MINUTES } from "../_shared/api-key-policy.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = {
  id: string;
  user_id: string;
  decision_id: string | null;
  action_type: string;
  provider: string;
  risk_tier: string;
  created_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const now = new Date();

  const { data: rows, error } = await admin
    .from("pending_approvals")
    .select("id, user_id, decision_id, action_type, provider, risk_tier, created_at")
    .eq("status", "pending");
  if (error) return json({ error: error.message }, 500);

  let resolved = 0;
  let checked = 0;
  for (const row of (rows ?? []) as Row[]) {
    if (!isStuckPastMaxWait(row.created_at, now)) continue;
    checked++;

    // Only a row that traces back to a real, still-known api key is even
    // eligible -- no decision_id (a chat/agent-driven approval, which
    // never carries one) or no api_key_id on that decision (an internal
    // origin) both mean "not this sweep's job," same as a key that kept
    // human_review.
    if (!row.decision_id) continue;
    const { data: decisionRow } = await admin
      .from("agent_decisions").select("api_key_id").eq("id", row.decision_id).maybeSingle();
    const apiKeyId = (decisionRow as { api_key_id?: string | null } | null)?.api_key_id ?? null;
    if (!apiKeyId) continue;

    const { data: keyRow } = await admin
      .from("api_keys").select("on_uncertain, callback_fallback").eq("id", apiKeyId).maybeSingle();
    const key = keyRow as { on_uncertain?: string | null; callback_fallback?: string | null } | null;
    if (!key) continue;

    const auto = resolveSweepFallback(key.on_uncertain, key.callback_fallback);
    if (!auto.autoResolved) continue; // human_review (or unrecognized) -- left for a human, never swept

    const comment =
      `Resolved automatically to ${auto.resolution} by the safety-net sweep: this had been stuck for over ` +
      `${STUCK_APPROVAL_MAX_WAIT_MINUTES} minutes on an api key configured for automatic resolution, with no ` +
      `human review ever coming — no human reviewed this.`;

    // Atomic claim: only the sweep run that actually flips status away
    // from "pending" gets to act -- guards against racing a live request
    // that's mid-resolving this exact row itself (e.g. a callback whose
    // own synchronous wait is still in flight, or a human resolving it
    // the moment before this sweep reached it).
    const { data: claimed } = await admin
      .from("pending_approvals")
      .update({ status: auto.status, resolved_at: now.toISOString(), comment })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      await admin.from("pending_approval_events").insert({
        approval_id: row.id, user_id: row.user_id, event_type: "auto_resolved", note: comment,
      });
    } catch { /* the resolution itself already happened; a missing timeline entry must never block it */ }

    await triggerWebhooks(admin, row.user_id, "approval_auto_resolved", {
      approval_id: row.id, action_type: row.action_type, provider: row.provider,
      risk_tier: row.risk_tier, resolution: auto.resolution,
    });

    resolved++;
  }

  return json({ ok: true, checked, resolved });
});
