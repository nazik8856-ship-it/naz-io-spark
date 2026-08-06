// AI Control System — the shared decision engine, reachable from chat.
// Input: { message: string, agentId?: string }
// Parses a proposed AI action with structured LLM output, scores risk +
// confidence with the same helpers agent-runtime uses, returns one structured
// verdict and logs it to agent_decisions (same table, same history).
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

// Structured output contract (mirrors the Zod-shaped schemas used elsewhere in
// the agent engine — enforced here as a strict tool schema on the gateway).
const ASSESS_TOOL = {
  type: "function",
  function: {
    name: "assess_action",
    description: "Parse and assess a proposed AI action.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action_type: { type: "string", description: "e.g. send_email, post_message, update_product" },
        provider: { type: "string", description: "Gmail, Slack, Notion, Shopify, Canva, Figma, Google, or 'unknown'" },
        risk_tier: { type: "string", enum: ["low", "medium", "high"] },
        intent_match: { type: "string", enum: ["matches", "partial", "mismatch"] },
        fit_assessment: { type: "string", enum: ["fits", "unclear", "not_a_fit"] },
        reasoning: { type: "string", description: "Plain-language reasoning, no jargon." },
        alternatives: { type: "array", items: { type: "string" } },
        confidence_score: { type: "number", description: "0-100 self-reported confidence" },
        modification: { type: "string", description: "Safer variant if the action should be modified, else empty" },
        why_not_now: { type: "string" },
        what_would_change_it: { type: "string" },
        reconsider_when: { type: "string" },
      },
      required: [
        "action_type", "provider", "risk_tier", "intent_match", "fit_assessment",
        "reasoning", "alternatives", "confidence_score", "modification",
        "why_not_now", "what_would_change_it", "reconsider_when",
      ],
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    const agentId: string | null = body?.agentId ? String(body.agentId) : null;
    if (!message) return json({ error: "message required" }, 400);

    // Per-agent threshold when the action belongs to a known agent.
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
        messages: [
          {
            role: "system",
            content:
              "You are the AI Control System. The user describes a proposed AI action. " +
              "Assess it honestly: never assume an action is safe, never invent capabilities. " +
              "Judge whether it matches the stated intent, whether it fits this business at all, " +
              "and how risky it is (high = irreversible, external-facing, or mass-audience). " +
              "Write every explanation in plain everyday language. Always call assess_action.",
          },
          { role: "user", content: message },
        ],
        tools: [ASSESS_TOOL],
        tool_choice: { type: "function", function: { name: "assess_action" } },
      }),
    });

    if (res.status === 429) return json({ error: "rate_limited", message: "Too many requests right now — try again in a moment." }, 429);
    if (res.status === 402) return json({ error: "payment_required", message: "AI credits are exhausted. Add credits to continue." }, 402);
    if (!res.ok) return json({ error: "gateway_error", message: (await res.text()).slice(0, 400) }, 502);

    const data = await res.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(call?.function?.arguments || "{}"); } catch { /* fall through */ }
    if (!parsed.action_type) return json({ error: "parse_failed", message: "Couldn't read that as a proposed action. Describe what the AI wants to do." }, 422);

    const riskTier = ["low", "medium", "high"].includes(String(parsed.risk_tier)) ? String(parsed.risk_tier) : "medium";
    const intentMatch = String(parsed.intent_match || "partial");
    const fit = String(parsed.fit_assessment || "unclear");
    const conf = readConfidence(parsed);
    const alternatives = normalizeAlternatives(parsed.alternatives);
    const threshold = thresholdForRisk(riskTier, baseThreshold);
    const escalated = shouldEscalate(conf.score, threshold);
    const modification = String(parsed.modification || "").trim();

    // ---- Verdict ----------------------------------------------------------
    let decision: "allow" | "modify" | "block" | "deferred";
    let reason: string;
    if (fit === "not_a_fit") {
      decision = "deferred";
      reason = "This isn't a fit for how your business runs right now, so it's parked rather than run.";
    } else if (intentMatch === "mismatch" || (riskTier === "high" && escalated)) {
      decision = "block";
      reason = riskTier === "high" && intentMatch !== "mismatch"
        ? `High-risk action with only ${conf.score}% confidence (needs ${threshold}%). Blocked until a human signs off.`
        : "What this action does doesn't match what you asked for, so it's blocked.";
    } else if (escalated || modification) {
      decision = "modify";
      reason = modification
        ? `Safer as: ${modification}`
        : `Confidence is ${conf.score}% against a ${threshold}% bar for ${riskTier} risk — run a narrowed-down version first.`;
    } else {
      decision = "allow";
      reason = `Matches your intent, ${riskTier} risk, ${conf.score}% confidence — safe to run.`;
    }

    const deferred = decision === "deferred"
      ? {
          why_not_now: String(parsed.why_not_now || "It doesn't line up with what your business needs right now.").slice(0, 400),
          what_would_change_it: String(parsed.what_would_change_it || "A clearer business reason, or the right integration being connected.").slice(0, 400),
          reconsider_when: String(parsed.reconsider_when || "Revisit once the goal or setup changes.").slice(0, 400),
        }
      : null;

    const reasoning = String(parsed.reasoning || reason);
    const decisionText = `${decision.toUpperCase()} ${parsed.action_type} (${parsed.provider || "unknown"})`;

    const decisionId = await logDecision(supabase, { userId, agentId, runId: null }, {
      decision: decisionText,
      reasoning: `${reason}\n${reasoning}`,
      alternatives,
      score: conf.score,
      escalated,
      source: "model",
    });

    return json({
      decision_id: decisionId,
      decision,
      reason,
      reasoning,
      confidence_score: conf.score,
      confidence_label: conf.label,
      threshold,
      escalated,
      action_type: String(parsed.action_type),
      provider: String(parsed.provider || "unknown"),
      risk_tier: riskTier,
      intent_match: intentMatch,
      fit_assessment: fit,
      alternatives,
      deferred,
    });
  } catch (e) {
    return json({ error: "unexpected", message: String((e as Error)?.message || e) }, 500);
  }
});
