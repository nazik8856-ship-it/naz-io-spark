// Control Engine — structured gate for a single proposed action.
// Input: { action_type, provider, description, params, agentId?, runId?, stepIndex? }
// Runs an intent check (matches/partial/mismatch) and a risk check
// (low/medium/high), scores confidence with the SHARED decision-scoring
// helpers agent-runtime uses, returns Allow / Modify / Block, and logs every
// verdict to agent_decisions.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  readConfidence,
  normalizeAlternatives,
  logDecision,
  thresholdForRisk,
  shouldEscalate,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../_shared/decision-scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const CHECK_TOOL = {
  type: "function",
  function: {
    name: "check_action",
    description: "Intent-check, risk-check and fit-check a proposed AI action.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent_match: {
          type: "string",
          enum: ["matches", "partial", "mismatch"],
          description: "Does the action_type/params actually do what the description says?",
        },
        risk_tier: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "high = irreversible, external-facing, or mass-audience",
        },
        fit_assessment: {
          type: "string",
          enum: ["fits", "unclear", "not_a_fit"],
          description:
            "Does this action genuinely serve the org's CURRENT priorities and constraints, given the business profile?",
        },
        confidence_score: { type: "number", description: "0-100 confidence in this assessment" },
        reasoning: { type: "string", description: "Plain-language reasoning, no jargon." },
        alternatives: { type: "array", items: { type: "string" } },
        modification: {
          type: "string",
          description: "A safer narrowed variant of the action, or empty string if none needed.",
        },
        why_not_now: {
          type: "string",
          description: "If not_a_fit: why this doesn't serve the business right now. Else empty.",
        },
        what_would_change_it: {
          type: "string",
          description: "If not_a_fit: what would need to be true for this to be worth doing. Else empty.",
        },
        improvement_steps: {
          type: "array",
          items: { type: "string" },
          description: "If not_a_fit: concrete steps that would make this action worthwhile. Else empty array.",
        },
        reconsider_when: {
          type: "string",
          description: "If not_a_fit: the trigger or timing to revisit this. Else empty.",
        },
      },
      required: [
        "intent_match", "risk_tier", "fit_assessment", "confidence_score",
        "reasoning", "alternatives", "modification",
        "why_not_now", "what_would_change_it", "improvement_steps", "reconsider_when",
      ],
    },
  },
};


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const actionType = String(body?.action_type || "").trim();
    const provider = String(body?.provider || "unknown").trim() || "unknown";
    const description = String(body?.description || "").trim();
    const params = body?.params ?? {};
    const agentId: string | null = body?.agentId ? String(body.agentId) : null;
    const runId: string | null = body?.runId ? String(body.runId) : null;
    const stepIndex = Number.isFinite(Number(body?.stepIndex)) ? Number(body.stepIndex) : undefined;

    if (!actionType) return json({ error: "action_type required" }, 400);
    if (!description) return json({ error: "description required" }, 400);

    // Per-agent threshold, same as agent-runtime.
    let baseThreshold = DEFAULT_CONFIDENCE_THRESHOLD;
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents").select("confidence_threshold, user_id").eq("id", agentId).maybeSingle();
      if (agent && (agent as { user_id?: string }).user_id !== userId) {
        return json({ error: "Not authorized for this agent" }, 403);
      }
      const t = Number((agent as { confidence_threshold?: number } | null)?.confidence_threshold);
      if (Number.isFinite(t)) baseThreshold = Math.max(0, Math.min(100, Math.round(t)));
    }

    const res = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        tools: [CHECK_TOOL],
        tool_choice: { type: "function", function: { name: "check_action" } },
        messages: [
          {
            role: "system",
            content:
              "You are the Control Engine. You review ONE proposed AI action before it runs.\n" +
              "Do two checks, honestly — never assume an action is safe:\n" +
              "1) INTENT: does the action_type + params actually accomplish the stated description? " +
              "matches / partial / mismatch.\n" +
              "2) RISK: low / medium / high. High = irreversible, external-facing, or mass-audience " +
              "(e.g. emailing all customers, posting publicly, deleting data).\n" +
              "Give a confidence score 0-100 for your own assessment, plain-language reasoning, " +
              "and a safer narrowed 'modification' if the action should be tightened before running.\n" +
              "Always call the check_action tool.",
          },
          {
            role: "user",
            content:
              `action_type: ${actionType}\n` +
              `provider: ${provider}\n` +
              `description (what the user intends): ${description}\n` +
              `params: ${JSON.stringify(params).slice(0, 4000)}`,
          },
        ],
      }),
    });

    if (res.status === 429) return json({ error: "rate_limited", message: "Too many requests right now — try again in a moment." }, 429);
    if (res.status === 402) return json({ error: "payment_required", message: "AI credits are exhausted. Add credits to continue." }, 402);
    if (!res.ok) return json({ error: "gateway_error", message: (await res.text()).slice(0, 400) }, 502);

    const data = await res.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(call?.function?.arguments || "{}"); } catch { /* fall through */ }

    const riskTier = ["low", "medium", "high"].includes(String(parsed.risk_tier))
      ? String(parsed.risk_tier) : "medium";
    const intentMatch = ["matches", "partial", "mismatch"].includes(String(parsed.intent_match))
      ? String(parsed.intent_match) : "partial";
    const conf = readConfidence(parsed);
    const alternatives = normalizeAlternatives(parsed.alternatives);
    const threshold = thresholdForRisk(riskTier, baseThreshold);
    const escalated = shouldEscalate(conf.score, threshold);
    const modification = String(parsed.modification || "").trim();
    const reasoning = String(parsed.reasoning || "").trim();

    // ---- Verdict ----------------------------------------------------------
    let decision: "allow" | "modify" | "block";
    let reason: string;
    if (intentMatch === "mismatch" || (riskTier === "high" && escalated)) {
      decision = "block";
      reason = intentMatch === "mismatch"
        ? "What this action does doesn't match what you asked for, so it's blocked."
        : `High-risk action with only ${conf.score}% confidence (needs ${threshold}%). Blocked until a human signs off.`;
    } else if (escalated || modification) {
      decision = "modify";
      reason = modification
        ? `Safer as: ${modification}`
        : `Confidence is ${conf.score}% against a ${threshold}% bar for ${riskTier} risk — run a narrowed-down version first.`;
    } else {
      decision = "allow";
      reason = `Matches your intent, ${riskTier} risk, ${conf.score}% confidence — safe to run.`;
    }

    const decisionId = await logDecision(supabase, { userId, agentId, runId }, {
      decision: `${decision.toUpperCase()} ${actionType} (${provider})`,
      reasoning: `${reason}\n${reasoning}`,
      alternatives,
      score: conf.score,
      stepIndex,
      escalated,
      source: "model",
    });

    return json({
      decision_id: decisionId,
      decision,
      reason,
      reasoning,
      action_type: actionType,
      provider,
      intent_match: intentMatch,
      risk_tier: riskTier,
      confidence_score: conf.score,
      confidence_label: conf.label,
      threshold,
      escalated,
      modification: modification || null,
      alternatives,
    });
  } catch (e) {
    return json({ error: "unexpected", message: String((e as Error)?.message || e) }, 500);
  }
});
