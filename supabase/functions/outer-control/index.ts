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
// _shared/repair-engine.ts's repairParams, GAP 3's shared primitive over
// the same mechanism Inner Control's own auto_narrow on_uncertain policy
// already relies on via auto-narrow-retry.ts).
// A hard rule, kill switch, spend cap, or circuit breaker stop has nothing
// analogous to strip, so suggested_correction is always null there -- a
// bare verdict was the ENTIRE response before this, so even a null here is
// an explicit "nothing correctable" rather than a missing field.
//
// verify_jwt = false, same as control-api/agent-runtime -- auth is the
// Authorization: Bearer nazai_sk_... header via resolveApiKeyAuth, not a
// Supabase session JWT.
import { judgeStateless } from "../_shared/outer-control-judgement.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKeyAuth } from "../_shared/control-api-auth.ts";
import { checkRateLimit, checkIpRateLimit } from "../_shared/rate-limit.ts";
import { scanAction, type SafetyMatch } from "../_shared/safety-scanner.ts";
import { repairParams, verifyRepair } from "../_shared/repair-engine.ts";
import { computeTrustScore } from "../_shared/outer-control-scoring.ts";
import { computeTrustScore as computeEntityTrustScore, gatherTrustScoreInput, type TrustScoreReport } from "../_shared/trust-score.ts";
import { parseControlApiAction } from "../_shared/control-api-action.ts";
import { runControlGate } from "../_shared/control-gate.ts";
import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";
// Blueprint task #3: the text-path gate (kill switches -> hard rules ->
// safety-rules scan) now lives in this shared module so agent-runtime's
// http_post tool can run the SAME check on whatever an external endpoint
// hands back, before it re-enters the agent's own reasoning loop.
import { evaluateExternalText, excerptOf, maskedDescription } from "../_shared/outer-control-text-review.ts";
import { extractExternalText, parseExternalId } from "../_shared/outer-control-intake.ts";
import { sha256Hex } from "../_shared/api-key-auth.ts";

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

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type SuggestedCorrection = {
  params: Record<string, unknown>;
  removed_fields: string[];
  verified_clean: boolean;
  // GAP 3 (Output Modification & Repair Engine): the repair engine's own
  // confidence (0-100), raised to its verified ceiling only once the
  // recheck below confirms `verified_clean` -- never claimed up front.
  confidence: number;
};

