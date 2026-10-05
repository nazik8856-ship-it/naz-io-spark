// Outer Control System: POST /outer-control/evaluate
//
// Governs a RESPONSE (or a proposed ACTION) FROM AN EXTERNAL AI -- ChatGPT,
// Claude, a connected CRM bot, a support AI, anything the account has
// connected that isn't one of NazAI's own generated agents (those go
// through control-gate.ts / control-engine instead). Reachable two ways,
// per the outer-control spec: as a public API any external tool/integration
// can call directly (authenticated the same way control-api already is),
// and from inside NazAI itself whenever a workflow hands work to a
// connected external model and needs to trust what comes back before using
// it.
//
// content_kind='text' (v1): free-text output, judged in the SAME precedence
// order the action-shaped gate below holds to -- kill switches (platform,
// account, agent) first, then hard rules (task #44: matched against a
// synthetic "outer_control_text_review" action_type/source_model pair via
// checkKillSwitches/matchHardRule, so a rule scoped by provider or agent
// behaves identically to how it already governs a real action) -- and only
// once neither stops it, scanned with the safety_rules criteria pattern
// Inner Control's safety-scanner already applies to action params (that
// scanner is content-agnostic -- a plain string flattens to one field
// there, so it's reused as-is via scanWithRules rather than duplicated).
// Spend caps, the circuit breaker, and the anomaly detector are NOT wired
// into this path -- content review has no execution outcome (success/
// failure) for a breaker or anomaly baseline to key off, and incurs no AI
// spend of its own in v1 (pure pattern matching, no LLM call). Task #52:
// anything the safety scanner actually flags (never a clean allow, matching
// the action-shaped gate's own posture) gets a real agent_decisions row and
// is embedded via decision-embeddings.ts the same way an external-api
// action's own gate stop already is, so Outer Control's own history builds
// real precedent (findPrecedent/evaluatePrecedentForAutoApprove) instead of
// every call being judged in isolation from every one before it.
//
// content_kind='action' (v2): a structured *proposed action* from an
// external AI -- action_type/provider/description/params, same shape
// control-api's own parseControlApiAction already validates. Routed through
// the SAME deterministic runControlGate() Inner Control uses for NazAI's
// own agents: spend caps, kill switch, hard rules, circuit breaker, safety
// scanner, anomaly detector. A require_approval verdict already gets a real
// pending_approvals row from inside the gate itself (createPendingApproval,
// resolved automatically when the calling key has an on_uncertain policy
// configured) -- no separate queue-integration step needed here. An allow
// verdict is carried out for real via runProviderWrite when the calling key
// was explicitly granted the outer_control:execute scope (opt-in, never
// implied by a plain verdict-only key); otherwise it's judged but not run,
// exactly like a key without that scope asking Inner Control to execute
// something. Task #45: a block/escalate verdict caused ONLY by the safety
// scanner matching real top-level params fields also comes back with a
// suggested_correction -- those fields stripped and the result RE-VERIFIED
// clean against the same scanner before ever being suggested (reuses
// auto-narrow-retry.ts's buildSecondNarrowingAttempt, the exact mechanism
// Inner Control's own auto_narrow on_uncertain policy already relies on).
// A hard rule, kill switch, spend cap, or circuit breaker stop has nothing
// analogous to strip, so suggested_correction is always null there -- a
// bare verdict was the ENTIRE response before this, so even a null here is
// an explicit "nothing correctable" rather than a missing field.
//
// verify_jwt = false, same as control-api/agent-runtime -- auth is the
// Authorization: Bearer nazai_sk_... header via resolveApiKeyAuth, not a
// Supabase session JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKeyAuth } from "../_shared/control-api-auth.ts";
import { checkRateLimit, checkIpRateLimit } from "../_shared/rate-limit.ts";
import { scanAction, type SafetyMatch } from "../_shared/safety-scanner.ts";
import { buildSecondNarrowingAttempt } from "../_shared/auto-narrow-retry.ts";
import { computeTrustScore } from "../_shared/outer-control-scoring.ts";
import { parseControlApiAction } from "../_shared/control-api-action.ts";
import { runControlGate } from "../_shared/control-gate.ts";
import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";
// Blueprint task #3: the text-path gate (kill switches -> hard rules ->
// safety-rules scan) now lives in this shared module so agent-runtime's
// http_post tool can run the SAME check on whatever an external endpoint
// hands back, before it re-enters the agent's own reasoning loop.
import { evaluateExternalText } from "../_shared/outer-control-text-review.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Pre-auth (per-IP) blunts brute-forcing/probing invalid keys, same
// posture and same reasoning as control-api's own pre-auth limit. Post-
// auth is per-account, set well below control-api's fast-mode limit since
// this does no LLM call of its own in v1 -- just pattern matching -- so
// there's no cost-based reason to allow less, but it's new, internet-
// reachable surface and should start conservative.
const PRE_AUTH_RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_PER_MINUTE = 60;
const MAX_CONTENT_LENGTH = 20_000;

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type SuggestedCorrection = {
  params: Record<string, unknown>;
  removed_fields: string[];
  verified_clean: boolean;
};

