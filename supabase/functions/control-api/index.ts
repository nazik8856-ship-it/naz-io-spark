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
// API-key traceability on the logged decision (item 8) and abuse alerting
// (item 9) land as their own follow-on commits on this same file.
//
// Two-tier rate limiting (item 7): a coarse pre-auth limit keyed by source
// IP blunts brute-forcing/probing invalid keys before each guess spends a
// hash + indexed DB lookup (via the new checkIpRateLimit -- there's no
// real userId yet at this point, so this can't reuse checkRateLimit's
// user_id-uuid-FK'd counter). Post-resolution, checkRateLimit's normal
// per-account counter applies before any LLM call, set meaningfully lower
// than control-engine's internal 120/min since this endpoint is now
// internet-reachable.
//
// "15 more items" plan, item 11: a batch mode -- pass `actions: [...]`
// instead of a single action_type/description/etc, get back
// `{ batch: true, results: [...] }` with one verdict per action, in
// order, using the exact same per-action gate/rate-limit/LLM logic as
// the single-action path (extracted into judgeOneAction below so both
// callers run identical code, not a parallel copy). Rate limiting is
// still enforced per action, one checkRateLimit call each, exactly as
// it always was for a single request -- a batch of 20 actions consumes
// 20 slots off the same per-account counter a caller making 20 separate
// requests would have consumed, no more and no less. Once the counter
// trips, the rest of the batch is reported as skipped rather than each
// one paying for its own DB round trip to learn the same thing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKeyAuth } from "../_shared/control-api-auth.ts";
import { runControlGate } from "../_shared/control-gate.ts";
import { checkIpRateLimit, checkRateLimit, resolveConfiguredRateLimit } from "../_shared/rate-limit.ts";
import { getApiKeySpendStatus } from "../_shared/spend-guard.ts";
import { checkApiVersion, CONTROL_API_VERSION } from "../_shared/api-versioning.ts";
import { parseControlApiAction, MAX_BATCH_ACTIONS, type ParsedControlApiAction } from "../_shared/control-api-action.ts";
import { decodeExportCursor, clampExportLimit, exportCursorFilter, buildExportPage, groupOutcomesByDecision, type ExportableOutcome } from "../_shared/decision-export.ts";
import { claimRowOnce, claimIdempotencyKey, saveIdempotencyResponse, releaseIdempotencyKey } from "../_shared/idempotency.ts";
import { classifyPlatformStatus, platformStatusMessage, DEGRADED_LOOKBACK_MINUTES } from "../_shared/platform-status.ts";
import { classifyDecisionVerification, type RawDecisionVerification } from "../_shared/decision-verification.ts";
import { excludeDecisionFromPrecedent, loadPrecedentForPrompt } from "../_shared/precedent-search.ts";
import { evaluateCoarsePrecedentLookup, summarizeCoarsePrecedentLookup, type CrossAccountStat } from "../_shared/cross-account-precedent.ts";
import { summarizeDecisionsForRoi, costPerAutonomousDecision, buildRoiTrend, estimateManualReviewHoursSaved, weekBucketKey, type DecisionForRoi, type DecisionForRoiTrend } from "../_shared/roi-report.ts";
import { buildEmbeddingInput, formatEmbeddingLiteral, generateEmbeddingWithinBudget } from "../_shared/decision-embeddings.ts";
import { countsTowardRealUsage, testModeVerdictNote } from "../_shared/sandbox-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Every response carries api_version, so a caller can tell which version of
// this API answered without having to remember which URL they hit — an
// individual call can still override it (none do today).
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ api_version: CONTROL_API_VERSION, ...b }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PRE_AUTH_RATE_LIMIT_PER_MINUTE = 60;
const POST_AUTH_RATE_LIMIT_PER_MINUTE = 30;
// A separate, smaller budget from the verdict endpoint's -- export polling
// is a very different traffic shape (a customer's own system pulling new
// pages on a schedule) from per-action verdict checks, and shouldn't
// compete with them for the same counter.
const EXPORT_RATE_LIMIT_PER_MINUTE = 20;
// "Real precedent memory" plan, item 13: its own separate, small budget --
// unlike a plain export page-read, each call here generates a real
// embedding (a real, metered cost -- item 11), so it shouldn't share a
// counter with either the export or verdict paths.
const PRECEDENT_LOOKUP_RATE_LIMIT_PER_MINUTE = 20;
// "Policy autonomy" plan, item 14: a report read, same lightweight
// budget as the plain export endpoint -- a handful of DB queries, no AI
// spend of its own.
const AUTOMATION_VALUE_RATE_LIMIT_PER_MINUTE = 20;
const DEFAULT_AUTOMATION_VALUE_WEEKS = 12;
const MAX_AUTOMATION_VALUE_WEEKS = 26;
// Same field set ControlDecisionHistory.tsx already exposes to a signed-in
// customer in-app, plus policy_version -- nothing here that isn't already
// something the account owner can see themselves. precedent_citations
// (item 9) is the one field with no in-app equivalent yet -- exposed here
// directly, per this round's own "verdict-only, no UX" scope: a real API
// field a caller's own tooling can read, without a UI built for it.
const DECISION_EXPORT_FIELDS =
  "id, decision, reasoning, confidence_score, escalated, source, agent_id, action_type, provider, policy_version, created_at, precedent_citations";

