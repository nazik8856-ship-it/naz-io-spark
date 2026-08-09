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
import { CAPABILITY_REGISTRY, canOfferTool } from "../_shared/capability-registry.ts";
import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";

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

    // ---- GET /control-engine/decisions/:id ----------------------------------
    // Standalone, auditable record of one decision: reasoning, scores,
    // provenance, and any real execution outcome recorded against it.
    const url = new URL(req.url);
    const auditMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/?$/);
    if (req.method === "GET" && auditMatch) {
      const decisionId = auditMatch[1];
      const { data: decision, error: dErr } = await supabase
        .from("agent_decisions")
        .select("*")
        .eq("id", decisionId)
        .maybeSingle();
      if (dErr) return json({ error: dErr.message }, 500);
      if (!decision) return json({ error: "Decision not found" }, 404);
      if ((decision as { user_id?: string }).user_id !== userId) {
        return json({ error: "Not authorized for this decision" }, 403);
      }

      const [{ data: outcomes }, { data: overrides }] = await Promise.all([
        supabase.from("decision_outcomes").select("*").eq("decision_id", decisionId)
          .order("created_at", { ascending: false }),
        supabase.from("agent_decisions").select("id, decision, reasoning, source, created_at")
          .eq("override_of", decisionId).order("created_at", { ascending: true }),
      ]);

      const d = decision as Record<string, unknown>;
      return json({
        record_type: "control_decision",
        immutable: true,
        id: d.id,
        created_at: d.created_at,
        decision: d.decision,
        reasoning: d.reasoning,
        confidence_score: d.confidence_score,
        alternatives_considered: d.alternatives_considered,
        escalated: d.escalated,
        human_response: d.human_response,
        source: d.source,
        rule_enforced: d.source === "hard_rule",
        model_judged: d.source === "model",
        kill_switch: d.source === "kill_switch",
        agent_id: d.agent_id,
        agent_run_id: d.agent_run_id,
        step_index: d.step_index,
        override_of: d.override_of,
        overridden_by: overrides ?? [],
        execution_outcomes: outcomes ?? [],
      });
    }
    // -------------------------------------------------------------------------

    if (req.method === "GET") return json({ error: "Unsupported GET path" }, 404);



    const body = await req.json().catch(() => ({}));
    const actionType = String(body?.action_type || "").trim();
    const provider = String(body?.provider || "unknown").trim() || "unknown";
    const description = String(body?.description || "").trim();

    // ---- DAILY AI SPEND CAP -------------------------------------------------
    // A cap trip from a previous UTC day clears itself here; today's cap is
    // enforced below via the kill switch it sets.
    await clearExpiredSpendKillSwitch(supabase, userId);
    const spendStatus = await getSpendStatus(supabase, userId);

    // ---- GLOBAL KILL SWITCH -------------------------------------------------
    // Hard stop BEFORE any LLM call, scoring or execution.
    const { data: killRow } = await supabase
      .from("profiles").select("kill_switch, kill_switch_source").eq("id", userId).maybeSingle();
    if ((killRow as { kill_switch?: boolean } | null)?.kill_switch || spendStatus.over_cap) {

      const reason = "Blocked — kill switch active. All AI actions are halted for this account.";
      await supabase.from("agent_decisions").insert({
        user_id: userId,
        agent_id: body?.agentId ? String(body.agentId) : null,
        decision: "block",
        reasoning: reason,
        alternatives_considered: [],
        confidence_score: 100,
        source: "kill_switch",
        escalated: false,
      });
      return json({
        decision_id: null,
        decision: "block",
        reason,
        reasoning: reason,
        confidence_score: 100,
        confidence_label: "certain",
        threshold: 100,
        escalated: false,
        action_type: actionType || "unknown",
        provider,
        risk_tier: "high",
        intent_match: "n/a",
        fit_assessment: "n/a",
        alternatives: [],
        deferred: null,
        kill_switch: true,
        executed: false,
        execution: null,
        execution_note: "Nothing was assessed or run — the kill switch is on.",
      });
    }
    // -------------------------------------------------------------------------
    const params = body?.params ?? {};
    // Dry run: full intent/risk/fit scoring, but never touch a real provider.
    const dryRun = body?.dry_run === true || body?.dry_run === "true";
    const agentId: string | null = body?.agentId ? String(body.agentId) : null;
    const runId: string | null = body?.runId ? String(body.runId) : null;
    const stepIndex = Number.isFinite(Number(body?.stepIndex)) ? Number(body.stepIndex) : undefined;

    if (!actionType) return json({ error: "action_type required" }, 400);
    if (!description) return json({ error: "description required" }, 400);

    // ---- HARD RULES ---------------------------------------------------------
    // Deterministic, user-authored rules. Evaluated BEFORE any LLM call: if a
    // rule matches, its effect is applied immediately and the model is never
    // consulted. Logged as rule-enforced (source: hard_rule), not model-judged.
    const globToRe = (p: string) =>
      new RegExp("^" + p.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
    const { data: hardRules } = await supabase
      .from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider, enabled")
      .eq("user_id", userId)
      .eq("enabled", true);

    type HardRule = {
      id: string; rule_text: string; action_type_pattern: string;
      effect: "always_block" | "always_require_approval"; provider: string | null;
    };
    const matched = ((hardRules ?? []) as HardRule[]).find((r) => {
      if (r.provider && r.provider.toLowerCase() !== provider.toLowerCase()) return false;
      try { return globToRe(r.action_type_pattern || "*").test(actionType); } catch { return false; }
    });

    if (matched) {
      const blocking = matched.effect === "always_block";
      const reason = blocking
        ? `Blocked by your hard rule: "${matched.rule_text}". This was enforced by your rule, not judged by the model.`
        : `Your hard rule requires approval first: "${matched.rule_text}". Nothing ran — approve it explicitly to proceed.`;
      const { data: logged } = await supabase.from("agent_decisions").insert({
        user_id: userId,
        agent_id: agentId,
        agent_run_id: runId,
        step_index: stepIndex ?? null,
        decision: blocking ? "block" : "modify",
        reasoning: reason,
        alternatives_considered: [],
        confidence_score: 100,
        source: "hard_rule",
        escalated: !blocking,
      }).select("id").maybeSingle();

      return json({
        decision_id: (logged as { id?: string } | null)?.id ?? null,
        decision: blocking ? "block" : "modify",
        reason,
        reasoning: reason,
        confidence_score: 100,
        confidence_label: "certain",
        threshold: 100,
        escalated: !blocking,
        action_type: actionType,
        provider,
        risk_tier: "high",
        intent_match: "n/a",
        fit_assessment: "n/a",
        alternatives: [],
        deferred: null,
        rule_enforced: true,
        hard_rule: { id: matched.id, rule_text: matched.rule_text, effect: matched.effect },
        model_judged: false,
        executed: false,
        execution: null,
        execution_note: "No model scoring ran — a hard rule decided this outright.",
      });
    }
    // -------------------------------------------------------------------------

    // ---- CIRCUIT BREAKER (per action_type, automatic) -----------------------
    // Tracks the last 10 attempts for this action_type. If more than half of
    // them failed (blocked or errored), the breaker trips and every further
    // attempt of that action_type is auto-blocked until manually reset.
    // Separate from the kill switch: automatic, and scoped to one action_type.
    const BREAKER_WINDOW = 10;
    const BREAKER_MIN_ATTEMPTS = 4;
    const BREAKER_FAIL_RATE = 0.5;

    type Breaker = {
      id: string; recent_outcomes: string[]; tripped: boolean;
      trip_count: number; tripped_at: string | null; failure_rate: number; last_reason: string | null;
    };
    const { data: breakerRow } = await supabase
      .from("circuit_breakers")
      .select("id, recent_outcomes, tripped, trip_count, tripped_at, failure_rate, last_reason")
      .eq("user_id", userId)
      .eq("action_type", actionType)
      .maybeSingle();
    const breaker = (breakerRow as Breaker | null) ?? null;

    if (breaker?.tripped) {
      const reason =
        `Blocked — the circuit breaker for "${actionType}" is tripped. ` +
        `${Math.round((breaker.failure_rate ?? 0) * 100)}% of the last ${BREAKER_WINDOW} attempts failed or were blocked, ` +
        `so this action type is paused until you reset it.`;
      const { data: logged } = await supabase.from("agent_decisions").insert({
        user_id: userId,
        agent_id: agentId,
        agent_run_id: runId,
        step_index: stepIndex ?? null,
        decision: `BLOCK ${actionType} (${provider})`,
        reasoning: reason,
        alternatives_considered: [],
        confidence_score: 100,
        source: "circuit_breaker",
        escalated: false,
      }).select("id").maybeSingle();

      return json({
        decision_id: (logged as { id?: string } | null)?.id ?? null,
        decision: "block",
        reason,
        reasoning: reason,
        confidence_score: 100,
        confidence_label: "certain",
        threshold: 100,
        escalated: false,
        action_type: actionType,
        provider,
        risk_tier: "high",
        intent_match: "n/a",
        fit_assessment: "n/a",
        alternatives: [],
        deferred: null,
        circuit_breaker: {
          tripped: true,
          action_type: actionType,
          failure_rate: breaker.failure_rate,
          tripped_at: breaker.tripped_at,
          trip_count: breaker.trip_count,
          reset_hint: "Reset it in the Control System breaker panel to allow this action type again.",
        },
        model_judged: false,
        executed: false,
        execution: null,
        execution_note: "No model scoring or execution ran — the circuit breaker for this action type is open.",
      });
    }

    // Records this attempt into the rolling window and trips if needed.
    const recordBreakerAttempt = async (failed: boolean, why: string) => {
      try {
        const window = [...(breaker?.recent_outcomes ?? []), failed ? "fail" : "ok"].slice(-BREAKER_WINDOW);
        const failures = window.filter((o) => o === "fail").length;
        const rate = window.length ? failures / window.length : 0;
        const shouldTrip = window.length >= BREAKER_MIN_ATTEMPTS && rate > BREAKER_FAIL_RATE;
        const payload = {
          user_id: userId,
          action_type: actionType,
          recent_outcomes: window,
          attempts: window.length,
          failures,
          failure_rate: Number(rate.toFixed(3)),
          tripped: shouldTrip,
          tripped_at: shouldTrip ? new Date().toISOString() : null,
          trip_count: (breaker?.trip_count ?? 0) + (shouldTrip ? 1 : 0),
          last_reason: failed ? why.slice(0, 400) : null,
          last_attempt_at: new Date().toISOString(),
        };
        await supabase.from("circuit_breakers").upsert(payload, { onConflict: "user_id,action_type" });

        if (shouldTrip) {
          const tripReason =
            `Circuit breaker tripped for "${actionType}" — ${failures} of the last ${window.length} attempts ` +
            `failed or were blocked (${Math.round(rate * 100)}%). This action type is now auto-blocked until reset. ` +
            `Last failure: ${why.slice(0, 200)}`;
          await supabase.from("agent_decisions").insert({
            user_id: userId,
            agent_id: agentId,
            agent_run_id: runId,
            decision: `CIRCUIT_BREAKER_TRIPPED ${actionType} (${provider})`,
            reasoning: tripReason,
            alternatives_considered: [],
            confidence_score: 100,
            source: "circuit_breaker_trip",
            escalated: true,
          });
        }
      } catch (_) { /* breaker bookkeeping must never break the response */ }
    };
    // -------------------------------------------------------------------------




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

    if (dryRun) {
      executed = false;
      execution = null;
      executionNote = "dry run — not carried out";
    } else if (decision === "allow") {
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

    // ---- Shared brain: record the real outcome of the decision -------------
    // Same two tables the rest of NazAI uses — agent_decisions (above) and
    // decision_outcomes here. No parallel store.
    if (decisionId && execution) {
      try {
        await supabase.from("decision_outcomes").insert({
          user_id: userId,
          decision_id: decisionId,
          agent_id: agentId,
          provider,
          linked_metric: `action_executed:${actionType}`,
          baseline_value: 0,
          result_value: executed ? 1 : 0,
          delta: executed ? 1 : 0,
          delta_pct: null,
          direction: executed ? "up" : "flat",
          window_days: 0,
          evidence: {
            source: "control-engine",
            action_type: actionType,
            provider,
            executed,
            summary: execution.summary ?? null,
            url: execution.url ?? null,
            ref: execution.ref ?? null,
            target: execution.target ?? null,
            verification: execution.verification ?? null,
            confidence_score: conf.score,
            risk_tier: riskTier,
          },
          measured_at: new Date().toISOString(),
        });
      } catch (_) { /* provenance must never break the response */ }
    }

    // Feed this attempt to the per-action circuit breaker (dry runs don't count).
    let breakerState: Record<string, unknown> | null = null;
    if (!dryRun) {
      const failed = decision === "block" || (execution ? !executed : false);
      const why = decision === "block"
        ? `blocked: ${reason}`
        : execution && !executed
          ? `execution failed: ${String(execution.summary ?? "unknown error")}`
          : "ok";
      await recordBreakerAttempt(failed, why);
      const { data: after } = await supabase
        .from("circuit_breakers")
        .select("tripped, failure_rate, attempts, failures, trip_count, tripped_at")
        .eq("user_id", userId)
        .eq("action_type", actionType)
        .maybeSingle();
      breakerState = (after as Record<string, unknown> | null) ?? null;
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
      dry_run: dryRun,
      execution,
      execution_note: executionNote,
      circuit_breaker: breakerState,

    });


  } catch (e) {
    return json({ error: "unexpected", message: String((e as Error)?.message || e) }, 500);
  }
});
