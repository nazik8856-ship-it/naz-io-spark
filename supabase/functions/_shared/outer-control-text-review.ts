// Blueprint task #3: the full text-review gate outer-control/index.ts's
// /evaluate endpoint runs (kill switches -> hard rules -> safety-rules scan,
// task #44's precedence order), extracted so it can ALSO be called from
// inside agent-runtime -- specifically, on whatever comes back from the
// http_post tool, NazAI's own "escape hatch for integrations with no native
// connector" (agent-runtime/index.ts's own tool description). Before this,
// an external endpoint's raw response text was pushed straight into the
// agent's own reasoning loop with zero governance -- the exact "no bypass"
// gap the blueprint's 4 design rules call out: every external AI's output
// must obey the SAME rules an outer-control API caller's content would.
//
// This is the identical logic outer-control/index.ts ran inline before this
// extraction (verbatim aside from parameterizing auth.userId/keyId/isTest ->
// plain params) -- moved to _shared/ rather than imported directly from
// outer-control/index.ts because importing an edge function's own index.ts
// from elsewhere also re-runs its top-level Deno.serve() registration (the
// exact hazard task #48's guardrail-reconciliation.ts extraction hit and
// documented).
import { checkKillSwitches, createPendingApproval, matchHardRule } from "./control-gate.ts";
import { loadSafetyRules, scanWithRules, type SafetyMatch } from "./safety-scanner.ts";
import { computeTrustScore, decideVerdict, redactContent } from "./outer-control-scoring.ts";
import { computeTrustScore as computeEntityTrustScore, gatherTrustScoreInput, type TrustScoreReport } from "./trust-score.ts";
import { sendCriticalAlert } from "./critical-alerts.ts";
import { embedDecisionIfExternal } from "./decision-embeddings.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

// Synthetic action_type used ONLY to let checkKillSwitches/matchHardRule
// (task #44) reuse the same action_type_pattern glob-matching and
// agent-scoping a real action already gets -- a text evaluation has no real
// action_type of its own. Exported so outer-control/index.ts's callers keep
// seeing the exact same value in agent_decisions.action_type as before this
// extraction (no behavior change, same constant, one source of truth now).
export const TEXT_REVIEW_ACTION_TYPE = "outer_control_text_review";

export type TextReviewResult = {
  verdict: "allow" | "modify" | "block" | "escalate";
  output: string | null;
  trustScore: number;
  matches: SafetyMatch[];
  summary: string;
  /** null only when the outer_control_evaluations insert itself failed -- an infra error, not a verdict. */
  evaluationId: string | null;
  evaluatedAt: string | null;
  approvalId?: string | null;
  criteria: "inner_control_gate_v1" | "inner_control_safety_rules_v1";
  // GAP 4 (Trust Score + Provenance + Control Report): the governing
  // entity's own aggregate, measured-history trust score -- distinct from
  // `trustScore` above (this one piece of content's own match-based
  // score). null only when neither an agent nor a calling api key is
  // known for this review.
  entityTrustScore: TrustScoreReport | null;
};

async function recordEvaluation(admin: AnyAdmin, row: Record<string, unknown>): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await admin.from("outer_control_evaluations").insert(row).select("id, created_at").maybeSingle();
  if (error || !data) return null;
  return data as { id: string; created_at: string };
}