// "Zero human review" plan, item 13: a thin wrapper around the real
// per-action logic (renamed judgeOneActionInner below) that wires in the
// SAME idempotency primitives control-engine already built and proved
// for its own real-execution step (_shared/idempotency.ts) -- generalized
// here to the whole judged verdict, since control-api never executes
// anything itself: the "real side effect" a retry could duplicate is
// logging a second agent_decisions row and, in mode="full", spending AI
// budget a second time, not a provider write. A replay never even calls
// judgeOneActionInner, so it costs neither a rate-limit slot nor (in
// full mode) another AI-gateway call. A rate-limited or failed-assessment
// outcome is deliberately NOT cached -- releasing the claim instead --
// so a genuine retry with the same key can still go through once the
// transient condition clears, rather than being stuck replaying a
// failure forever.
async function judgeOneAction(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  keyId: string | null,
  isTest: boolean,
  action: ParsedControlApiAction,
  rateLimitPerMinute: number,
): Promise<Record<string, unknown>> {
  const { idempotencyKey } = action;
  if (!idempotencyKey) {
    return judgeOneActionInner(admin, supabaseUrl, serviceKey, userId, keyId, isTest, action, rateLimitPerMinute);
  }

  const claim = await claimIdempotencyKey(admin, userId, idempotencyKey);
  if (claim.status === "replay") return claim.response as Record<string, unknown>;
  if (claim.status === "in_progress") {
    return {
      error: "idempotency_key_in_progress",
      message: "A request with this idempotency key is already being judged (or didn't finish cleanly). Retry shortly, or use a new key for a genuinely new attempt.",
    };
  }

  try {
    const result = await judgeOneActionInner(admin, supabaseUrl, serviceKey, userId, keyId, isTest, action, rateLimitPerMinute);
    if (result.rateLimited || result.error === "assessment_failed") {
      await releaseIdempotencyKey(admin, userId, idempotencyKey);
    } else {
      await saveIdempotencyResponse(admin, userId, idempotencyKey, result);
    }
    return result;
  } catch (err) {
    await releaseIdempotencyKey(admin, userId, idempotencyKey);
    throw err;
  }
}

