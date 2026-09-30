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
// spend of its own in v1 (pure pattern matching, no LLM call).
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
import { checkKillSwitches, createPendingApproval, matchHardRule, runControlGate } from "../_shared/control-gate.ts";
import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";

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

// Synthetic action_type/provider pair used ONLY to let checkKillSwitches /
// matchHardRule (task #44) reuse the same account_type_pattern glob-matching
// and agent-scoping a real action already gets -- a text evaluation has no
// real action_type of its own. "outer_control_text_review" as the pattern
// target, source_model as the provider, so a rule scoped to a specific
// provider (e.g. "ChatGPT") only fires for text attributed to that model.
const TEXT_REVIEW_ACTION_TYPE = "outer_control_text_review";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

/** Shared outer_control_evaluations insert for every text-path response below -- kill-switch stop, hard-rule stop, or the existing safety-rules scan. */
async function recordEvaluation(
  admin: AnyAdmin,
  row: Record<string, unknown>,
): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await admin
    .from("outer_control_evaluations")
    .insert(row)
    .select("id, created_at")
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; created_at: string };
}

/**
 * Audit-trail parity with the action-shaped gate: a text evaluation that a
 * kill switch or hard rule stops now gets a real agent_decisions row too
 * (source values already covered by control-gate.ts's own
 * AGENT_DECISION_SOURCES), not just an outer_control_evaluations one -- so
 * it shows up wherever the account already looks for gate activity (the
 * kill-switch/hard-rule effectiveness views, the decisions feed), the same
 * as an action NazAI's own agents proposed would.
 */