async function logTextGateDecision(
  admin: AnyAdmin,
  input: {
    userId: string; agentId: string | null; apiKeyId: string | null; isTest: boolean;
    sourceModel: string; content: string; decision: string; reasoning: string;
    source: "platform_kill_switch" | "kill_switch" | "agent_kill_switch" | "hard_rule" | "safety_scanner";
    escalated: boolean; hardRuleId?: string | null; policyVersion?: number | null;
  },
): Promise<string | null> {
  try {
    const { data } = await admin.from("agent_decisions").insert({
      user_id: input.userId, agent_id: input.agentId,
      decision: input.decision.slice(0, 400), reasoning: input.reasoning.slice(0, 800),
      source: input.source, escalated: input.escalated,
      policy_version: input.policyVersion ?? null, hard_rule_id: input.hardRuleId ?? null,
      action_type: TEXT_REVIEW_ACTION_TYPE, provider: input.sourceModel,
      description: input.content.slice(0, 800), api_key_id: input.apiKeyId, is_test: input.isTest,
    }).select("id").maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs a piece of external-AI text through the full text-path control gate:
 * kill switches, then hard rules, then the safety-rules pattern scan -- the
 * exact same precedence order and DB side effects (outer_control_evaluations
 * row, agent_decisions row on anything besides a clean allow, embedding for
 * api-key-origin calls, a critical alert on a hard-rule block, a real
 * pending_approvals row on a hard-rule require_approval) outer-control's own
 * /evaluate endpoint has always produced for a text_kind='text' call. Callers
 * with no api_key_id (NazAI's own internal use, e.g. agent-runtime's
 * http_post tool) simply get no embedding row, same as embedDecisionIfExternal
 * already no-ops without one.
 */
export async function evaluateExternalText(
  admin: AnyAdmin,
  params: {
    userId: string;
    agentId: string | null;
    apiKeyId: string | null;
    isTest: boolean;
    sourceModel: string;
    content: string;
    /** Passed straight through to createPendingApproval on a hard-rule require_approval match. */
    origin: "agent-runtime" | "external-api";
  },
): Promise<TextReviewResult> {
  const { userId, agentId, apiKeyId, isTest, sourceModel, content, origin } = params;

  // GAP 4: computed once up front and attached to every return below --
  // an agent, when present, is always the governing entity; otherwise it's
  // the calling api key (mirrors control-gate.ts's own resolveRuleEntity
  // precedence).
  const trustScoreEntity: { kind: "agent" | "api_key"; id: string } | null =
    agentId ? { kind: "agent", id: agentId } : apiKeyId ? { kind: "api_key", id: apiKeyId } : null;
  const entityTrustScore: TrustScoreReport | null = trustScoreEntity
    ? computeEntityTrustScore(await gatherTrustScoreInput(admin, userId, trustScoreEntity.kind, trustScoreEntity.id))
    : null;

  const killCheck = await checkKillSwitches(admin, userId, agentId);
  if (killCheck.killed) {
    const decisionId = await logTextGateDecision(admin, {
      userId, agentId, apiKeyId, isTest, sourceModel, content,
      decision: `BLOCK text_review (${sourceModel})`, reasoning: killCheck.reason ?? "Kill switch active.",
      source: killCheck.source ?? "kill_switch", escalated: false,
    });
    const evalRow = await recordEvaluation(admin, {
      user_id: userId, api_key_id: apiKeyId, agent_id: agentId, source_model: sourceModel,
      content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: null,
      action_type: TEXT_REVIEW_ACTION_TYPE, action_provider: sourceModel, decision_id: decisionId,
      verdict: "block", trust_score: 0, matches: [], summary: killCheck.reason,
    });
    return {
      verdict: "block", output: null, trustScore: 0, matches: [], summary: killCheck.reason ?? "Kill switch active.",
      evaluationId: evalRow?.id ?? null, evaluatedAt: evalRow?.created_at ?? null, criteria: "inner_control_gate_v1",
      entityTrustScore,
    };
  }

  const hardRuleMatch = await matchHardRule(admin, userId, TEXT_REVIEW_ACTION_TYPE, sourceModel, agentId, apiKeyId);
  if (hardRuleMatch.rule) {
    const rule = hardRuleMatch.rule;
    const blocking = rule.effect === "always_block";
    const why = rule.rationale ? ` Why this rule exists: ${rule.rationale}` : "";
    const reason = blocking
      ? `Blocked by your hard rule: "${rule.rule_text}".${why} This was enforced by your rule, not judged by the model.`
      : `Your hard rule requires approval first: "${rule.rule_text}".${why} Nothing was returned — approve it explicitly to proceed.`;
    const decisionId = await logTextGateDecision(admin, {
      userId, agentId, apiKeyId, isTest, sourceModel, content,
      decision: `${blocking ? "BLOCK" : "APPROVAL_REQUIRED"} text_review (${sourceModel})`, reasoning: reason,
      source: "hard_rule", escalated: !blocking, hardRuleId: rule.id, policyVersion: hardRuleMatch.policyVersion,
    });

    if (blocking) {
      await sendCriticalAlert(admin, userId, {
        event: "hard_rule_block",
        summary: `An external AI's text output was blocked by the hard rule "${rule.rule_text}". Nothing was scored or returned.`,
        decisionId, actionType: TEXT_REVIEW_ACTION_TYPE, provider: sourceModel,
      });
      const evalRow = await recordEvaluation(admin, {
        user_id: userId, api_key_id: apiKeyId, agent_id: agentId, source_model: sourceModel,
        content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: null,
        action_type: TEXT_REVIEW_ACTION_TYPE, action_provider: sourceModel, decision_id: decisionId,
        verdict: "block", trust_score: 0, matches: [], summary: reason,
      });
      return {
        verdict: "block", output: null, trustScore: 0, matches: [], summary: reason,
        evaluationId: evalRow?.id ?? null, evaluatedAt: evalRow?.created_at ?? null, criteria: "inner_control_gate_v1",
        entityTrustScore,
      };
    }

    const outcome = await createPendingApproval(admin, {
      userId, decisionId, agentId, actionType: TEXT_REVIEW_ACTION_TYPE, provider: sourceModel,
      description: content, reason, riskTier: "high", origin,
      apiKeyId, requiredApprovals: rule.required_approvals ?? undefined,
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
      user_id: userId, api_key_id: apiKeyId, agent_id: agentId, source_model: sourceModel,
      content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: outputText,
      action_type: TEXT_REVIEW_ACTION_TYPE, action_provider: sourceModel, decision_id: decisionId,
      verdict, trust_score: trustScore, matches: [], summary,
    });
    return {
      verdict, output: outputText, trustScore, matches: [], summary,
      evaluationId: evalRow?.id ?? null, evaluatedAt: evalRow?.created_at ?? null,
      approvalId: outcome.approvalId, criteria: "inner_control_gate_v1",
      entityTrustScore,
    };
  }

  const rules = await loadSafetyRules(admin, userId, agentId, apiKeyId);
  const scan = scanWithRules(rules, content, "");
  const verdict = decideVerdict(scan.matches);
  const trustScore = computeTrustScore(scan.matches);
  const outputText = verdict === "allow"
    ? content
    : verdict === "modify"
      ? redactContent(content, scan.matches.map((m) => ({ pattern: m.pattern, category: m.category })))
      : null;
  const summary = scan.summary ?? "No safety-criteria issues found in this external output.";

  let textDecisionId: string | null = null;
  if (verdict !== "allow") {
    textDecisionId = await logTextGateDecision(admin, {
      userId, agentId, apiKeyId, isTest, sourceModel, content,
      decision: `${verdict.toUpperCase()} text_review (${sourceModel})`, reasoning: summary,
      source: "safety_scanner", escalated: verdict === "escalate",
    });
    if (textDecisionId) {
      await embedDecisionIfExternal(admin, {
        decisionId: textDecisionId, apiKeyId, userId,
        actionType: TEXT_REVIEW_ACTION_TYPE, provider: sourceModel, description: content, params: null,
      });
    }
  }

  const evalRow = await recordEvaluation(admin, {
    user_id: userId, api_key_id: apiKeyId, agent_id: agentId, source_model: sourceModel,
    content_kind: "text", input_excerpt: content.slice(0, 4000), output_text: outputText,
    decision_id: textDecisionId, verdict, trust_score: trustScore, matches: scan.matches, summary,
  });

  return {
    verdict, output: outputText, trustScore, matches: scan.matches, summary,
    evaluationId: evalRow?.id ?? null, evaluatedAt: evalRow?.created_at ?? null,
    criteria: "inner_control_safety_rules_v1",
    entityTrustScore,
  };
}
