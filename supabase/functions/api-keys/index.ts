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
import { isValidOnUncertainPolicy, summarizeShadowObservations, evaluateShadowPromotionReadiness, summarizeShadowPromotionReadiness, type ShadowObservationRow } from "../_shared/api-key-policy.ts";
import { evaluateAutomationReadiness, gatherAutomationReadinessInput, READINESS_LOOKBACK_DAYS } from "../_shared/automation-readiness.ts";
import { keyLatencyStats, keyUptimeStats } from "../_shared/key-performance.ts";
import { buildPolicyRecommendation, type ActionTypeEscalations, type EscalatedDecisionOutcome } from "../_shared/policy-recommendation.ts";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../_shared/decision-scoring.ts";
import { isValidPersona, isValidFallbackMessage } from "../_shared/response-context.ts";
import { generateEmbeddingWithinBudget, formatEmbeddingLiteral } from "../_shared/decision-embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// "Knowledge & autonomy" plan, item 8: a recent operational window for the
// per-key speed/uptime report -- long enough for a real sample, short
// enough to answer "how is this doing right now" rather than a slow-moving
// historical average.
const PERFORMANCE_LOOKBACK_DAYS = 7;

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
      return json({ error: "on_uncertain must be one of: human_review, auto_deny, auto_allow, auto_narrow, callback" }, 400);
    }
    // Item 4: "callback" needs somewhere to notify and something to sign
    // with -- reject it outright rather than silently accepting a policy
    // that could never actually notify anyone.
    // "Policy autonomy" plan, item 4: a human explicitly setting
    // on_uncertain here is exactly "clearing it back the normal way" --
    // a system-initiated downgrade (repeated abuse-pauses, a broken
    // callback) must never keep showing as active once a human has
    // actually acted on it. Also gives the callback-failure streak a
    // fresh start, since a human just made a real, deliberate choice.
    const update: Record<string, unknown> = {
      on_uncertain: body.on_uncertain,
      on_uncertain_downgraded_at: null,
      on_uncertain_downgrade_reason: null,
      callback_failure_streak: 0,
    };
    // Item 6: a SEPARATE, optional shadow-mode policy -- lets an account
    // preview a candidate on_uncertain value against real traffic without
    // it ever governing a real escalation. `null` explicitly clears it
    // (stops shadowing); omitting the field entirely leaves whatever was
    // set before untouched.
    if (body?.shadow_on_uncertain !== undefined) {
      if (body.shadow_on_uncertain !== null && !isValidOnUncertainPolicy(body.shadow_on_uncertain)) {
        return json({ error: "shadow_on_uncertain must be null or one of: human_review, auto_deny, auto_allow, auto_narrow, callback" }, 400);
      }
      update.shadow_on_uncertain = body.shadow_on_uncertain;
    }
    // Item 8: a SEPARATE choice from on_uncertain entirely -- what happens
    // if the control gate ITSELF throws an unexpected error (a NazAI
    // outage), not a "needs a second look" verdict. Default stays 'block'
    // for any key that never calls this.
    if (body?.on_gate_error !== undefined) {
      if (body.on_gate_error !== "block" && body.on_gate_error !== "allow") {
        return json({ error: "on_gate_error must be 'block' or 'allow'" }, 400);
      }
      update.on_gate_error = body.on_gate_error;
    }
    // Item 11: an account can raise (or lower) its OWN key's request-rate
    // limit instead of sharing the platform's fixed default. `null`
    // explicitly clears it back to the default.
    if (body?.rate_limit_per_minute !== undefined) {
      if (body.rate_limit_per_minute !== null) {
        const limit = Number(body.rate_limit_per_minute);
        if (!Number.isInteger(limit) || limit < 1 || limit > 6000) {
          return json({ error: "rate_limit_per_minute must be an integer between 1 and 6000, or null to use the default" }, 400);
        }
        update.rate_limit_per_minute = limit;
      } else {
        update.rate_limit_per_minute = null;
      }
    }
    // "White-labeled 'brain' endpoint" plan, item 3: lets a company tell
    // NazAI once how their AI should sound on POST /control-api/v1/respond,
    // applied to every call instead of repeating it every time. `null`
    // explicitly clears it; omitting the field leaves whatever was set
    // before untouched -- same convention as every other optional setting
    // on this endpoint.
    if (body?.response_persona !== undefined) {
      if (!isValidPersona(body.response_persona)) {
        return json({ error: "response_persona must be a non-empty string of at most 500 characters, or null to clear it" }, 400);
      }
      update.response_persona = body.response_persona === null ? null : String(body.response_persona).trim();
    }
    // "/respond" MVP backlog, item 175: a per-key override for the
    // generic "I don't have enough information to answer that." wording
    // (both the leak guard's and the grounding check's own fallback) --
    // same null-clears/omit-leaves-untouched convention as
    // response_persona above.
    if (body?.fallback_message !== undefined) {
      if (!isValidFallbackMessage(body.fallback_message)) {
        return json({ error: "fallback_message must be a non-empty string of at most 500 characters, or null to clear it" }, 400);
      }
      update.fallback_message = body.fallback_message === null ? null : String(body.fallback_message).trim();
    }
    // Item 12: a SEPARATE daily AI-spend ceiling just for this key's own
    // mode="full" (AI-scored) usage -- stored in ai_spend_caps (the same
    // table the account-wide and per-agent caps already use), not a
    // column on api_keys itself, since it's a third parallel dimension of
    // that exact mechanism. Validated here; the actual write happens
    // after the api_keys update below succeeds, once the key is
    // confirmed to exist for this account.
    if (body?.ai_spend_cap_usd !== undefined && body.ai_spend_cap_usd !== null) {
      const cap = Number(body.ai_spend_cap_usd);
      if (!Number.isFinite(cap) || cap <= 0) {
        return json({ error: "ai_spend_cap_usd must be a positive number, or null to remove the cap" }, 400);
      }
    }
    if (body.on_uncertain === "callback") {
      const callbackUrl = String(body?.callback_url || "").trim();
      const callbackSecret = String(body?.callback_secret || "").trim();
      if (!callbackUrl || !callbackSecret) {
        return json({ error: "on_uncertain='callback' requires both callback_url and callback_secret" }, 400);
      }
      update.callback_url = callbackUrl;
      update.callback_secret = callbackSecret;
      if (body?.callback_timeout_seconds !== undefined) {
        const timeout = Number(body.callback_timeout_seconds);
        if (!Number.isFinite(timeout) || timeout < 5 || timeout > 60) {
          return json({ error: "callback_timeout_seconds must be a number between 5 and 60" }, 400);
        }
        update.callback_timeout_seconds = timeout;
      }
      if (body?.callback_fallback !== undefined) {
        if (body.callback_fallback !== "auto_allow" && body.callback_fallback !== "auto_deny") {
          return json({ error: "callback_fallback must be 'auto_allow' or 'auto_deny'" }, 400);
        }
        update.callback_fallback = body.callback_fallback;
      }
    }
    const targetUserId = await resolveAccountScope(userClient, userId, body?.account_id, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data, error } = await admin
      .from("api_keys")
      .update(update)
      .eq("id", keyId)
      .eq("user_id", targetUserId)
      .select("id, on_uncertain, callback_url, callback_timeout_seconds, callback_fallback, shadow_on_uncertain, on_gate_error, rate_limit_per_minute, response_persona, fallback_message, on_uncertain_downgraded_at, on_uncertain_downgrade_reason")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "Key not found for this account." }, 404);

    let aiSpendCapUsd: number | null | undefined;
    if (body?.ai_spend_cap_usd !== undefined) {
      if (body.ai_spend_cap_usd === null) {
        await admin.from("ai_spend_caps").delete().eq("user_id", targetUserId).eq("api_key_id", keyId);
        aiSpendCapUsd = null;
      } else {
        const cap = Number(body.ai_spend_cap_usd);
        // Two-step find-then-update-or-insert -- ai_spend_caps' per-key
        // uniqueness is a PARTIAL unique index (WHERE api_key_id IS NOT
        // NULL, matching the per-agent cap's own shape), so a plain
        // upsert can't infer the right conflict target, same fix
        // record_ai_spend's own agent/account rows and this project's
        // circuit-breaker rows already apply for the identical reason.
        const { data: existingCap } = await admin
          .from("ai_spend_caps").select("id").eq("user_id", targetUserId).eq("api_key_id", keyId).maybeSingle();
        if (existingCap) {
          await admin.from("ai_spend_caps").update({ daily_cap_usd: cap, enabled: true }).eq("id", (existingCap as { id: string }).id);
        } else {
          await admin.from("ai_spend_caps").insert({ user_id: targetUserId, api_key_id: keyId, daily_cap_usd: cap, enabled: true });
        }
        aiSpendCapUsd = cap;
      }
    }
    return json({ ok: true, ...data, ...(aiSpendCapUsd !== undefined ? { ai_spend_cap_usd: aiSpendCapUsd } : {}) });
  }

  // ---- GET /api-keys/:id/shadow-summary --------------------------------
  // "Zero human review" plan, item 6: what a shadow_on_uncertain policy
  // WOULD have decided on real escalations so far, next to what actually
  // happened -- read live off pending_approvals.status through the
  // approval_id foreign key rather than a second stored "actual outcome"
  // column, so a shadow observation taken before a human later resolves
  // the real row still compares correctly with zero extra writes.
  const shadowSummaryMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/shadow-summary\/?$/);
  if (req.method === "GET" && shadowSummaryMatch) {
    const keyId = shadowSummaryMatch[1];
    const targetUserId = await resolveAccountScope(userClient, userId, url.searchParams.get("account_id"), "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys")
      .select("id, shadow_on_uncertain")
      .eq("id", keyId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (keyErr) return json({ error: keyErr.message }, 500);
    if (!keyRow) return json({ error: "Key not found for this account." }, 404);
    const shadowPolicy = (keyRow as { shadow_on_uncertain: string | null }).shadow_on_uncertain;
    if (!shadowPolicy) return json({ ok: true, shadow_on_uncertain: null, summary: null });

    const { data: obs, error: obsErr } = await admin
      .from("api_key_shadow_observations")
      .select("shadow_resolution, action_type, provider, created_at, pending_approvals(status)")
      .eq("api_key_id", keyId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (obsErr) return json({ error: obsErr.message }, 500);

    type ObsRow = { shadow_resolution: "approved" | "rejected"; action_type: string; provider: string | null; created_at: string; pending_approvals: { status: string | null } | null };
    const rows: ShadowObservationRow[] = ((obs ?? []) as ObsRow[]).map((r) => ({
      shadow_resolution: r.shadow_resolution,
      actual_status: r.pending_approvals?.status ?? null,
      action_type: r.action_type,
      provider: r.provider,
      created_at: r.created_at,
    }));
    const summary = summarizeShadowObservations(rows);
    // "Policy autonomy" plan, item 6: a real, evidence-based answer to
    // "has this shadow policy earned promotion" alongside the raw
    // numbers, instead of leaving a human to eyeball them.
    const readiness = evaluateShadowPromotionReadiness(summary);
    return json({
      ok: true,
      shadow_on_uncertain: shadowPolicy,
      summary,
      promotion_readiness: readiness,
      promotion_readiness_message: summarizeShadowPromotionReadiness(readiness),
    });
  }

  // ---- GET /api-keys/:id/automation-readiness --------------------------
  // "Policy autonomy" plan, item 11: a real, evidence-based answer to
  // "what's actually stopping me from fully automating this key" --
  // composing item 5's per-key confidence calibration, item 6's shadow-
  // promotion-readiness threshold, and the existing precedent-
  // contradiction citations (item 9 of the prior round) into one report.
  // Pure read/aggregation over data each already computes -- no new
  // storage, nothing here changes any real policy.
  const readinessMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/automation-readiness\/?$/);
  if (req.method === "GET" && readinessMatch) {
    const keyId = readinessMatch[1];
    const targetUserId = await resolveAccountScope(userClient, userId, url.searchParams.get("account_id"), "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys").select("id").eq("id", keyId).eq("user_id", targetUserId).maybeSingle();
    if (keyErr) return json({ error: keyErr.message }, 500);
    if (!keyRow) return json({ error: "Key not found for this account." }, 404);

    const input = await gatherAutomationReadinessInput(admin, keyId);
    const report = evaluateAutomationReadiness(input);
    return json({ ok: true, ...report });
  }

  // ---- GET /api-keys/:id/policy-recommendation --------------------------
  // "Knowledge & autonomy" plan, item 15: combines the automation-
  // readiness report above (what's blocking) with a real, historically-
  // sized answer to "what specific change would actually help" -- never
  // applies anything itself; a human still confirms any resulting change
  // through POST /api-keys/:id/action-policies (item 9).
  const recommendationMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/policy-recommendation\/?$/);
  if (req.method === "GET" && recommendationMatch) {
    const keyId = recommendationMatch[1];
    const targetUserId = await resolveAccountScope(userClient, userId, url.searchParams.get("account_id"), "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys").select("id").eq("id", keyId).eq("user_id", targetUserId).maybeSingle();
    if (keyErr) return json({ error: keyErr.message }, 500);
    if (!keyRow) return json({ error: "Key not found for this account." }, 404);

    const readinessInput = await gatherAutomationReadinessInput(admin, keyId);
    const readiness = evaluateAutomationReadiness(readinessInput);

    const since = new Date(Date.now() - READINESS_LOOKBACK_DAYS * 86400_000).toISOString();
    const { data: escalatedRows, error: escErr } = await admin
      .from("agent_decisions")
      .select("id, action_type, confidence_score")
      .eq("api_key_id", keyId)
      .eq("escalated", true)
      .eq("is_test", false)
      .gte("created_at", since)
      .limit(5000);
    if (escErr) return json({ error: escErr.message }, 500);

    type EscRow = { id: string; action_type: string | null; confidence_score: number | null };
    const escalated = ((escalatedRows ?? []) as EscRow[]).filter((r) => r.action_type != null && r.confidence_score != null);

    const badOutcomeByDecision = new Map<string, boolean>();
    if (escalated.length) {
      const { data: outcomeRows } = await admin
        .from("decision_outcomes")
        .select("decision_id, direction")
        .in("decision_id", escalated.map((r) => r.id));
      for (const o of (outcomeRows ?? []) as { decision_id: string; direction: string | null }[]) {
        const dir = String(o.direction || "").toLowerCase();
        if (dir === "negative") badOutcomeByDecision.set(o.decision_id, true);
        else if (!badOutcomeByDecision.has(o.decision_id)) badOutcomeByDecision.set(o.decision_id, false);
      }
    }

    const byActionType = new Map<string, EscalatedDecisionOutcome[]>();
    for (const r of escalated) {
      const list = byActionType.get(r.action_type!) ?? [];
      list.push({
        confidenceScore: r.confidence_score!,
        badOutcome: badOutcomeByDecision.has(r.id) ? (badOutcomeByDecision.get(r.id) as boolean) : null,
      });
      byActionType.set(r.action_type!, list);
    }
    const perActionType: ActionTypeEscalations[] = [...byActionType.entries()].map(([actionType, escalations]) => ({ actionType, escalations }));

    const recommendation = buildPolicyRecommendation(
      readiness.ready,
      readiness.blockers[0] ?? null,
      DEFAULT_CONFIDENCE_THRESHOLD,
      escalated.length,
      perActionType,
    );

    return json({ ok: true, window_days: READINESS_LOOKBACK_DAYS, automation_readiness: readiness, recommendation });
  }

  // ---- GET /api-keys/:id/performance ------------------------------------
  // "Knowledge & autonomy" plan, item 8: a real answer to "how fast is
  // this, and how reliable has it been for me specifically" -- scoped to
  // one key, the same status transparency any serious API dependency
  // offers. gate_duration_ms is already recorded on every gated decision
  // (control-gate.ts's own existing observability); this is a pure
  // read/aggregation over it, never a new capture mechanism.
  const performanceMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/performance\/?$/);
  if (req.method === "GET" && performanceMatch) {
    const keyId = performanceMatch[1];
    const targetUserId = await resolveAccountScope(userClient, userId, url.searchParams.get("account_id"), "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys").select("id").eq("id", keyId).eq("user_id", targetUserId).maybeSingle();
    if (keyErr) return json({ error: keyErr.message }, 500);
    if (!keyRow) return json({ error: "Key not found for this account." }, 404);

    // A recent operational window -- "how is this doing right now," not a
    // slow-moving historical average. Not filtered by is_test: a sandbox
    // key's own report is exactly as real and useful to its own caller as
    // a live key's, it's simply scoped to that one key's own traffic
    // either way (see sandbox-mode.ts's module comment on this item).
    const since = new Date(Date.now() - PERFORMANCE_LOOKBACK_DAYS * 86400_000).toISOString();
    const { data: rows, error } = await admin
      .from("agent_decisions")
      .select("gate_duration_ms, source")
      .eq("api_key_id", keyId)
      .gte("created_at", since)
      .limit(20000);
    if (error) return json({ error: error.message }, 500);

    type Row = { gate_duration_ms: number | null; source: string | null };
    const typedRows = (rows ?? []) as Row[];
    const durations = typedRows
      .map((r) => r.gate_duration_ms)
      .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
    const latency = keyLatencyStats(durations);
    const uptime = keyUptimeStats(typedRows.map((r) => r.source));

    return json({
      ok: true,
      window_days: PERFORMANCE_LOOKBACK_DAYS,
      decisions_in_window: typedRows.length,
      latency,
      uptime,
    });
  }

  // ---- /api-keys/:id/action-policies ------------------------------------
  // "Policy autonomy" plan, item 10: break down a key's auto-resolve
  // trust by action type instead of one blanket on_uncertain policy for
  // everything it sends. GET lists the configured overrides; POST
  // upserts one (an existing pattern is replaced, not duplicated -- the
  // table's own unique constraint on (api_key_id, action_type_pattern)
  // makes that the correct semantics); DELETE removes one by its exact
  // pattern. The blanket api_keys.on_uncertain column is completely
  // unaffected by any of this -- it keeps governing every action_type
  // with no matching override, exactly as before this item existed.
  const actionPoliciesMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/action-policies\/?$/);
  if (actionPoliciesMatch && (req.method === "GET" || req.method === "POST" || req.method === "DELETE")) {
    const keyId = actionPoliciesMatch[1];
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const accountId = req.method === "GET" ? url.searchParams.get("account_id") : (body?.account_id ?? null);
    const targetUserId = await resolveAccountScope(userClient, userId, accountId, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys").select("id").eq("id", keyId).eq("user_id", targetUserId).maybeSingle();
    if (keyErr) return json({ error: keyErr.message }, 500);
    if (!keyRow) return json({ error: "Key not found for this account." }, 404);

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("api_key_action_policies")
        .select("id, action_type_pattern, on_uncertain, confidence_threshold, created_at")
        .eq("api_key_id", keyId)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, overrides: data ?? [] });
    }

    const actionTypePattern = String(body?.action_type_pattern || "").trim();
    if (!actionTypePattern) return json({ error: "action_type_pattern is required" }, 400);

    if (req.method === "DELETE") {
      const { error } = await admin
        .from("api_key_action_policies")
        .delete()
        .eq("api_key_id", keyId)
        .eq("action_type_pattern", actionTypePattern);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, removed: true });
    }

    if (!isValidOnUncertainPolicy(body?.on_uncertain)) {
      return json({ error: "on_uncertain must be one of: human_review, auto_deny, auto_allow, auto_narrow, callback" }, 400);
    }
    // "Knowledge & autonomy" plan, item 9: a SEPARATE, optional override on
    // the same row -- lets an action vary its confidence threshold
    // (how certain the model must be before this action_type is treated
    // as "certain enough to not even ask") independently of its
    // on_uncertain policy. Omitted entirely keeps whatever was set before
    // untouched; explicit null clears it back to this key's plain
    // risk/strictness-based threshold.
    let confidenceThreshold: number | null | undefined;
    if (body?.confidence_threshold !== undefined) {
      if (body.confidence_threshold === null) {
        confidenceThreshold = null;
      } else {
        const t = Number(body.confidence_threshold);
        if (!Number.isInteger(t) || t < 0 || t > 100) {
          return json({ error: "confidence_threshold must be an integer between 0 and 100, or null to clear it" }, 400);
        }
        confidenceThreshold = t;
      }
    }
    const { data, error } = await admin
      .from("api_key_action_policies")
      .upsert(
        {
          user_id: targetUserId, api_key_id: keyId, action_type_pattern: actionTypePattern, on_uncertain: body.on_uncertain,
          ...(confidenceThreshold !== undefined ? { confidence_threshold: confidenceThreshold } : {}),
        },
        { onConflict: "api_key_id,action_type_pattern" },
      )
      .select("id, action_type_pattern, on_uncertain, confidence_threshold, created_at")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, override: data });
  }

  // ---- /api-keys/:id/context ---------------------------------------------
  // "White-labeled 'brain' endpoint" plan, item 2: where an integrating
  // company's own grounding facts live for its POST /control-api/v1/respond
  // calls -- scoped strictly per api_key_id (never account-wide like
  // knowledge_base_entries), so one company's context can never leak into
  // another key's answers. GET lists this key's entries; POST adds one;
  // DELETE removes one by id. Not exposed in any UI, matching the
  // established API-only convention for every prior per-key setting.
  const contextMatch = url.pathname.match(/\/api-keys\/([0-9a-fA-F-]{36})\/context\/?$/);
  if (contextMatch && (req.method === "GET" || req.method === "POST" || req.method === "DELETE")) {
    const keyId = contextMatch[1];
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const accountId = req.method === "GET" ? url.searchParams.get("account_id") : (body?.account_id ?? null);
    const targetUserId = await resolveAccountScope(userClient, userId, accountId, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys").select("id").eq("id", keyId).eq("user_id", targetUserId).maybeSingle();
    if (keyErr) return json({ error: keyErr.message }, 500);
    if (!keyRow) return json({ error: "Key not found for this account." }, 404);

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("api_key_context_entries")
        .select("id, entry_text, enabled, created_at")
        .eq("api_key_id", keyId)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, entries: data ?? [] });
    }

    if (req.method === "DELETE") {
      const entryId = String(body?.entry_id || "");
      if (!entryId) return json({ error: "entry_id is required" }, 400);
      const { error } = await admin
        .from("api_key_context_entries")
        .delete()
        .eq("api_key_id", keyId)
        .eq("id", entryId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, removed: true });
    }

    const entryText = String(body?.entry_text || "").trim();
    if (!entryText) return json({ error: "entry_text is required" }, 400);
    if (entryText.length > 2000) return json({ error: "entry_text must be at most 2000 characters" }, 400);
    const enabled = body?.enabled !== false;

    const { data, error } = await admin
      .from("api_key_context_entries")
      .insert({ user_id: targetUserId, api_key_id: keyId, entry_text: entryText, enabled })
      .select("id, entry_text, enabled, created_at")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    // "/respond" MVP backlog, item 163: embed the entry right away so
    // retrieval (_shared/response-context.ts's findRelevantContext) can
    // find it -- best-effort, budget-capped the same as every other
    // embedding call this key's own spend cap already governs. A failure
    // here (missing gateway key, over cap, network hiccup) never blocks
    // creating the entry itself; it just stays retrievable only via the
    // "no embedded entries yet" fallback until a later retry succeeds.
    if (data?.id) {
      try {
        const embedding = await generateEmbeddingWithinBudget(admin, targetUserId, keyId, entryText);
        if (embedding) {
          await admin.from("api_key_context_entries").update({ embedding: formatEmbeddingLiteral(embedding) }).eq("id", data.id);
        }
      } catch { /* embedding is a best-effort enrichment, never a required step */ }
    }
    return json({ ok: true, entry: data });
  }

  // ---- GET /api-keys --------------------------------------------------------
  if (req.method === "GET") {
    const targetUserId = await resolveAccountScope(userClient, userId, url.searchParams.get("account_id"), "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const { data, error } = await admin
      .from("api_keys")
      .select("id, name, key_prefix, scopes, on_uncertain, shadow_on_uncertain, on_gate_error, rate_limit_per_minute, last_used_at, revoked_at, expires_at, created_at, on_uncertain_downgraded_at, on_uncertain_downgrade_reason, is_test")
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
      return json({ error: "on_uncertain must be one of: human_review, auto_deny, auto_allow, auto_narrow, callback" }, 400);
    }

    const targetUserId = await resolveAccountScope(userClient, userId, body?.account_id, "integrations");
    if (!targetUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const rawKey = generateRawKey();
    const keyHash = await sha256Hex(rawKey);
    const displayPrefix = displayPrefixFor(rawKey);
    // "Knowledge & autonomy" plan, item 7: an account opts a key into
    // sandbox/test mode at creation time -- judged exactly like a real
    // key from here on (see sandbox-mode.ts's countsTowardRealUsage, and
    // every call site that checks it), never toggled after the fact, the
    // same way a real key's identity doesn't change mid-life either.
    const isTest = body?.is_test === true;

    const { data, error } = await admin
      .from("api_keys")
      .insert({
        user_id: targetUserId, name, key_prefix: displayPrefix, key_hash: keyHash,
        is_test: isTest,
        ...(body.on_uncertain ? { on_uncertain: body.on_uncertain } : {}),
      })
      .select("id, name, key_prefix, scopes, on_uncertain, created_at, is_test")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "Couldn't create the key" }, 500);

    return json({ ok: true, key: rawKey, ...data });
  }

  return json({ error: "Method not allowed" }, 405);
});
