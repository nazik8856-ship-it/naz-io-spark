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

    // Business context for the FIT check — latest profile for this user.
    const { data: profile } = await supabase
      .from("business_profiles")
      .select("company_name, one_liner, industry, tone, audience, offers, channels, inferred_kpis")
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const profileBlock = profile
      ? [
          `company: ${(profile as Record<string, unknown>).company_name ?? "unknown"}`,
          `what they do: ${(profile as Record<string, unknown>).one_liner ?? "unknown"}`,
          `industry: ${(profile as Record<string, unknown>).industry ?? "unknown"}`,
          `audience: ${(profile as Record<string, unknown>).audience ?? "unknown"}`,
          `tone: ${(profile as Record<string, unknown>).tone ?? "unknown"}`,
          `offers: ${JSON.stringify((profile as Record<string, unknown>).offers ?? []).slice(0, 800)}`,
          `channels: ${JSON.stringify((profile as Record<string, unknown>).channels ?? []).slice(0, 500)}`,
          `priorities/KPIs: ${JSON.stringify((profile as Record<string, unknown>).inferred_kpis ?? []).slice(0, 800)}`,
        ].join("\n")
      : "(no business profile on file — treat fit as 'unclear' unless the action is obviously generic and harmless)";

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
              "Do three checks, honestly — never assume an action is safe or useful:\n" +
              "1) INTENT: does the action_type + params actually accomplish the stated description? " +
              "matches / partial / mismatch.\n" +
              "2) RISK: low / medium / high. High = irreversible, external-facing, or mass-audience " +
              "(e.g. emailing all customers, posting publicly, deleting data).\n" +
              "3) FIT: given the BUSINESS PROFILE below, does this action genuinely serve the org's " +
              "CURRENT priorities and constraints? fits / unclear / not_a_fit. Not_a_fit means it's " +
              "technically safe but a distraction, off-audience, off-channel, or premature for where " +
              "this business is right now. If not_a_fit, fill in why_not_now, what_would_change_it, " +
              "improvement_steps (concrete), and reconsider_when — otherwise leave those empty.\n" +
              "Give a confidence score 0-100 for your own assessment, plain-language reasoning, " +
              "and a safer narrowed 'modification' if the action should be tightened before running.\n" +
              "Always call the check_action tool.\n\n" +
              `BUSINESS PROFILE:\n${profileBlock}`,
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
    const fit = ["fits", "unclear", "not_a_fit"].includes(String(parsed.fit_assessment))
      ? String(parsed.fit_assessment) : "unclear";
    const conf = readConfidence(parsed);
    const alternatives = normalizeAlternatives(parsed.alternatives);
    const threshold = thresholdForRisk(riskTier, baseThreshold);
    const escalated = shouldEscalate(conf.score, threshold);
    const modification = String(parsed.modification || "").trim();
    const reasoning = String(parsed.reasoning || "").trim();

    // ---- Verdict ----------------------------------------------------------
    let decision: "allow" | "modify" | "block" | "deferred";
    let reason: string;
    if (fit === "not_a_fit") {
      decision = "deferred";
      reason = "This doesn't serve what your business is working on right now, so it's parked rather than run.";
    } else if (intentMatch === "mismatch" || (riskTier === "high" && escalated)) {
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

    const improvementSteps = Array.isArray(parsed.improvement_steps)
      ? (parsed.improvement_steps as unknown[]).map((s) => String(s).slice(0, 240)).slice(0, 6)
      : [];
    const deferred = decision === "deferred"
      ? {
          why_not_now: String(parsed.why_not_now || "It doesn't line up with what your business needs right now.").slice(0, 400),
          what_would_change_it: String(parsed.what_would_change_it || "A clearer business reason, or the right setup being in place.").slice(0, 400),
          improvement_steps: improvementSteps.length
            ? improvementSteps
            : ["Tie this action to a current priority or KPI before running it."],
          reconsider_when: String(parsed.reconsider_when || "Revisit once the goal or setup changes.").slice(0, 400),
        }
      : null;

    const decisionId = await logDecision(supabase, { userId, agentId, runId }, {
      decision: `${decision.toUpperCase()} ${actionType} (${provider})`,
      reasoning: `${reason}\n${reasoning}`,
      alternatives,
      score: conf.score,
      stepIndex,
      escalated,
      source: "model",
    });

    // ---- Real execution on ALLOW -----------------------------------------
    // An "allow" is only meaningful if the action can actually be carried out.
    // We check the capability registry for a real, verified executor whose
    // provider is genuinely connected, and if one exists we RUN IT for real
    // and report the verified result. Otherwise we say plainly that only the
    // assessment happened.
    let executed = false;
    let execution: Record<string, unknown> | null = null;
    let executionNote: string | null = null;

    if (decision === "allow") {
      const cap = CAPABILITY_REGISTRY[actionType];
      const { data: conns } = await supabase
        .from("agent_integrations")
        .select("provider")
        .eq("user_id", userId)
        .eq("status", "connected");
      const connected = ((conns || []) as { provider: string }[]).map((c) => c.provider);
      const offer = canOfferTool(actionType, connected);

      if (!cap || !offer.offerable) {
        executionNote = offer && !("offerable" in offer && offer.offerable)
          ? `Assessment only — the action was NOT carried out. ${(offer as { message?: string }).message ?? ""}`.trim()
          : `Assessment only — "${actionType}" has no real executor in NazAI yet, so nothing was actually done.`;
      } else if (!PROVIDER_WRITE_KINDS.has(actionType)) {
        executionNote =
          `Assessment only — "${actionType}" is real, but it runs inside an agent run (agent-runtime), ` +
          `not from the control engine. Approve it on the agent to actually execute it.`;
      } else {
        try {
          const result = await runProviderWrite(actionType, supabase, userId, agentId || "", params as Record<string, unknown>);
          executed = result.ok;
          execution = {
            ok: result.ok,
            summary: result.summary,
            url: result.url ?? null,
            ref: result.ref ?? null,
            target: result.target ?? null,
            verification: result.ok ? (cap.verification || null) : null,
          };
          executionNote = result.ok
            ? `Action was really carried out and verified: ${cap.verification || "provider confirmed"}.`
            : `Approved, but the action FAILED when run: ${result.summary}`;
        } catch (err) {
          executed = false;
          execution = { ok: false, summary: String((err as Error)?.message || err), url: null, ref: null, target: null, verification: null };
          executionNote = `Approved, but running the action threw an error: ${execution.summary}`;
        }
      }
    } else {
      executionNote = `Not executed — decision is "${decision}".`;
    }

    return json({
      decision_id: decisionId,
      decision,
      reason,
      reasoning,
      action_type: actionType,
      provider,
      intent_match: intentMatch,
      risk_tier: riskTier,
      fit_assessment: fit,
      confidence_score: conf.score,
      confidence_label: conf.label,
      threshold,
      escalated,
      modification: modification || null,
      alternatives,
      deferred,
      executed,
      execution,
      execution_note: executionNote,
    });


  } catch (e) {
    return json({ error: "unexpected", message: String((e as Error)?.message || e) }, 500);
  }
});
