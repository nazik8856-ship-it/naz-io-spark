// "Outer NazAI" plan, item 5: the public Control API's verdict endpoint --
// the core feature. Lets an EXTERNAL platform submit one of its own
// proposed actions and get back a verdict from NazAI's decision-gating
// engine, authenticated via a nazai_sk_... API key (see api-keys/index.ts
// and _shared/api-key-auth.ts).
//
// Verdict-only, per the user's explicit scope choice: this never lets an
// external caller create, edit, or delete the account's own hard rules,
// safety rules, spend caps, or approvals -- it only judges an action and
// reports back allow/modify/block/deferred, using the SAME vocabulary
// control-engine/index.ts's own `decision` field already uses everywhere
// else in this codebase, rather than inventing a parallel one.
//
// verify_jwt = false (like agent-runtime) -- this does its own auth via
// the Authorization: Bearer nazai_sk_... header, not a Supabase JWT.
//
// Rate limiting (item 7), API-key traceability on the logged decision
// (item 8), and abuse alerting (item 9) land as their own follow-on
// commits on this same file -- nothing to rate-limit or trace until the
// endpoint itself exists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex, isValidRawKeyFormat } from "../_shared/api-key-auth.ts";
import { runControlGate } from "../_shared/control-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // ---- Auth: Authorization: Bearer nazai_sk_... ----------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const presented = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!presented || !isValidRawKeyFormat(presented)) {
    return json({
      error: "unauthorized",
      message: "Missing or malformed API key. Send Authorization: Bearer nazai_sk_<key>.",
    }, 401);
  }
  const keyHash = await sha256Hex(presented);
  const { data: resolved, error: resolveErr } = await admin.rpc("resolve_api_key", { _key_hash: keyHash });
  const row = (Array.isArray(resolved) ? resolved[0] : resolved) as { user_id?: string; key_id?: string } | null;
  if (resolveErr || !row?.user_id) {
    return json({ error: "unauthorized", message: "Invalid, expired, or revoked API key." }, 401);
  }
  const userId = row.user_id;

  const body = await req.json().catch(() => ({}));
  const actionType = String(body?.action_type || "").trim();
  const provider = String(body?.provider || "unknown").trim() || "unknown";
  const description = String(body?.description || "").trim();
  const params = body?.params ?? {};
  const mode = body?.mode === "full" ? "full" : "fast";

  if (!actionType) return json({ error: "action_type required" }, 400);
  if (!description) return json({ error: "description required" }, 400);

  // ---- mode="fast" (default): deterministic layer only, no LLM call --------
  // Hard rules, safety scanner, spend cap, kill switch, circuit breaker --
  // cheap and fast, the same gate every internal caller passes through
  // first, called directly instead of routing through control-engine's
  // full LLM-scored assessment.
  if (mode === "fast") {
    const gate = await runControlGate(admin, {
      userId, actionType, provider, description, params,
      agentId: null, runId: null, stepIndex: null,
      origin: "external-api",
    });
    if (!gate.ok) {
      return json({
        verdict: gate.verdict === "block" ? "block" : "modify",
        reason: gate.reason,
        decision_id: gate.decisionId,
        gate_source: gate.source,
        mode: "fast",
      });
    }
    return json({
      verdict: "allow",
      reason: "No hard rule, safety match, spend cap, or circuit breaker stopped this action.",
      decision_id: null,
      gate_source: null,
      mode: "fast",
    });
  }

  // ---- mode="full": the full LLM-scored intent/risk/fit assessment --------
  // Forwards into control-engine using its existing internal service-role
  // bypass (the same path agent-runtime already uses) with assess_only so
  // control-engine judges the action but never tries to carry it out --
  // the external caller executes its own action, NazAI only judges it.
  const resp = await fetch(`${supabaseUrl}/functions/v1/control-engine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      "x-internal-user-id": userId,
      "x-decision-source": "external_api",
    },
    body: JSON.stringify({ action_type: actionType, provider, description, params, assess_only: true }),
  });
  const data = await resp.json().catch(() => ({} as Record<string, unknown>));
  if (!resp.ok) {
    return json({ error: "assessment_failed", message: String(data?.error || data?.message || `HTTP ${resp.status}`) }, 502);
  }

  return json({
    verdict: data?.decision ?? "block",
    reason: data?.reasoning ?? data?.reason ?? null,
    decision_id: data?.decision_id ?? null,
    confidence_score: data?.confidence_score ?? null,
    modification: data?.modification ?? null,
    policy_version: data?.policy_version ?? null,
    mode: "full",
  });
});
