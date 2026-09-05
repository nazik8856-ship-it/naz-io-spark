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
import { summarizeAttestationCounts, distinctPolicyVersions, buildAttestationCanonicalPayload } from "../_shared/compliance-attestation.ts";
import { buildDecisionExplanation } from "../_shared/decision-explanation.ts";
import { hasOpenReview, buildDisputeReasonText } from "../_shared/decision-dispute.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";
import { parseRespondRequest, buildContextPromptBlock, findRelevantContext, summarizeSourcesUsed, type ResponseContextEntry } from "../_shared/response-context.ts";
import { buildSystemPrompt, generateGroundedAnswer, checkGrounding } from "../_shared/response-generation.ts";
import { sanitizeResponse } from "../_shared/response-sanitizer.ts";
import { detectContextLeak, LEAK_FALLBACK_ANSWER } from "../_shared/response-injection-guard.ts";

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

// "/respond" MVP backlog, item 165: SSE streaming. Streams the FINAL,
// already safety-checked answer (generation -> grounding check -> leak
// guard -> sanitizer all run to completion first, unchanged) in chunks
// for a typing-effect UI -- this deliberately does NOT stream raw
// token-by-token model output, since the grounding/leak checks need the
// complete drafted answer to verify before anything is safe to send.
// Total latency is the same as (or marginally worse than) the plain JSON
// response; the only benefit is presentational.
const SSE_CHUNK_CHARS = 12;
const SSE_CHUNK_DELAY_MS = 20;

