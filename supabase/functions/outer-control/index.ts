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
// content_kind='text' (v1): free-text output, scanned with the SAME
// safety_rules/hard_rules criteria pattern Inner Control's safety-scanner
// already applies to action params (that scanner is content-agnostic -- a
// plain string flattens to one field there, so it's reused as-is via
// scanWithRules rather than duplicated).
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
// something.
//
// verify_jwt = false, same as control-api/agent-runtime -- auth is the
// Authorization: Bearer nazai_sk_... header via resolveApiKeyAuth, not a
// Supabase session JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKeyAuth } from "../_shared/control-api-auth.ts";
import { checkRateLimit, checkIpRateLimit } from "../_shared/rate-limit.ts";
import { loadSafetyRules, scanWithRules } from "../_shared/safety-scanner.ts";
import { computeTrustScore, decideVerdict, redactContent } from "../_shared/outer-control-scoring.ts";
import { parseControlApiAction } from "../_shared/control-api-action.ts";
import { runControlGate } from "../_shared/control-gate.ts";
import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";

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

    const rules = await loadSafetyRules(admin, auth.userId, agentId);
    // A plain string flattens to a single "value" field inside scanWithRules
    // -- no separate content-specific scanner needed.
    const scan = scanWithRules(rules, content, "");
    const verdict = decideVerdict(scan.matches);
    const trustScore = computeTrustScore(scan.matches);
    const outputText = verdict === "allow"
      ? content
      : verdict === "modify"
        ? redactContent(content, scan.matches.map((m) => ({ pattern: m.pattern, category: m.category })))
        : null; // block / escalate: nothing safe to hand back yet.
    const summary = scan.summary ?? "No safety-criteria issues found in this external output.";

    const { data: evalRow, error: insertError } = await admin
      .from("outer_control_evaluations")
      .insert({
        user_id: auth.userId,
        api_key_id: auth.keyId,
        agent_id: agentId,
        source_model: sourceModel,
        content_kind: "text",
        input_excerpt: content.slice(0, 4000),
        output_text: outputText,
        verdict,
        trust_score: trustScore,
        matches: scan.matches,
        summary,
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
      output: outputText,
      matches: scan.matches,
      summary,
      provenance: {
        source_model: sourceModel,
        evaluated_at: evalRow.created_at,
        criteria: "inner_control_safety_rules_v1",
      },
    });
  } catch (e) {
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