async function logTextGateDecision(
  admin: AnyAdmin,
  input: {
    userId: string;
    agentId: string | null;
    apiKeyId: string | null;
    isTest: boolean;
    sourceModel: string;
    content: string;
    decision: string;
    reasoning: string;
    source: "platform_kill_switch" | "kill_switch" | "agent_kill_switch" | "hard_rule";
    escalated: boolean;
    hardRuleId?: string | null;
    policyVersion?: number | null;
  },
): Promise<string | null> {
  try {
    const { data } = await admin.from("agent_decisions").insert({
      user_id: input.userId,
      agent_id: input.agentId,
      decision: input.decision.slice(0, 400),
      reasoning: input.reasoning.slice(0, 800),
      source: input.source,
      escalated: input.escalated,
      policy_version: input.policyVersion ?? null,
      hard_rule_id: input.hardRuleId ?? null,
      action_type: TEXT_REVIEW_ACTION_TYPE,
      provider: input.sourceModel,
      description: input.content.slice(0, 800),
      api_key_id: input.apiKeyId,
      is_test: input.isTest,
    }).select("id").maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
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

    // ---- Full control gate, text path (task #44) -----------------------------
    // Same precedence order the action-shaped gate holds to: kill switches,
    // then hard rules, BEFORE the safety scanner further down ever runs.
    // Previously this path ran ONLY the safety scanner -- an account with its
    // kill switch on, or a hard rule written specifically to catch this kind
    // of content, had zero effect on an incoming external-AI text evaluation.
    const killCheck = await checkKillSwitches(admin, auth.userId, agentId);
    if (killCheck.killed) {
      const decisionId = await logTextGateDecision(admin, {
        userId: auth.userId, agentId, apiKeyId: auth.keyId, isTest: auth.isTest, sourceModel, content,
        decision: `BLOCK text_review (${sourceModel})`, reasoning: killCheck.reason ?? "Kill switch active.",
        source: killCheck.source ?? "kill_switch", escalated: false,
      });
      const evalRow = await recordEvaluation(admin, {
        user_id: auth.userId, api_key_id: auth.keyId, agent_id: agentId, source_model: sourceModel,
        content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: null,
        action_type: TEXT_REVIEW_ACTION_TYPE, action_provider: sourceModel, decision_id: decisionId,
        verdict: "block", trust_score: 0, matches: [], summary: killCheck.reason,
      });
      if (!evalRow) return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
      return json({
        ok: true, id: evalRow.id, verdict: "block", trust_score: 0, output: null, matches: [], summary: killCheck.reason,
        provenance: { source_model: sourceModel, evaluated_at: evalRow.created_at, criteria: "inner_control_gate_v1" },
      });
    }

    const hardRuleMatch = await matchHardRule(admin, auth.userId, TEXT_REVIEW_ACTION_TYPE, sourceModel, agentId);
    if (hardRuleMatch.rule) {
      const rule = hardRuleMatch.rule;
      const blocking = rule.effect === "always_block";
      const why = rule.rationale ? ` Why this rule exists: ${rule.rationale}` : "";
      const reason = blocking
        ? `Blocked by your hard rule: "${rule.rule_text}".${why} This was enforced by your rule, not judged by the model.`
        : `Your hard rule requires approval first: "${rule.rule_text}".${why} Nothing was returned — approve it explicitly to proceed.`;
      const decisionId = await logTextGateDecision(admin, {
        userId: auth.userId, agentId, apiKeyId: auth.keyId, isTest: auth.isTest, sourceModel, content,
        decision: `${blocking ? "BLOCK" : "APPROVAL_REQUIRED"} text_review (${sourceModel})`, reasoning: reason,
        source: "hard_rule", escalated: !blocking, hardRuleId: rule.id, policyVersion: hardRuleMatch.policyVersion,
      });

      if (blocking) {
        await sendCriticalAlert(admin, auth.userId, {
          event: "hard_rule_block",
          summary: `An external AI's text output was blocked by the hard rule "${rule.rule_text}". Nothing was scored or returned.`,
          decisionId, actionType: TEXT_REVIEW_ACTION_TYPE, provider: sourceModel,
        });
        const evalRow = await recordEvaluation(admin, {
          user_id: auth.userId, api_key_id: auth.keyId, agent_id: agentId, source_model: sourceModel,
          content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: null,
          action_type: TEXT_REVIEW_ACTION_TYPE, action_provider: sourceModel, decision_id: decisionId,
          verdict: "block", trust_score: 0, matches: [], summary: reason,
        });
        if (!evalRow) return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
        return json({
          ok: true, id: evalRow.id, verdict: "block", trust_score: 0, output: null, matches: [], summary: reason,
          provenance: { source_model: sourceModel, evaluated_at: evalRow.created_at, criteria: "inner_control_gate_v1" },
        });
      }

      // require_approval: a real pending_approvals row (or an api key's own
      // on_uncertain policy auto-resolving it) exactly as the action-shaped
      // gate already does -- createPendingApproval is action-shape-agnostic.
      const outcome = await createPendingApproval(admin, {
        userId: auth.userId, decisionId, agentId, actionType: TEXT_REVIEW_ACTION_TYPE, provider: sourceModel,
        description: content, reason, riskTier: "high", origin: "external-api", apiKeyId: auth.keyId,
        requiredApprovals: rule.required_approvals ?? undefined,
      });
      const verdict: "allow" | "block" | "escalate" = outcome.autoResolved
        ? (outcome.resolution === "approved" ? "allow" : "block")
        : "escalate";
      const summary = outcome.autoResolved
        ? `Resolved automatically to ${outcome.resolution} by this API key's configured policy — no human reviewed this.`
        : reason;
      const outputText = verdict === "allow" ? content : null;
      const trustScore = verdict === "block" ? 0 : verdict === "escalate" ? 50 : 100;
      const evalRow = await recordEvaluation(admin, {
        user_id: auth.userId, api_key_id: auth.keyId, agent_id: agentId, source_model: sourceModel,
        content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: outputText,
        action_type: TEXT_REVIEW_ACTION_TYPE, action_provider: sourceModel, decision_id: decisionId,
        verdict, trust_score: trustScore, matches: [], summary,
      });
      if (!evalRow) return json({ error: "internal_error", message: "Could not record this evaluation." }, 500);
      return json({
        ok: true, id: evalRow.id, verdict, trust_score: trustScore, output: outputText, matches: [], summary,
        approval_id: outcome.approvalId,
        provenance: { source_model: sourceModel, evaluated_at: evalRow.created_at, criteria: "inner_control_gate_v1" },
      });
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
