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
import { encodeExportCursor, decodeExportCursor, clampExportLimit, exportCursorFilter } from "../_shared/decision-export.ts";
import { claimRowOnce, claimIdempotencyKey, saveIdempotencyResponse, releaseIdempotencyKey } from "../_shared/idempotency.ts";
import { classifyPlatformStatus, platformStatusMessage, DEGRADED_LOOKBACK_MINUTES } from "../_shared/platform-status.ts";
import { classifyDecisionVerification, type RawDecisionVerification } from "../_shared/decision-verification.ts";
import { excludeDecisionFromPrecedent } from "../_shared/precedent-search.ts";

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
  action: ParsedControlApiAction,
  rateLimitPerMinute: number,
): Promise<Record<string, unknown>> {
  const { idempotencyKey } = action;
  if (!idempotencyKey) {
    return judgeOneActionInner(admin, supabaseUrl, serviceKey, userId, keyId, action, rateLimitPerMinute);
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
    const result = await judgeOneActionInner(admin, supabaseUrl, serviceKey, userId, keyId, action, rateLimitPerMinute);
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
  // "Zero human review" plan, item 12: checked BEFORE ever forwarding to
  // control-engine -- and therefore before any real AI-gateway cost is
  // incurred -- so a key with its own configured cap that's already used
  // up for today is blocked outright here, not after paying for an
  // assessment whose own cost would just push it further over. A key
  // with no cap of its own (has_cap: false) is completely unaffected --
  // only the account-wide cap (enforced inside control-engine itself,
  // unchanged) ever applies to it.
  if (keyId) {
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
      const verdict = await judgeOneAction(admin, supabaseUrl, serviceKey, userId, auth.keyId, parsed, rateLimitPerMinute);
      if (verdict.rateLimited) stopped = true;
      const { rateLimited: _drop, ...rest } = verdict;
      results.push({ index: i, ...rest });
    }
    return json({ batch: true, count: results.length, results });
  }

  // ---- Single-action mode (default) ----------------------------------------
  const parsed = parseControlApiAction(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const verdict = await judgeOneAction(admin, supabaseUrl, serviceKey, userId, auth.keyId, parsed, rateLimitPerMinute);
  if (verdict.rateLimited) {
    const { rateLimited: _drop, ...rest } = verdict;
    return json(rest, 429);
  }
  if (verdict.error === "assessment_failed") return json(verdict, 502);
  return json(verdict);
});