/**
 * Task #45: a stopped action currently comes back as a bare verdict --
 * "block"/"escalate" and a reason, nothing the caller can act on besides
 * giving up or waiting for a human. When the ONLY reason was the safety
 * scanner matching real top-level params fields (never a hard rule, spend
 * cap, kill switch, or circuit breaker -- none of those have anything
 * analogous to strip, same reasoning buildSecondNarrowingAttempt's own doc
 * comment already gives for Inner Control's auto_narrow retry), this
 * builds a corrected candidate by removing exactly the flagged field(s),
 * then RE-RUNS the same deterministic safety scanner against it before
 * ever suggesting it back -- never hands the caller a "fix" that wasn't
 * itself verified clean. This is advisory only: NazAI never resubmits or
 * executes the suggestion on the caller's behalf.
 */
async function buildSuggestedCorrection(
  admin: AnyAdmin,
  userId: string,
  agentId: string | null,
  description: string,
  params: unknown,
  matches: SafetyMatch[],
  // GAP 1 (Shared Criteria Library): lets the re-verification scan below
  // resolve api-key-scoped safety rules when there's no agentId in context
  // (an external-api-origin action), same as the first scan already did.
  apiKeyId: string | null = null,
): Promise<SuggestedCorrection | null> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const original = params as Record<string, unknown>;
  const stricter = buildSecondNarrowingAttempt(original, { kind: "safety_scanner", matches });
  if (!stricter) return null;
  // A flagged field can BE the entire action (a body-only email whose one
  // field triggered "destructive wording") -- stripping it then leaves an
  // empty object, which isn't a corrected action, it's no action at all.
  // Confirmed live: exactly this happened for a single-field destructive-
  // wording match. Never suggest a result with nothing left in it.
  if (Object.keys(stricter).length === 0) return null;
  const removedFields = Object.keys(original).filter((k) => !(k in stricter));
  const recheck = await scanAction(admin, userId, stricter, description, null, agentId, apiKeyId);
  return { params: stricter, removed_fields: removedFields, verified_clean: !recheck.matched };
}

/**
 * content_kind='action': a structured proposed action from an external AI,
 * judged by the SAME deterministic gate Inner Control's own agents go
 * through (spend caps, kill switch, hard rules, circuit breaker, safety
 * scanner, anomaly detector), then carried out for real when it comes back
 * "allow" and the calling key was explicitly granted outer_control:execute.
 * A require_approval verdict already gets a real pending_approvals row from
 * inside runControlGate itself -- nothing further needed here for that case.
 */
