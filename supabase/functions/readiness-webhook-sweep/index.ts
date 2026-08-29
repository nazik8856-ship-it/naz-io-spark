// Scheduled (pg_cron, daily): "knowledge & autonomy" plan item 6 -- the
// two new webhook events with no natural "this just changed" moment of
// their own (automation_readiness_ready, shadow_policy_promotion_ready).
// Their underlying reports (automation-readiness.ts's own
// evaluateAutomationReadiness, prior round's item 11) are pull-only, so
// this computes each candidate key's current state, compares it against
// the last state automation_readiness_signal_state recorded, and fires
// a webhook only on a genuine "became ready" transition (never every
// day it stays ready, never a "became un-ready" event -- see
// readiness-webhook-sweep.ts's hasBecomeReady and its own reasoning).
//
// Reuses gatherAutomationReadinessInput/evaluateAutomationReadiness
// verbatim -- its own report already includes a "shadow_policy" signal
// (last round's item 6 evaluateShadowPromotionReadiness, composed in),
// so ONE computation per key answers both this item's questions; no new
// evaluation engine.
//
// Scoped to keys where either signal could actually be actionable:
// automation-readiness only matters for a key still on human_review
// (a fully-autonomous key has nothing left to "become ready" for), and
// shadow-promotion only matters for a key actually running a shadow
// trial.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gatherAutomationReadinessInput, evaluateAutomationReadiness } from "../_shared/automation-readiness.ts";
import { hasBecomeReady } from "../_shared/readiness-webhook-sweep.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type SignalName = "automation_readiness" | "shadow_promotion";

async function processSignal(
  admin: ReturnType<typeof createClient>,
  userId: string,
  apiKeyId: string,
  signal: SignalName,
  currentlyReady: boolean,
  webhookEvent: "automation_readiness_ready" | "shadow_policy_promotion_ready",
): Promise<boolean> {
  const { data: stateRow } = await admin
    .from("automation_readiness_signal_state")
    .select("ready")
    .eq("api_key_id", apiKeyId)
    .eq("signal", signal)
    .maybeSingle();
  const previouslyReady = (stateRow as { ready?: boolean } | null)?.ready ?? null;

  await admin.from("automation_readiness_signal_state").upsert(
    { user_id: userId, api_key_id: apiKeyId, signal, ready: currentlyReady, updated_at: new Date().toISOString() },
    { onConflict: "api_key_id,signal" },
  );

  if (!hasBecomeReady(previouslyReady, currentlyReady)) return false;
  await triggerWebhooks(admin, userId, webhookEvent, { api_key_id: apiKeyId });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data, error } = await admin
    .from("api_keys")
    .select("id, user_id, on_uncertain, shadow_on_uncertain")
    .is("revoked_at", null)
    .or("on_uncertain.eq.human_review,shadow_on_uncertain.not.is.null");
  if (error) return json({ error: error.message }, 500);

  type Row = { id: string; user_id: string; on_uncertain: string | null; shadow_on_uncertain: string | null };
  const rows = (data ?? []) as Row[];

  let automationReadinessFired = 0;
  let shadowPromotionFired = 0;

  for (const key of rows) {
    const input = await gatherAutomationReadinessInput(admin, key.id);
    const report = evaluateAutomationReadiness(input);

    if (key.on_uncertain === "human_review") {
      if (await processSignal(admin, key.user_id, key.id, "automation_readiness", report.ready, "automation_readiness_ready")) {
        automationReadinessFired++;
      }
    }

    if (key.shadow_on_uncertain) {
      const shadowSignal = report.signals.find((s) => s.name === "shadow_policy");
      const shadowReady = shadowSignal?.status === "ready";
      if (await processSignal(admin, key.user_id, key.id, "shadow_promotion", shadowReady, "shadow_policy_promotion_ready")) {
        shadowPromotionFired++;
      }
    }
  }

  return json({ ok: true, keys_scanned: rows.length, automation_readiness_fired: automationReadinessFired, shadow_promotion_fired: shadowPromotionFired });
});