/**
 * Task #45: a stopped action currently comes back as a bare verdict --
 * "block"/"escalate" and a reason, nothing the caller can act on besides
 * giving up or waiting for a human. When the ONLY reason was the safety
 * scanner matching real top-level params fields (never a hard rule, spend
 * cap, kill switch, or circuit breaker -- none of those have anything
 * analogous to strip, same reasoning the GAP 3 repair engine's own doc
 * comment gives), this builds a corrected candidate via repair-engine.ts's
 * shared repairParams, then RE-RUNS the same deterministic safety scanner
 * against it before ever suggesting it back -- never hands the caller a
 * "fix" that wasn't itself verified clean. This is advisory only: NazAI
 * never resubmits or executes the suggestion on the caller's behalf.
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
  const attempt = repairParams(original, matches);
  if (!attempt.repaired) return null;
  // A flagged field can BE the entire action (a body-only email whose one
  // field triggered "destructive wording") -- stripping it then leaves an
  // empty object, which isn't a corrected action, it's no action at all.
  // Confirmed live: exactly this happened for a single-field destructive-
  // wording match. Never suggest a result with nothing left in it.
  if (Object.keys(attempt.repaired).length === 0) return null;
  const removedFields = attempt.diff.map((d) => d.detail);
  const recheck = await scanAction(admin, userId, attempt.repaired, description, null, agentId, apiKeyId);
  const verified = verifyRepair(attempt, recheck.matched);
  return { params: attempt.repaired, removed_fields: removedFields, verified_clean: !recheck.matched, confidence: verified.confidence };
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

  // GAP 4 (Trust Score + Provenance + Control Report): the AGGREGATE,
  // measured-history trust score for whichever entity governed this
  // decision -- distinct from `trustScore` above (this one decision's own
  // safety-match score). An agent, when present, is always the entity;
  // otherwise it's the calling api key. Never computed when neither is
  // known (shouldn't happen for a real authenticated call, but correctly
  // comes back null rather than guessing).
  const trustScoreEntity: { kind: "agent" | "api_key"; id: string } | null =
    agentId ? { kind: "agent", id: agentId } : auth.keyId ? { kind: "api_key", id: auth.keyId } : null;
  const entityTrustScore: TrustScoreReport | null = trustScoreEntity
    ? computeEntityTrustScore(await gatherTrustScoreInput(admin, auth.userId, trustScoreEntity.kind, trustScoreEntity.id))
    : null;

  const { data: evalRow, error: insertError } = await admin
    .from("outer_control_evaluations")
    .insert({
      user_id: auth.userId,
      api_key_id: auth.keyId,
      agent_id: agentId,
      source_model: sourceModel,
      content_kind: "action",
      input_excerpt: excerptOf(maskedDescription(description, gate.safety.matches)),
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
      // GAP 6 (Visible Control Decision Trail, 2026-10-10): the "after" half
      // of a before/after pair, same shape agent_decisions already has
      // (params/modified_params) -- previously computed but only ever
      // returned in this one HTTP response, never persisted.
      corrected_params: suggestedCorrection?.params ?? null,
    })
    .select("id, created_at")
    .maybeSingle();

  if (insertError || !evalRow) {
    return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
  }

  // Risk, confidence and a short reasoning trace, same wording as Outer Control sessions. A single
  // call has no task around it, so earlier steps and earlier human corrections play no part.
  const judged = judgeStateless({
    verdict, matches: gate.safety.matches, content: `${description} ${JSON.stringify(params ?? {})}`, source: gate.source,
  });

  return json({
    ok: true,
    id: evalRow.id,
    verdict,
    trust_score: trustScore,
    risk: judged.risk,
    confidence: judged.confidence,
    trace: judged.trace,
    // GAP 4: the governing entity's own aggregate, measured-history trust
    // score (distinct from `trust_score` above, which is just this one
    // decision's safety-match score) -- null only when neither an agent
    // nor a calling api key is known for this evaluation.
    entity_trust_score: entityTrustScore,
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
      // GAP 4: the gate's own full trace (every layer checked, in order,
      // not just the one that stopped it) and the agent_decisions row id
      // backing this verdict -- attached to the DELIVERED output itself
      // now, not just left in the internal audit trail an account owner
      // would have to sign in and look up separately.
      decision_id: gate.decisionId,
      gate_trace: gate.trace,
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

    // A body that is not valid JSON used to read as {} and surface as a
    // misleading "source_model_required".
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json", message: "The request body must be a JSON object." }, 400);
    }
    const sourceModel = String(body?.source_model || "").trim().slice(0, 80);
    const agentId = typeof body?.agent_id === "string" ? body.agent_id : null;
    const contentKind = body?.content_kind === "action" ? "action" : "text";

    if (!sourceModel) {
      return json({ error: "source_model_required", message: "source_model (which external AI/tool produced this) is required." }, 400);
    }

    if (contentKind === "action") {
      return await handleActionEvaluation(admin, auth, sourceModel, agentId, body);
    }

    const intake = extractExternalText(body.content);
    if (!intake.ok) return json({ error: intake.code, message: intake.message }, 400);
    const content = intake.text;

    const ext = parseExternalId(body.external_id);
    if (!ext.ok) return json({ error: "invalid_external_id", message: ext.message }, 400);

    const contentHash = await sha256Hex(content);

    // A retried call (same external_id on the same key AND the same text) returns
    // the verdict already recorded instead of judging and logging the same text
    // twice. The same id with DIFFERENT text is refused, never answered with the
    // earlier text's verdict.
    const replayFor = async (): Promise<Response | null> => {
      if (!ext.id || !auth.keyId) return null;
      const { data: prior } = await admin
        .from("outer_control_evaluations")
        .select("id, source_model, verdict, trust_score, output_text, matches, summary, created_at, changes, next_step, shadow_matches, approval_id, content_hash")
        .eq("user_id", auth.userId)
        .eq("api_key_id", auth.keyId)
        .eq("external_id", ext.id)
        .maybeSingle();
      if (!prior) return null;
      if (prior.content_hash && prior.content_hash !== contentHash) {
        return json({
          error: "external_id_reused",
          message: "This external_id was already used for different text. Use a new external_id for a new response.",
          id: prior.id,
        }, 409);
      }
      // A replayed escalate must show what became of the approval since.
      let approvalStatus: string | undefined;
      if (prior.approval_id) {
        const { data: ap } = await admin.from("pending_approvals").select("status").eq("id", prior.approval_id).maybeSingle();
        approvalStatus = (ap as { status?: string } | null)?.status;
      }
      return json({
        ok: true,
        id: prior.id,
        replayed: true,
        verdict: prior.verdict,
        trust_score: prior.trust_score,
        ...judgeStateless({ verdict: prior.verdict, matches: prior.matches ?? [], shadowMatches: (prior.shadow_matches ?? []).length, content: prior.output_text ?? "" }),
        output: prior.output_text,
        matches: prior.matches ?? [],
        changes: prior.changes ?? [],
        next_step: prior.next_step,
        shadow_matches: prior.shadow_matches ?? [],
        summary: prior.summary,
        approval_id: prior.approval_id ?? undefined,
        approval_status: approvalStatus,
        suggested_correction: null,
        provenance: { source_model: prior.source_model, evaluated_at: prior.created_at, criteria: "stored_evaluation" },
      });
    };
    const replayed = await replayFor();
    if (replayed) return replayed;

    // ---- Full control gate, text path (task #44; extracted to a shared
    // module in blueprint task #3 so agent-runtime's http_post tool can run
    // the SAME gate on an external endpoint's response). Precedence order:
    // kill switches, then hard rules, then the safety-rules scan.
    const result = await evaluateExternalText(admin, {
      userId: auth.userId, agentId, apiKeyId: auth.keyId, isTest: auth.isTest,
      sourceModel, content, origin: "external-api", externalId: ext.id, contentHash,
    });
    if (!result.evaluationId) {
      // Two concurrent calls with the same external_id: the unique index let the
      // other one record first. Answer with that stored verdict, not a 500.
      const raced = await replayFor();
      if (raced) return raced;
      return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
    }
    return json({
      ok: true,
      id: result.evaluationId,
      replayed: false,
      input_format: intake.format,
      verdict: result.verdict,
      trust_score: result.trustScore,
      // Risk, confidence and a short reasoning trace (stateless: only the rules that matched and the text itself).
      ...judgeStateless({ verdict: result.verdict, matches: result.matches, shadowMatches: result.shadowMatches.length, content: result.output ?? content }),
      // GAP 4: this entity's own aggregate, measured-history trust score --
      // see outer-control-text-review.ts's own TextReviewResult doc comment.
      entity_trust_score: result.entityTrustScore,
      // For text, the "corrected result" is this `output` field: the cleaned
      // text on a "modify" verdict, the original on "allow", null otherwise.
      output: result.output,
      matches: result.matches,
      // What a Modify actually removed, per rule, and what the caller should
      // do with this verdict: use_output | await_approval | discard.
      changes: result.changes,
      next_step: result.nextStep,
      shadow_matches: result.shadowMatches,
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
