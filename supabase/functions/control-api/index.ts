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
import { checkIpRateLimit, checkRateLimit } from "../_shared/rate-limit.ts";
import { checkApiVersion, CONTROL_API_VERSION } from "../_shared/api-versioning.ts";
import { parseControlApiAction, MAX_BATCH_ACTIONS, type ParsedControlApiAction } from "../_shared/control-api-action.ts";
import { encodeExportCursor, decodeExportCursor, clampExportLimit, exportCursorFilter } from "../_shared/decision-export.ts";
import { claimRowOnce } from "../_shared/idempotency.ts";

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
// Same field set ControlDecisionHistory.tsx already exposes to a signed-in
// customer in-app, plus policy_version -- nothing here that isn't already
// something the account owner can see themselves.
const DECISION_EXPORT_FIELDS =
  "id, decision, reasoning, confidence_score, escalated, source, agent_id, action_type, provider, policy_version, created_at";

// Runs the exact same per-action logic for both a single request and one
// entry of a batch: consumes one post-auth rate-limit slot, then either the
// fast deterministic gate or the full LLM-scored assessment. Returns the
// verdict body (never throws -- an assessment failure comes back as an
// `error` field, matching how the pre-batch single-action path always
// reported it).
async function judgeOneAction(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  keyId: string | null,
  action: ParsedControlApiAction,
): Promise<Record<string, unknown>> {
  const rate = await checkRateLimit(admin, userId, "control-api", POST_AUTH_RATE_LIMIT_PER_MINUTE, 60);
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
    });
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
      };
    }
    return {
      verdict: "allow",
      reason: "No hard rule, safety match, spend cap, or circuit breaker stopped this action.",
      decision_id: null,
      gate_source: null,
      mode: "fast",
      resolved_automatically: false,
    };
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
      "x-api-key-id": keyId ?? "",
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

    const rows = (data ?? []) as { id: string; created_at: string }[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeExportCursor({ createdAt: last.created_at, id: last.id }) : null;

    return json({ decisions: page, has_more: hasMore, next_cursor: nextCursor });
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

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

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
      const verdict = await judgeOneAction(admin, supabaseUrl, serviceKey, userId, auth.keyId, parsed);
      if (verdict.rateLimited) stopped = true;
      const { rateLimited: _drop, ...rest } = verdict;
      results.push({ index: i, ...rest });
    }
    return json({ batch: true, count: results.length, results });
  }

  // ---- Single-action mode (default) ----------------------------------------
  const parsed = parseControlApiAction(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const verdict = await judgeOneAction(admin, supabaseUrl, serviceKey, userId, auth.keyId, parsed);
  if (verdict.rateLimited) {
    const { rateLimited: _drop, ...rest } = verdict;
    return json(rest, 429);
  }
  if (verdict.error === "assessment_failed") return json(verdict, 502);
  return json(verdict);
});