// Runs the exact same per-action logic for both a single request and one
// entry of a batch: consumes one post-auth rate-limit slot, then either the
// fast deterministic gate or the full LLM-scored assessment. Returns the
// verdict body (never throws -- an assessment failure comes back as an
// `error` field, matching how the pre-batch single-action path always
// reported it).
async function judgeOneActionInner(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  keyId: string | null,
  // "Knowledge & autonomy" plan, item 7: true only for a sandbox/test-mode
  // key -- judged through the exact same gate/prompt/verdict logic below,
  // but never counted toward real spend, precedent, calibration, or
  // automation-readiness (see sandbox-mode.ts).
  isTest: boolean,
  action: ParsedControlApiAction,
  // "Zero human review" plan, item 11: the caller resolves this ONCE per
  // request (a single DB read even for a whole batch of actions), not
  // once per action -- checkRateLimit itself already accepts an
  // arbitrary limit as a plain parameter, so the only change needed here
  // is what gets passed in.
  rateLimitPerMinute: number,
): Promise<Record<string, unknown>> {
  const rate = await checkRateLimit(admin, userId, "control-api", rateLimitPerMinute, 60);
  if (!rate.allowed) {
    return {
      error: "rate_limited",
      message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      rateLimited: true,
    };
  }

  const { actionType, provider, description, params, mode } = action;

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
      apiKeyId: keyId,
      isTest,
    });
    // "Knowledge & autonomy" plan, item 7: a sandbox key's verdict carries
    // one extra `test_mode`/`note` field so a caller can confirm, from the
    // response itself, that this ran in test mode -- never added for a
    // real key, so a real key's response shape is completely unchanged.
    const testModeFields = isTest ? { test_mode: true, note: testModeVerdictNote(isTest) } : {};
    // "Zero human review" plan, item 1: a "needs a second look" outcome
    // (non-blocking hard rule / safety match) resolved automatically by
    // this key's on_uncertain policy instead of creating a pending_approvals
    // row for a human. Checked before the plain ok/not-ok branches below
    // since an auto-resolved verdict can be either "allow" or "block" --
    // never left to fall through to their generic wording.
    if (gate.autoResolved) {
      return {
        verdict: gate.verdict === "block" ? "block" : "allow",
        reason: gate.reason,
        decision_id: gate.decisionId,
        gate_source: gate.source,
        mode: "fast",
        resolved_automatically: true,
        resolution_reason: gate.autoResolutionReason,
        ...testModeFields,
      };
    }
    if (!gate.ok) {
      return {
        verdict: gate.verdict === "block" ? "block" : "modify",
        reason: gate.reason,
        decision_id: gate.decisionId,
        gate_source: gate.source,
        mode: "fast",
        resolved_automatically: false,
        ...testModeFields,
      };
    }
    return {
      verdict: "allow",
      reason: "No hard rule, safety match, spend cap, or circuit breaker stopped this action.",
      decision_id: null,
      gate_source: null,
      mode: "fast",
      resolved_automatically: false,
      ...testModeFields,
    };
  }

  // ---- mode="full": the full LLM-scored intent/risk/fit assessment --------
  // "Zero human review" plan, item 12: checked BEFORE ever forwarding to
  // control-engine -- and therefore before any real AI-gateway cost is
  // incurred -- so a key with its own configured cap that's already used
  // up for today is blocked outright here, not after paying for an
  // assessment whose own cost would just push it further over. A key
  // with no cap of its own (has_cap: false) is completely unaffected --
  // only the account-wide cap (enforced inside control-engine itself,
  // unchanged) ever applies to it.
  // "Knowledge & autonomy" plan, item 7: a sandbox key never accrues real
  // spend (recordAiSpend is skipped for it in control-engine below), so
  // its own cap can never legitimately trip -- skip the check outright
  // rather than reading a real number that will always read zero anyway.
  if (keyId && countsTowardRealUsage(isTest)) {
    const keySpend = await getApiKeySpendStatus(admin, userId, keyId);
    if (keySpend.has_cap && keySpend.over_cap) {
      const reason =
        `Blocked — this API key's own daily AI spend cap is used up ($${keySpend.spent_usd.toFixed(2)} of ` +
        `$${keySpend.cap_usd.toFixed(2)} across ${keySpend.calls} calls today). This is separate from the ` +
        `account-wide cap and resumes tomorrow (UTC), or when an owner raises it.`;
      let decisionId: string | null = null;
      try {
        const { data: logged } = await admin.from("agent_decisions").insert({
          user_id: userId,
          decision: `BLOCK ${actionType} (${provider})`.slice(0, 400),
          reasoning: reason,
          alternatives_considered: [],
          confidence_score: 100,
          // Reuses the existing "ai_spend_cap" source -- this is the
          // exact same kind of block as the account-wide/per-agent one,
          // just at a third granularity, not a new outcome needing its
          // own value.
          source: "ai_spend_cap",
          escalated: false,
          action_type: actionType,
          provider,
          api_key_id: keyId,
          is_test: isTest,
        }).select("id").maybeSingle();
        decisionId = (logged as { id?: string } | null)?.id ?? null;
      } catch { /* logging must never break the cap enforcement itself */ }
      return {
        verdict: "block",
        reason,
        decision_id: decisionId,
        confidence_score: null,
        modification: null,
        policy_version: null,
        mode: "full",
        resolved_automatically: false,
        resolution_reason: null,
      };
    }
  }

  // "Knowledge & autonomy" plan, item 7: same test_mode/note field the
  // fast-mode path above adds -- computed once here so both the forward
  // call below and its response can share it.
  const testModeFields = isTest ? { test_mode: true, note: testModeVerdictNote(isTest) } : {};

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
      "x-api-key-id": keyId ?? "",
      "x-is-test": isTest ? "1" : "",
    },
    body: JSON.stringify({ action_type: actionType, provider, description, params, assess_only: true }),
  });
  const data = await resp.json().catch(() => ({} as Record<string, unknown>));
  if (!resp.ok) {
    return { error: "assessment_failed", message: String(data?.error || data?.message || `HTTP ${resp.status}`) };
  }

  return {
    verdict: data?.decision ?? "block",
    reason: data?.reasoning ?? data?.reason ?? null,
    decision_id: data?.decision_id ?? null,
    confidence_score: data?.confidence_score ?? null,
    modification: data?.modification ?? null,
    policy_version: data?.policy_version ?? null,
    mode: "full",
    // "Zero human review" plan, item 2: control-engine now resolves a
    // "modify"/"block"/escalated model verdict automatically per this
    // key's on_uncertain policy, same as item 1 does for the deterministic
    // layer -- relayed here so a caller never has to guess whether a human
    // review was actually queued.
    resolved_automatically: data?.resolved_automatically === true,
    resolution_reason: data?.resolution_reason ?? null,
    ...testModeFields,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // A bare /control-api URL is an alias for CONTROL_API_VERSION (today's
  // only version); an explicit .../v1 segment is the canonical documented
  // form. A request naming any OTHER version is rejected outright rather
  // than silently served by this version's current behavior -- so a real
  // future v2 has room to actually change shape.
  const versionCheck = checkApiVersion(url.pathname);
  if (!versionCheck.ok) {
    return json({
      error: "unsupported_version",
      message: `This Control API only supports ${CONTROL_API_VERSION} today. Requested: ${versionCheck.requested}.`,
    }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // ---- Pre-auth rate limit, keyed by source IP -----------------------------
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  const ipRate = await checkIpRateLimit(admin, ip, "control-api-preauth", PRE_AUTH_RATE_LIMIT_PER_MINUTE, 60);
  if (!ipRate.allowed) {
    return json({ error: "rate_limited", message: "Too many requests from this address. Try again shortly." }, 429);
  }

  // ---- Auth: Authorization: Bearer nazai_sk_... ----------------------------
  const auth = await resolveApiKeyAuth(admin, req.headers.get("Authorization"));
  if (!auth.ok) return json(auth.body, auth.status);
  const userId = auth.userId;

  // ---- GET /control-api/v1/status -------------------------------------
  // "Zero human review" plan, item 9: the only way an external caller
  // previously found out NazAI was paused or degraded was getting an
  // unexpected block back -- no way to check ahead of time. Deliberately
  // nothing account-specific here (an account's own kill switch, spend
  // cap, or a single misconfigured rule are normal, expected reasons for
  // a block, unrelated to NazAI's own health) -- see
  // _shared/platform-status.ts for the full reasoning. Authenticated the
  // same way as every other route on this API rather than left
  // unauthenticated, for consistency with the rest of this surface.
  if (req.method === "GET" && /\/status\/?$/.test(url.pathname)) {
    const { data: platformRow } = await admin.from("platform_settings").select("kill_switch").eq("id", 1).maybeSingle();
    const killSwitch = (platformRow as { kill_switch?: boolean } | null)?.kill_switch === true;

    const since = new Date(Date.now() - DEGRADED_LOOKBACK_MINUTES * 60 * 1000).toISOString();
    const { data: recentDecisions } = await admin
      .from("agent_decisions")
      .select("source")
      .gte("created_at", since);
    const rows = (recentDecisions ?? []) as { source: string | null }[];
    const total = rows.length;
    const gateErrors = rows.filter((r) => r.source === "gate_error" || r.source === "gate_error_fail_open").length;

    const status = classifyPlatformStatus(killSwitch, total, gateErrors);
    return json({ ok: true, status, message: platformStatusMessage(status) });
  }

  // ---- GET /control-api/v1/decisions ---------------------------------------
  // "15 more items" plan, item 15: a paginated decision-export endpoint, so
  // a customer's own reporting/monitoring tools can automatically pull new
  // decisions on their own schedule instead of a person manually
  // re-downloading ControlAccountData.tsx's one-shot export. Keyset
  // pagination (created_at, id) via an opaque cursor -- see
  // _shared/decision-export.ts -- rather than an OFFSET, so a page can't
  // skip or duplicate rows when new decisions land between polls.
  if (req.method === "GET" && /\/decisions\/?$/.test(url.pathname)) {
    const rate = await checkRateLimit(admin, userId, "control-api-export", EXPORT_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const limit = clampExportLimit(url.searchParams.get("limit"));
    const cursor = decodeExportCursor(url.searchParams.get("cursor"));
    const since = url.searchParams.get("since");

    let query = admin.from("agent_decisions").select(DECISION_EXPORT_FIELDS).eq("user_id", userId);
    if (cursor) query = query.or(exportCursorFilter(cursor));
    else if (since) query = query.gte("created_at", since);
    query = query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const { page, hasMore, nextCursor } = buildExportPage((data ?? []) as { id: string; created_at: string }[], limit);
    return json({ decisions: page, has_more: hasMore, next_cursor: nextCursor });
  }

  // ---- GET /control-api/v1/decisions/export-outcomes -----------------------
  // "Policy autonomy" plan, item 12: the plain decision export above hands
  // back verdicts (plus precedent_citations). This ALSO joins in the real
  // measured OUTCOMES (decision_outcomes) behind those verdicts, as one
  // structured dataset a caller's own team can analyze or train on --
  // not just NazAI's. Confirmed: decision_outcomes carries no internal
  // reviewer identity and no cross-account data -- org_insight_id and
  // agent_id are internal NazAI concepts with no meaning to an external
  // caller, deliberately excluded here. Same keyset cursor/limit
  // pagination as the plain export above, same rate-limit bucket (this
  // is a heavier query per page, not a separate allowance to exploit).
  if (req.method === "GET" && /\/decisions\/export-outcomes\/?$/.test(url.pathname)) {
    const rate = await checkRateLimit(admin, userId, "control-api-export", EXPORT_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const limit = clampExportLimit(url.searchParams.get("limit"));
    const cursor = decodeExportCursor(url.searchParams.get("cursor"));
    const since = url.searchParams.get("since");

    let query = admin.from("agent_decisions").select(DECISION_EXPORT_FIELDS).eq("user_id", userId);
    if (cursor) query = query.or(exportCursorFilter(cursor));
    else if (since) query = query.gte("created_at", since);
    query = query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const { page, hasMore, nextCursor } = buildExportPage((data ?? []) as { id: string; created_at: string }[], limit);

    const decisionIds = page.map((d) => (d as { id: string }).id);
    let outcomesByDecision = new Map<string, ExportableOutcome[]>();
    if (decisionIds.length) {
      const { data: outcomeRows, error: outcomeErr } = await admin
        .from("decision_outcomes")
        .select("decision_id, linked_metric, baseline_value, result_value, delta, delta_pct, direction, window_days, measured_at")
        .in("decision_id", decisionIds);
      if (outcomeErr) return json({ error: outcomeErr.message }, 500);
      outcomesByDecision = groupOutcomesByDecision((outcomeRows ?? []) as (ExportableOutcome & { decision_id: string })[]);
    }
    const decisions = page.map((d) => ({ ...d, outcomes: outcomesByDecision.get((d as { id: string }).id) ?? [] }));

    return json({ decisions, has_more: hasMore, next_cursor: nextCursor });
  }

  // ---- POST /control-api/v1/decisions/:id/resolve --------------------------
  // "Zero human review" plan, item 4: the other half of the "callback"
  // on_uncertain policy -- once NazAI notifies this key's callback_url that
  // a decision needs an answer, the calling company's own system posts its
  // answer here. Looked up by decision_id (the only id a caller actually
  // has -- pending_approvals.id was never surfaced in any response) and
  // scoped to this key's own account, so a caller can never resolve
  // another account's approval. Claimed atomically (the same primitive
  // callback-delegation.ts's own timeout fallback uses) so a resolve
  // arriving in the same instant as the timeout can't double-resolve it.
  const resolveMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/resolve\/?$/);
  if (req.method === "POST" && resolveMatch) {
    const decisionId = resolveMatch[1];
    const body = await req.json().catch(() => ({}));
    const resolution = body?.resolution === "approved" ? "approved" : body?.resolution === "rejected" ? "rejected" : null;
    if (!resolution) return json({ error: "resolution must be 'approved' or 'rejected'" }, 400);

    const { data: approval } = await admin.from("pending_approvals")
      .select("id, status")
      .eq("decision_id", decisionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!approval) return json({ error: "not_found", message: "No pending approval found for that decision on this account." }, 404);

    const won = await claimRowOnce(admin, "pending_approvals", (approval as { id: string }).id, "resolved_at");
    if (!won) return json({ ok: true, already_resolved: true });

    await admin.from("pending_approvals").update({
      status: resolution,
      comment: "Resolved via the Control API's /resolve endpoint by the calling system, per this key's 'callback' policy.",
    }).eq("id", (approval as { id: string }).id);
    return json({ ok: true, resolved: resolution });
  }

  // ---- GET /control-api/v1/decisions/:id/verify ------------------------
  // "Zero human review" plan, item 10: every decision is already secretly
  // signed internally, but that check was only ever reachable by a
  // signed-in NazAI user -- a company building its own compliance trail
  // around a fully-automated integration shouldn't have to just take
  // NazAI's word for it. Ownership is checked HERE, not left to the RPC's
  // own check -- verify_decision_signature() only raises when called as a
  // real authenticated user whose uid differs from the row's; called via
  // this admin (service-role) client, that check is always skipped, so
  // without this explicit lookup a caller could verify ANY account's
  // decision by id. Never distinguishes "doesn't exist" from "exists but
  // isn't yours" -- same not_found shape either way, matching /resolve's
  // own pattern just above.
  const verifyMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/verify\/?$/);
  if (req.method === "GET" && verifyMatch) {
    const decisionId = verifyMatch[1];
    const { data: owned } = await admin.from("agent_decisions").select("id").eq("id", decisionId).eq("user_id", userId).maybeSingle();
    if (!owned) return json({ error: "not_found", message: "No decision with that id exists for this account." }, 404);

    const { data: raw, error } = await admin.rpc("verify_decision_signature", { _id: decisionId });
    if (error) return json({ error: "verification_failed", message: error.message }, 500);
    const result = classifyDecisionVerification((raw ?? {}) as RawDecisionVerification);
    return json({ ok: true, decision_id: decisionId, ...result });
  }

  // ---- POST /control-api/v1/decisions/:id/exclude-precedent ---------------
  // "Real precedent memory" plan, item 7: sometimes a past decision was
  // simply a mistake -- later reversed, or based on bad information -- and
  // without a way to say so it would keep quietly influencing future
  // automatic decisions forever just because it superficially resembles new
  // requests. Permanent and one-way -- there's no "un-exclude," matching
  // this feature's own purpose (a real correction, not a togglable filter).
  // Ownership checked the same way /resolve and /verify already do, before
  // ever touching decision_embeddings.
  const excludeMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/exclude-precedent\/?$/);
  if (req.method === "POST" && excludeMatch) {
    const decisionId = excludeMatch[1];
    const { data: owned } = await admin.from("agent_decisions").select("id").eq("id", decisionId).eq("user_id", userId).maybeSingle();
    if (!owned) return json({ error: "not_found", message: "No decision with that id exists for this account." }, 404);

    const outcome = await excludeDecisionFromPrecedent(admin, userId, decisionId);
    return json({
      ok: true,
      excluded: outcome === "excluded",
      message: outcome === "excluded"
        ? "This decision will never be used as precedent for future automatic decisions again."
        : "This decision has no real-precedent record (nothing was ever embedded for it) — nothing to exclude.",
    });
  }

  // ---- POST /control-api/v1/precedent --------------------------------------
  // "Real precedent memory" plan, item 13: let an external company ask,
  // through the Control API itself, what its own decision history looks
  // like for a kind of action -- supporting its own debugging/compliance
  // work, without any UI built for it. Same request shape as the main
  // verdict endpoint below (action_type/provider/description/params),
  // reusing parseControlApiAction rather than a second parallel
  // validator -- but this never judges anything: no rule/model/execution
  // path runs at all, purely a read against this key's own embedded
  // history, the same account boundary findPrecedent enforces everywhere
  // else. A real cost, not a free lookup -- embedding generation goes
  // through the same budget-aware path (item 11) real judgment calls do.
  if (req.method === "POST" && /\/precedent\/?$/.test(url.pathname)) {
    if (!auth.keyId) return json({ error: "not_found" }, 404);

    const rate = await checkRateLimit(admin, userId, "control-api-precedent", PRECEDENT_LOOKUP_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const parsed = parseControlApiAction(body);
    if ("error" in parsed) return json({ error: parsed.error }, 400);

    // Checked explicitly (rather than just letting generateEmbeddingWithinBudget
    // silently return null) so a caller asking specifically FOR precedent gets
    // an honest reason for an empty result, unlike every other call site where
    // precedent is a silent background enrichment.
    const spend = await getApiKeySpendStatus(admin, userId, auth.keyId);
    if (spend.has_cap && spend.over_cap) {
      return json({
        error: "spend_cap_reached",
        message: `This API key's own daily AI spend cap is used up ($${spend.spent_usd.toFixed(2)} of ` +
          `$${spend.cap_usd.toFixed(2)}). Precedent search needs a fresh embedding, which shares this same ` +
          `budget with judgment calls. Resumes tomorrow (UTC), or when an owner raises the cap.`,
      }, 429);
    }

    const embedding = await generateEmbeddingWithinBudget(
      admin, userId, auth.keyId,
      buildEmbeddingInput({ actionType: parsed.actionType, provider: parsed.provider, description: parsed.description, params: parsed.params }),
    );
    if (!embedding) {
      return json({
        ok: true, count: 0, matches: [], degraded: true,
        message: "Could not compute an embedding for this action right now — precedent search is temporarily unavailable, try again shortly.",
      });
    }

    const matches = await loadPrecedentForPrompt(admin, auth.keyId, formatEmbeddingLiteral(embedding));
    return json({
      ok: true,
      count: matches.length,
      matches: matches.map((m) => ({
        decision_id: m.decisionId,
        action_type: m.actionType,
        provider: m.provider,
        similarity: m.similarity,
        created_at: m.createdAt,
        decision: m.decision,
        reasoning: m.reasoning,
      })),
    });
  }

  // ---- GET /control-api/v1/precedent/cross-account -------------------------
  // "Policy autonomy" plan, item 13: opt-in, coarse anonymized precedent
  // sharing. A brand-new key with zero real history of its own can still
  // ask "of similar actions across opted-in accounts, what share weren't
  // clean allows" -- a real, coarse signal instead of a cold start with
  // nothing. Deliberately a cheap, exact-shape lookup (no embedding, no
  // AI spend) against the pre-aggregated cross_account_precedent_stats
  // table (cross-account-precedent-sweep) -- never blended into or
  // confused with this account's OWN real precedent (POST /precedent
  // above): a distinct, coarser signal, always presented as such.
  if (req.method === "GET" && /\/precedent\/cross-account\/?$/.test(url.pathname)) {
    const rate = await checkRateLimit(admin, userId, "control-api-precedent", PRECEDENT_LOOKUP_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const actionType = url.searchParams.get("action_type");
    if (!actionType) return json({ error: "action_type query parameter is required" }, 400);
    const providerParam = url.searchParams.get("provider");
    const provider = providerParam || null;

    const { data, error } = await admin
      .from("cross_account_precedent_stats")
      .select("total_count, non_allow_count, contributing_account_count")
      .eq("action_type", actionType)
      .eq("provider", provider ?? "")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);

    const stat: CrossAccountStat | null = data
      ? { action_type: actionType, provider, ...(data as { total_count: number; non_allow_count: number; contributing_account_count: number }) }
      : null;
    const lookup = evaluateCoarsePrecedentLookup(stat);
    return json({
      ok: true,
      action_type: actionType,
      provider,
      lookup,
      message: summarizeCoarsePrecedentLookup(lookup, actionType, provider),
    });
  }

  // ---- GET /control-api/v1/automation-value --------------------------------
  // "Policy autonomy" plan, item 14: a real number, through the Control
  // API itself, for how much of this key's traffic ran with zero human
  // involved, how that's trended week over week, and a rough estimate of
  // the manual-review effort it saved -- the actual business case for
  // automating more, backed by this key's own real numbers. Composes
  // roi-report.ts's existing summarizeDecisionsForRoi/
  // costPerAutonomousDecision (already proven in the monthly report
  // email) plus this item's own weekly-trend bucketing, scoped to THIS
  // api key specifically rather than the whole account.
  if (req.method === "GET" && /\/automation-value\/?$/.test(url.pathname)) {
    if (!auth.keyId) return json({ error: "not_found" }, 404);

    const rate = await checkRateLimit(admin, userId, "control-api-automation-value", AUTOMATION_VALUE_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const weeksParam = Number(url.searchParams.get("weeks"));
    const weeks = Number.isFinite(weeksParam) && weeksParam > 0
      ? Math.min(MAX_AUTOMATION_VALUE_WEEKS, Math.floor(weeksParam))
      : DEFAULT_AUTOMATION_VALUE_WEEKS;
    const since = new Date(Date.now() - weeks * 7 * 86400_000);
    const sinceIso = since.toISOString();

    const [decisionsRes, spendRes] = await Promise.all([
      admin.from("agent_decisions").select("decision, escalated, created_at").eq("api_key_id", auth.keyId).gte("created_at", sinceIso),
      admin.from("ai_spend_daily").select("day, cost_usd").eq("api_key_id", auth.keyId).gte("day", sinceIso.slice(0, 10)),
    ]);
    if (decisionsRes.error) return json({ error: decisionsRes.error.message }, 500);
    if (spendRes.error) return json({ error: spendRes.error.message }, 500);

    const decisions = (decisionsRes.data ?? []) as { decision: string; escalated: boolean; created_at: string }[];
    const trendDecisions: DecisionForRoiTrend[] = decisions.map((d) => ({ decision: d.decision, escalated: d.escalated, createdAt: d.created_at }));

    const spendByWeek = new Map<string, number>();
    for (const s of (spendRes.data ?? []) as { day: string; cost_usd: number }[]) {
      const key = weekBucketKey(s.day);
      spendByWeek.set(key, (spendByWeek.get(key) ?? 0) + (Number(s.cost_usd) || 0));
    }

    const totalCounts = summarizeDecisionsForRoi(decisions as DecisionForRoi[]);
    const totalSpendUsd = Math.round([...spendByWeek.values()].reduce((sum, v) => sum + v, 0) * 100) / 100;

    return json({
      ok: true,
      window_weeks: weeks,
      since: sinceIso,
      summary: {
        total: totalCounts.total,
        autonomous: totalCounts.autonomous,
        needs_human: totalCounts.needsHuman,
        blocked: totalCounts.blocked,
        modified: totalCounts.modified,
        allowed: totalCounts.allowed,
        autonomous_share: totalCounts.total > 0 ? Math.round((totalCounts.autonomous / totalCounts.total) * 100) / 100 : null,
        spend_usd: totalSpendUsd,
        cost_per_autonomous_decision_usd: costPerAutonomousDecision(totalSpendUsd, totalCounts.autonomous),
        estimated_manual_review_hours_saved: estimateManualReviewHoursSaved(totalCounts.autonomous),
      },
      weekly_trend: buildRoiTrend(trendDecisions, spendByWeek).map((p) => ({
        week_start: p.weekStart,
        total: p.counts.total,
        autonomous: p.counts.autonomous,
        needs_human: p.counts.needsHuman,
        spend_usd: p.spendUsd,
        cost_per_autonomous_decision_usd: p.costPerDecision,
      })),
    });
  }

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // "Zero human review" plan, item 11: read once per request (not once
  // per action -- judgeOneAction is called once per batch entry below),
  // and only for the routes that actually reach the rate-limited verdict
  // path -- every route above this line returns early without ever
  // needing it.
  let rateLimitPerMinute = POST_AUTH_RATE_LIMIT_PER_MINUTE;
  if (auth.keyId) {
    const { data: keyRow } = await admin.from("api_keys").select("rate_limit_per_minute").eq("id", auth.keyId).maybeSingle();
    rateLimitPerMinute = resolveConfiguredRateLimit(
      (keyRow as { rate_limit_per_minute?: number | null } | null)?.rate_limit_per_minute,
      POST_AUTH_RATE_LIMIT_PER_MINUTE,
    );
  }

  const body = await req.json().catch(() => ({}));

  // ---- Batch mode: `{ actions: [...] }` instead of one action -------------
  if (Array.isArray(body?.actions)) {
    const rawActions = body.actions as unknown[];
    if (rawActions.length === 0) return json({ error: "actions must be a non-empty array" }, 400);
    if (rawActions.length > MAX_BATCH_ACTIONS) {
      return json({
        error: "batch_too_large",
        message: `A single batch request supports at most ${MAX_BATCH_ACTIONS} actions — got ${rawActions.length}. Split into multiple requests.`,
      }, 400);
    }

    const results: Record<string, unknown>[] = [];
    let stopped = false;
    for (let i = 0; i < rawActions.length; i++) {
      if (stopped) {
        results.push({ index: i, error: "rate_limited", message: "Skipped — the batch stopped after an earlier action hit the rate limit." });
        continue;
      }
      const parsed = parseControlApiAction(rawActions[i]);
      if ("error" in parsed) {
        results.push({ index: i, error: parsed.error });
        continue;
      }
      const verdict = await judgeOneAction(admin, supabaseUrl, serviceKey, userId, auth.keyId, auth.isTest, parsed, rateLimitPerMinute);
      if (verdict.rateLimited) stopped = true;
      const { rateLimited: _drop, ...rest } = verdict;
      results.push({ index: i, ...rest });
    }
    return json({ batch: true, count: results.length, results });
  }

  // ---- Single-action mode (default) ----------------------------------------
  const parsed = parseControlApiAction(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const verdict = await judgeOneAction(admin, supabaseUrl, serviceKey, userId, auth.keyId, auth.isTest, parsed, rateLimitPerMinute);
  if (verdict.rateLimited) {
    const { rateLimited: _drop, ...rest } = verdict;
    return json(rest, 429);
  }
  if (verdict.error === "assessment_failed") return json(verdict, 502);
  return json(verdict);
});