function streamAnswer(text: string, meta: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < text.length; i += SSE_CHUNK_CHARS) {
        send(controller, { delta: text.slice(i, i + SSE_CHUNK_CHARS) });
        if (i + SSE_CHUNK_CHARS < text.length) await sleep(SSE_CHUNK_DELAY_MS);
      }
      send(controller, { api_version: CONTROL_API_VERSION, done: true, ...meta });
      controller.close();
    },
  });
  return new Response(body, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

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
// "Knowledge & autonomy" plan, item 11: a heavier, occasional read (a
// company generating a real attestation document, not polling) --
// deliberately its own small budget rather than sharing the plain
// export's, so a routine export poll can never starve out the ability to
// generate an attestation.
const COMPLIANCE_ATTESTATION_RATE_LIMIT_PER_MINUTE = 10;
const DEFAULT_ATTESTATION_PERIOD_DAYS = 90;
const MAX_ATTESTATION_PERIOD_DAYS = 366;
// "Knowledge & autonomy" plan, item 13: a single-row read, same lightweight
// budget as the plain export endpoint -- a support agent looking up one
// decision at a time, not a bulk operation.
const DECISION_EXPLAIN_RATE_LIMIT_PER_MINUTE = 30;
// "Knowledge & autonomy" plan, item 14: a real write (creates a genuine
// pending_approvals row) but a rare, deliberate one -- a company's own
// support team disputing a specific decision, not routine traffic. Kept
// low and separate from the verdict endpoint's own budget.
const DECISION_DISPUTE_RATE_LIMIT_PER_MINUTE = 10;
// "White-labeled 'brain' endpoint" plan, item 1: sized like /precedent's
// own budget, not the read-only report endpoints' higher limits -- this
// does two real LLM calls per request (generation + a grounding-check
// second pass), never a cheap read.
const RESPOND_RATE_LIMIT_PER_MINUTE = 20;

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

  const { actionType, provider, description, params, mode, planId } = action;

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
      planId,
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
          plan_id: planId,
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
    body: JSON.stringify({ action_type: actionType, provider, description, params, assess_only: true, plan_id: planId }),
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

  // ---- GET /control-api/v1/compliance-attestation --------------------------
  // "Knowledge & autonomy" plan, item 11: a real, SIGNED summary an
  // external company can hand to its own customers or auditors as proof
  // its automated decisions ran under real governance for a given period --
  // account-wide (every key this account has, not one key's own traffic),
  // matching how the monthly ROI email itself is account-wide. Composes
  // roi-report.ts's existing counts/cost-per-decision math with this
  // account's own real policy-version history and decision-signature
  // coverage -- no new metric computation, the one new piece is signing
  // the resulting summary itself (sign_compliance_attestation, reusing the
  // exact same secret/algorithm every individual decision is already
  // signed with).
  if (req.method === "GET" && /\/compliance-attestation\/?$/.test(url.pathname)) {
    const rate = await checkRateLimit(admin, userId, "control-api-attestation", COMPLIANCE_ATTESTATION_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const daysParam = Number(url.searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(MAX_ATTESTATION_PERIOD_DAYS, Math.floor(daysParam))
      : DEFAULT_ATTESTATION_PERIOD_DAYS;
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 86400_000);
    const periodStartIso = periodStart.toISOString();
    const periodEndIso = periodEnd.toISOString();

    const [decisionsRes, spendRes] = await Promise.all([
      admin.from("agent_decisions").select("decision, escalated, signature, policy_version")
        .eq("user_id", userId).gte("created_at", periodStartIso).limit(50000),
      admin.from("ai_spend_daily").select("cost_usd").eq("user_id", userId).gte("day", periodStartIso.slice(0, 10)),
    ]);
    if (decisionsRes.error) return json({ error: decisionsRes.error.message }, 500);
    if (spendRes.error) return json({ error: spendRes.error.message }, 500);

    type Row = { decision: string; escalated: boolean; signature: string | null; policy_version: number | null };
    const rows = (decisionsRes.data ?? []) as Row[];
    const counts = summarizeAttestationCounts(rows);
    const policyVersions = distinctPolicyVersions(rows);
    const spendUsd = Math.round(((spendRes.data ?? []) as { cost_usd: number }[])
      .reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0) * 100) / 100;
    const costPerAutonomousDecisionUsd = costPerAutonomousDecision(spendUsd, counts.autonomous);
    const estimatedManualReviewHoursSaved = estimateManualReviewHoursSaved(counts.autonomous);

    const fields = {
      userId, periodStart: periodStartIso, periodEnd: periodEndIso,
      counts, policyVersions, spendUsd, costPerAutonomousDecisionUsd, estimatedManualReviewHoursSaved,
    };
    const generatedAt = new Date().toISOString();
    const canonicalPayload = buildAttestationCanonicalPayload(fields, generatedAt);
    const { data: signature, error: signErr } = await admin.rpc("sign_compliance_attestation", { _payload: canonicalPayload });
    if (signErr) return json({ error: "signing_failed", message: signErr.message }, 500);

    return json({
      ok: true,
      period_start: periodStartIso,
      period_end: periodEndIso,
      generated_at: generatedAt,
      decisions: {
        total: counts.total,
        autonomous: counts.autonomous,
        escalated: counts.escalated,
        signed: counts.signed,
      },
      policy_versions: policyVersions,
      spend_usd: spendUsd,
      cost_per_autonomous_decision_usd: costPerAutonomousDecisionUsd,
      estimated_manual_review_hours_saved: estimatedManualReviewHoursSaved,
      canonical_payload: canonicalPayload,
      signature,
      note: "Signed with NazAI's own server-side signing key (the same one used for every individual decision's signature) over canonical_payload -- the exact pipe-joined string derived from every field above, in the fixed order this response documents. Altering any field after export changes what canonical_payload should be, so it would no longer match this signature.",
    });
  }

  // ---- GET /control-api/v1/decisions/:id/explain ---------------------------
  // "Knowledge & autonomy" plan, item 13: composes ONE real, readable
  // plain-English narrative for a single decision out of pieces that
  // already exist scattered across several columns (gate_trace,
  // precedent_citations, confidence/reasoning) -- read-only, no new
  // signal. Valuable for an external company's own support team handling
  // a question from their end customer without ever looping in a NazAI
  // human.
  const explainMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/explain\/?$/);
  if (req.method === "GET" && explainMatch) {
    const decisionId = explainMatch[1];
    const rate = await checkRateLimit(admin, userId, "control-api-explain", DECISION_EXPLAIN_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const { data: row, error } = await admin
      .from("agent_decisions")
      .select("decision, reasoning, confidence_score, source, escalated, human_response, action_type, provider, created_at, gate_trace, precedent_citations")
      .eq("id", decisionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: "not_found", message: "No decision with this id exists for your account." }, 404);

    type Row = {
      decision: string; reasoning: string | null; confidence_score: number | null; source: string | null;
      escalated: boolean; human_response: string | null; action_type: string | null; provider: string | null;
      created_at: string; gate_trace: unknown; precedent_citations: unknown;
    };
    const d = row as Row;
    const explanation = buildDecisionExplanation({
      decisionText: d.decision,
      reasoning: d.reasoning,
      confidenceScore: d.confidence_score,
      source: d.source,
      escalated: d.escalated,
      humanResponse: d.human_response,
      actionType: d.action_type,
      provider: d.provider,
      createdAt: d.created_at,
      gateTrace: (d.gate_trace as Parameters<typeof buildDecisionExplanation>[0]["gateTrace"]) ?? null,
      precedentCitations: (d.precedent_citations as Parameters<typeof buildDecisionExplanation>[0]["precedentCitations"]) ?? null,
    });

    return json({
      ok: true,
      decision_id: decisionId,
      explanation,
    });
  }

  // ---- POST /control-api/v1/decisions/:id/dispute ---------------------------
  // "Knowledge & autonomy" plan, item 14: let an external company request
  // a genuine fresh human look at a decision NazAI already resolved --
  // e.g. its own end customer disputes an auto-resolved block. Reuses
  // pending_approvals' own existing queue/notification machinery (same
  // table, same approval_created webhook, same structured-reason capture
  // item 2 already gives record_approval_signoff) -- just a new way to
  // create a row scoped to a decision that already has a real verdict.
  // Always creates a genuine PENDING row (never auto-resolved by this
  // key's on_uncertain policy) -- the entire point is a human looks again,
  // so silently auto-resolving it a second time would defeat the request.
  const disputeMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/dispute\/?$/);
  if (req.method === "POST" && disputeMatch) {
    const decisionId = disputeMatch[1];
    const rate = await checkRateLimit(admin, userId, "control-api-dispute", DECISION_DISPUTE_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const { data: row, error } = await admin
      .from("agent_decisions")
      .select("id, decision, agent_id, agent_run_id, action_type, provider, plan_id")
      .eq("id", decisionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: "not_found", message: "No decision with this id exists for your account." }, 404);

    type DecisionRow = {
      id: string; decision: string; agent_id: string | null; agent_run_id: string | null;
      action_type: string | null; provider: string | null; plan_id: string | null;
    };
    const decisionRow = row as DecisionRow;

    const { data: existingRow } = await admin
      .from("pending_approvals")
      .select("id, status")
      .eq("decision_id", decisionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const existing = existingRow as { id: string; status: string } | null;
    if (hasOpenReview(existing)) {
      return json({ ok: true, already_open: true, approval_id: existing!.id, status: existing!.status });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const callerReason = typeof body?.reason === "string" ? body.reason.slice(0, 800) : null;
    const reasonText = buildDisputeReasonText(callerReason, decisionRow.decision);

    const { data: inserted, error: insertErr } = await admin.from("pending_approvals").insert({
      user_id: userId,
      decision_id: decisionId,
      requester_id: userId,
      agent_id: decisionRow.agent_id,
      run_id: decisionRow.agent_run_id,
      action_type: decisionRow.action_type ?? "unknown",
      provider: decisionRow.provider ?? "unknown",
      description: `Re-review requested for decision ${decisionId}.`,
      reason: reasonText,
      risk_tier: "medium",
      origin: "external-api",
      status: "pending",
      plan_id: decisionRow.plan_id,
    }).select("id").maybeSingle();
    if (insertErr) return json({ error: insertErr.message }, 500);
    const approvalId = (inserted as { id?: string } | null)?.id ?? null;

    if (approvalId) {
      await triggerWebhooks(admin, userId, "approval_created", {
        approval_id: approvalId,
        action_type: decisionRow.action_type ?? "unknown",
        provider: decisionRow.provider ?? "unknown",
        risk_tier: "medium",
        reason: reasonText,
      });
    }

    return json({ ok: true, already_open: false, approval_id: approvalId, status: "pending" });
  }

  // ---- POST /control-api/v1/respond ----------------------------------------
  // "White-labeled 'brain' endpoint" plan, item 1: lets an integrating
  // company hand NazAI one of ITS OWN end user's messages, plus whatever
  // grounding context and tone it configured for this key (see
  // POST /api-keys/:id/context and .../policy's response_persona), and get
  // back a grounded, non-hallucinating, fully white-labeled text answer to
  // relay straight back to that end user as if it were their own AI
  // speaking. Deliberately key-scoped like every other route on this API --
  // there is no unauthenticated/anonymous path here; the integrating
  // company's own backend calls this and relays the answer onward itself.
  if (req.method === "POST" && /\/respond\/?$/.test(url.pathname)) {
    if (!auth.keyId) return json({ error: "not_found" }, 404);

    const rate = await checkRateLimit(admin, userId, "control-api-respond", RESPOND_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const parsed = parseRespondRequest(body);
    if ("error" in parsed) return json({ error: parsed.error }, 400);

    const startedAt = Date.now();
    // "Knowledge & autonomy" plan, item 7's own established gate -- a
    // sandbox/test key runs through this exact pipeline (context, tone,
    // generation, grounding check, sanitizer) but never spends real
    // budget or writes the audit row below.
    const meterSpend = countsTowardRealUsage(auth.isTest);

    const [{ data: keyRow }, { data: anyEntry }] = await Promise.all([
      admin.from("api_keys").select("response_persona").eq("id", auth.keyId).maybeSingle(),
      admin.from("api_key_context_entries").select("id").eq("api_key_id", auth.keyId).eq("enabled", true).limit(1).maybeSingle(),
    ]);
    const persona = (keyRow as { response_persona?: string | null } | null)?.response_persona ?? null;

    // Item 163: retrieve only the context entries relevant to THIS
    // message once retrieval actually has something to search -- falls
    // back to every enabled entry (the original behavior) whenever
    // retrieval comes back empty, so a key whose entries predate
    // embeddings, or whose embedding call fails, or a sandbox key (which
    // never spends real embedding budget, same as every other real-usage
    // gate this endpoint already has) never loses its configured context.
    let contextEntries: ResponseContextEntry[] = [];
    if (anyEntry) {
      const queryEmbedding = meterSpend
        ? await generateEmbeddingWithinBudget(admin, userId, auth.keyId, parsed.message)
        : null;
      if (queryEmbedding) {
        contextEntries = await findRelevantContext(admin, auth.keyId, formatEmbeddingLiteral(queryEmbedding));
      }
      if (!contextEntries.length) {
        const { data: allEntries } = await admin
          .from("api_key_context_entries")
          .select("id, entry_text")
          .eq("api_key_id", auth.keyId)
          .eq("enabled", true)
          .order("created_at", { ascending: true });
        contextEntries = (allEntries ?? []) as ResponseContextEntry[];
      }
    }
    const contextBlock = buildContextPromptBlock(contextEntries);

    const systemPrompt = buildSystemPrompt(contextBlock, persona);
    const generation = await generateGroundedAnswer(
      admin, userId, auth.keyId, meterSpend, systemPrompt, parsed.message, parsed.conversationHistory,
    );
    if (!generation.ok) {
      if (generation.error === "spend_cap_reached") {
        const spend = generation.spend;
        return json({
          error: "spend_cap_reached",
          message: `This API key's own daily AI spend cap is used up ($${spend.spent_usd.toFixed(2)} of ` +
            `$${spend.cap_usd.toFixed(2)}). Generating a response shares this same budget with judgment ` +
            `calls. Resumes tomorrow (UTC), or when an owner raises the cap.`,
        }, 429);
      }
      return json({ error: "generation_failed", message: generation.message }, 502);
    }

    // Item 164: a deterministic, free check for the drafted answer being a
    // verbatim (or near-verbatim) dump of the context block -- a
    // different failure mode from item 5's grounding check below, which
    // would trivially PASS a verbatim copy (every "claim" in it is, by
    // definition, supported by the context it was lifted from). Runs
    // first and skips the paid grounding call entirely when it fires --
    // there's no reason to spend a model call verifying an answer that's
    // already being discarded.
    const leaked = detectContextLeak(contextBlock, generation.text);
    // Item 5: a second, independent pass -- never trusts the system
    // prompt's own "don't hallucinate" instruction alone.
    const grounded = leaked
      ? { text: LEAK_FALLBACK_ANSWER, intervened: true }
      : await checkGrounding(admin, userId, auth.keyId, meterSpend, contextBlock, persona, generation.text);
    // Item 6: the last step before this ever leaves the endpoint.
    const sanitized = sanitizeResponse(grounded.text);

    const testModeFields = auth.isTest ? { test_mode: true, note: testModeVerdictNote(auth.isTest) } : {};
    // Item 168: "sources used" metadata. Only meaningful when the final
    // answer is genuinely the model's context-grounded draft -- when the
    // leak guard or grounding check replaced it with the generic fallback
    // (grounded.intervened / leaked), nothing was actually "used" to
    // produce that fallback text, so the field is omitted entirely rather
    // than sent as a misleading empty (or worse, stale-looking) array.
    const sourceFields = (!leaked && !grounded.intervened && contextEntries.length)
      ? { sources: summarizeSourcesUsed(contextEntries) }
      : {};

    if (meterSpend) {
      try {
        await admin.from("api_response_generations").insert({
          user_id: userId,
          api_key_id: auth.keyId,
          is_test: auth.isTest,
          // Truncated, not stored raw in full -- this is an operational
          // audit trail (what shape of question came in, did a guardrail
          // fire), not a transcript archive.
          message: parsed.message.slice(0, 500),
          injection_guard_intervened: leaked,
          grounding_check_intervened: grounded.intervened,
          sanitizer_intervened: sanitized.intervened,
          latency_ms: Date.now() - startedAt,
        });
      } catch { /* audit logging must never break a real answer that already succeeded */ }

      // Item 170: escalation-to-human webhook. Only for a REAL call whose
      // final answer is the generic fallback -- a sandbox key never fires
      // this (nothing "escalates" from test traffic), matching the same
      // meterSpend gate the audit row above already uses.
      if (grounded.intervened) {
        await triggerWebhooks(admin, userId, "response_grounding_failed", {
          api_key_id: auth.keyId,
          reason: leaked ? "context_leak" : "insufficient_context",
          message: parsed.message.slice(0, 500),
          answer: sanitized.text,
        });
      }
    }

    if (parsed.stream) return streamAnswer(sanitized.text, { ...testModeFields, ...sourceFields });
    return json({ ok: true, answer: sanitized.text, ...sourceFields, ...testModeFields });
  }

  // ---- GET /control-api/v1/content-gaps -------------------------------------
  // "/respond" MVP backlog, item 169: content-gap analytics. Every real
  // /respond call where the fact-check declined to answer
  // (grounding_check_intervened -- see api_response_generations, item 8)
  // is, by definition, a question this key's configured context didn't
  // cover. Surfacing that raw feed lets the integrating company see
  // exactly what to add via POST /api-keys/:id/context, instead of
  // guessing. Scoped to this one key, same as its context entries --
  // one company's unanswered questions are never mixed into another
  // key's feed. Reuses the decision-export endpoints' own keyset
  // cursor/limit pagination directly rather than reinventing it -- the
  // shape (id + created_at, ascending order, opaque cursor) is identical.
  if (req.method === "GET" && /\/content-gaps\/?$/.test(url.pathname)) {
    if (!auth.keyId) return json({ error: "not_found" }, 404);

    const rate = await checkRateLimit(admin, userId, "control-api-content-gaps", EXPORT_RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const limit = clampExportLimit(url.searchParams.get("limit"));
    const cursor = decodeExportCursor(url.searchParams.get("cursor"));

    let query = admin
      .from("api_response_generations")
      .select("id, message, created_at")
      .eq("api_key_id", auth.keyId)
      .eq("is_test", false)
      .eq("grounding_check_intervened", true);
    if (cursor) query = query.or(exportCursorFilter(cursor));
    query = query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const { page, hasMore, nextCursor } = buildExportPage((data ?? []) as { id: string; created_at: string }[], limit);
    return json({ gaps: page, has_more: hasMore, next_cursor: nextCursor });
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