async function handleActionEvaluation(
  admin: AnyAdmin,
  auth: { userId: string; keyId: string | null; isTest: boolean; scopes: string[] },
  sourceModel: string,
  agentId: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const parsed = parseControlApiAction(body);
  if ("error" in parsed) {
    return json({ error: "invalid_action", message: parsed.error }, 400);
  }
  const { actionType, provider, description, params, planId } = parsed;

  const gate = await runControlGate(admin, {
    userId: auth.userId,
    actionType,
    provider,
    description,
    params,
    agentId,
    origin: "external-api",
    apiKeyId: auth.keyId,
    isTest: auth.isTest,
    planId,
  });

  const verdict: "allow" | "block" | "escalate" =
    gate.verdict === "allow" ? "allow" : gate.verdict === "block" ? "block" : "escalate";

  // The safety scanner's own matches (when it ran) double as this action's
  // trust-score input -- same Match shape (category/severity/pattern)
  // outer-control-scoring.ts already expects, so nothing new to build. Early
  // stops (hard rule, kill switch, spend cap, circuit breaker) never reach
  // the safety scanner, so a plain block/escalate floor stands in for those
  // instead of reading an always-empty scan as "no issues found."
  const scoreFromSafety = computeTrustScore(gate.safety.matches);
  const trustScore = verdict === "block" ? 0 : verdict === "escalate" ? Math.min(60, scoreFromSafety) : scoreFromSafety;

  let executed = false;
  let executionSummary: string | null = null;
  let executionRef: string | null = null;
  let executionUrl: string | null = null;

  if (verdict === "allow") {
    if (!auth.scopes.includes("outer_control:execute")) {
      executionSummary = "Judged safe, but this API key can only evaluate actions, not execute them. " +
        "Add the outer_control:execute scope to let NazAI carry this out automatically.";
    } else if (!PROVIDER_WRITE_KINDS.has(actionType)) {
      executionSummary = `"${actionType}" has no provider-write path NazAI can run directly.`;
    } else {
      const result = await runProviderWrite(actionType, admin, auth.userId, agentId ?? "", (params ?? {}) as Record<string, unknown>);
      executed = result.ok;
      executionSummary = result.summary ?? null;
      executionRef = result.ref ?? null;
      executionUrl = result.url ?? null;
      try {
        await gate.recordAttempt(!result.ok, result.ok ? "ok" : String(result.summary ?? "execution failed"));
      } catch { /* feeding the circuit breaker must never affect the real response */ }
    }
  }

  const summary = verdict === "block"
    ? gate.reason ?? "Blocked by the control gate."
    : verdict === "escalate"
      ? gate.reason ?? "Held for human approval."
      : executionSummary ?? "No safety-criteria issues found in this proposed action.";

  // Task #45: only ever attempted when the safety scanner itself is what
  // stopped this action -- a hard rule, spend cap, kill switch, or circuit
  // breaker block has nothing analogous to strip from params, same as
  // Inner Control's own auto_narrow retry already reasons.
  const suggestedCorrection = verdict !== "allow" && gate.source === "safety_scanner"
    ? await buildSuggestedCorrection(admin, auth.userId, agentId, description, params, gate.safety.matches, auth.keyId)
    : null;

  const { data: evalRow, error: insertError } = await admin
    .from("outer_control_evaluations")
    .insert({
      user_id: auth.userId,
      api_key_id: auth.keyId,
      agent_id: agentId,
      source_model: sourceModel,
      content_kind: "action",
      input_excerpt: description.slice(0, 4000),
      action_type: actionType,
      action_provider: provider,
      action_params: params ?? {},
      decision_id: gate.decisionId,
      verdict,
      trust_score: trustScore,
      matches: gate.safety.matches,
      summary,
      executed,
      execution_summary: executionSummary,
      execution_ref: executionRef,
      execution_url: executionUrl,
    })
    .select("id, created_at")
    .maybeSingle();

  if (insertError || !evalRow) {
    return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
  }

  return json({
    ok: true,
    id: evalRow.id,
    verdict,
    trust_score: trustScore,
    matches: gate.safety.matches,
    summary,
    executed,
    execution: executed || executionSummary ? { summary: executionSummary, ref: executionRef, url: executionUrl } : null,
    approval_id: gate.approvalId,
    suggested_correction: suggestedCorrection,
    provenance: {
      source_model: sourceModel,
      evaluated_at: evalRow.created_at,
      criteria: "inner_control_gate_v1",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    if (!/\/evaluate\/?$/.test(url.pathname)) {
      return json({ error: "not_found", message: "POST /outer-control/evaluate is the only route today." }, 404);
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";
    const ipRate = await checkIpRateLimit(admin, ip, "outer-control-preauth", PRE_AUTH_RATE_LIMIT_PER_MINUTE, 60);
    if (!ipRate.allowed) {
      return json({ error: "rate_limited", message: "Too many requests from this address. Try again shortly." }, 429);
    }

    const auth = await resolveApiKeyAuth(admin, req.headers.get("Authorization"));
    if (!auth.ok) return json(auth.body, auth.status);

    // Same full-access scope control-api requires for everything besides
    // its narrow respond-only route -- Outer Control judges arbitrary
    // external content, not the one bounded public-widget use case a
    // 'control:respond'-scoped key exists for.
    if (!auth.scopes.includes("control:verdict")) {
      return json({
        error: "insufficient_scope",
        message: "Outer Control requires a full-access API key. Create one without the respond-only scope.",
      }, 403);
    }

    const rate = await checkRateLimit(admin, auth.userId, "outer-control-evaluate", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const sourceModel = String(body?.source_model || "").trim().slice(0, 80);
    const agentId = typeof body?.agent_id === "string" ? body.agent_id : null;
    const contentKind = body?.content_kind === "action" ? "action" : "text";

    if (!sourceModel) {
      return json({ error: "source_model_required", message: "source_model (which external AI/tool produced this) is required." }, 400);
    }

    if (contentKind === "action") {
      return await handleActionEvaluation(admin, auth, sourceModel, agentId, body);
    }

    const content = typeof body?.content === "string" ? body.content : "";
    if (!content.trim()) {
      return json({ error: "content_required", message: "content (the external AI's raw output to evaluate) is required." }, 400);
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return json({ error: "content_too_long", message: `content must be ${MAX_CONTENT_LENGTH} characters or fewer.` }, 400);
    }

    // ---- Full control gate, text path (task #44; extracted to a shared
    // module in blueprint task #3 so agent-runtime's http_post tool can run
    // the SAME gate on an external endpoint's response). Precedence order:
    // kill switches, then hard rules, then the safety-rules scan.
    const result = await evaluateExternalText(admin, {
      userId: auth.userId, agentId, apiKeyId: auth.keyId, isTest: auth.isTest,
      sourceModel, content, origin: "external-api",
    });
    if (!result.evaluationId) {
      return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
    }
    return json({
      ok: true,
      id: result.evaluationId,
      verdict: result.verdict,
      trust_score: result.trustScore,
      // For text, the "corrected result" the spec asks for is already this
      // `output` field (redacted content on a "modify" verdict) -- there's
      // no separate structured params object to suggest a fix for, unlike
      // the action path's suggested_correction below.
      output: result.output,
      matches: result.matches,
      summary: result.summary,
      approval_id: result.approvalId ?? undefined,
      suggested_correction: null,
      provenance: {
        source_model: sourceModel,
        evaluated_at: result.evaluatedAt,
        criteria: result.criteria,
      },
    });
  } catch (e) {
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
