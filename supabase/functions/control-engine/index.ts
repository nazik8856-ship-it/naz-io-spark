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
  loadStrictness,
  irreversibleNeedsHuman,
  fitDefers,
  STRICTNESS_PRESETS,
  shouldEscalate,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../_shared/decision-scoring.ts";
import { CAPABILITY_REGISTRY, canOfferTool } from "../_shared/capability-registry.ts";
import { recordAiSpend } from "../_shared/spend-guard.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { runControlGate, createPendingApproval } from "../_shared/control-gate.ts";


import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";
import { reversibilityFor, captureUndoState, runUndo } from "../_shared/reversibility.ts";
import { replayDraft } from "../_shared/policy-replay.ts";
import { loadFitEvidence, applyFitEvidence } from "../_shared/fit-learning.ts";
import {
  collectUntrustedFields,
  scanForInjection,
  buildUntrustedBlock,
  INJECTION_SYSTEM_CLAUSE,
  UNTRUSTED_PROVIDERS,
} from "../_shared/injection-scanner.ts";


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
    // Internal server-to-server call (agent-runtime routes its tool gate here).
    // Only trusted when the caller presents the service-role key.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const internalUserId = req.headers.get("x-internal-user-id");
    const isInternal = token === serviceKey && !!internalUserId;
    const userId = userData?.user?.id ?? (isInternal ? internalUserId! : undefined);
    if (!userId) return json({ error: "Not authenticated" }, 401);


    // ---- GET /control-engine/decisions/:id ----------------------------------
    // Standalone, auditable record of one decision: reasoning, scores,
    // provenance, and any real execution outcome recorded against it.
    const url = new URL(req.url);

    // ---- GET /control-engine/decisions/:id/verify ---------------------------
    // Tamper check: recomputes the SHA-256 signature from the stored content
    // plus the server secret and reports whether it still matches.
    const verifyMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/verify\/?$/);
    if (req.method === "GET" && verifyMatch) {
      const decisionId = verifyMatch[1];
      const { data: owner } = await supabase
        .from("agent_decisions").select("user_id").eq("id", decisionId).maybeSingle();
      if (!owner) return json({ error: "Decision not found", found: false, verified: false }, 404);
      if ((owner as { user_id?: string }).user_id !== userId) {
        return json({ error: "Not authorized for this decision" }, 403);
      }
      const { data, error } = await supabase.rpc("verify_decision_signature", { _id: decisionId });
      if (error) return json({ error: error.message }, 500);
      const res = (data ?? {}) as Record<string, unknown>;
      return json(res, res.verified === true ? 200 : 409);
    }

    // ---- POST /control-engine/undo/:decision_id -----------------------------
    // Runs the REAL compensating action for a decision that was carried out,
    // and only reports success after the reversal is verified on the provider.
    const undoMatch = url.pathname.match(/\/undo\/([0-9a-fA-F-]{36})\/?$/);
    if (req.method === "POST" && undoMatch) {
      const decisionId = undoMatch[1];
      const { data: rev } = await supabase
        .from("action_reversals")
        .select("*")
        .eq("decision_id", decisionId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = rev as Record<string, unknown> | null;
      if (!row) return json({ ok: false, error: "not_found", message: "No reversible action is recorded for this decision." }, 404);
      if (row.status === "undone") {
        return json({ ok: true, already_undone: true, status: "undone", summary: row.summary ?? "Already undone." });
      }
      if (!row.reversible) {
        return json({
          ok: false, error: "irreversible", status: "unavailable",
          message: String(row.irreversible_reason || "This action cannot be undone."),
        }, 409);
      }
      const result = await runUndo(supabase, userId, String(row.agent_id || ""), {
        tool: String(row.tool),
        ref: (row.ref as string | null) ?? null,
        undo_payload: (row.undo_payload as Record<string, unknown> | null) ?? {},
      });
      await supabase.from("action_reversals").update({
        status: result.ok ? "undone" : "failed",
        summary: result.summary,
        error: result.ok ? null : result.summary,
        executed_at: new Date().toISOString(),
      }).eq("id", row.id as string);

      // The undo is itself an auditable decision, signed like every other one.
      await logDecision(supabase, { userId, agentId: (row.agent_id as string) || null, runId: (row.run_id as string) || null }, {
        decision: `${result.ok ? "UNDO" : "UNDO_FAILED"} ${row.tool} (${row.provider ?? "unknown"})`,
        reasoning: `Operator requested a reversal of decision ${decisionId}. ${result.summary}`,
        alternatives: [],
        score: result.ok ? 100 : 0,
        stepIndex: undefined,
        escalated: false,
        source: "human_override",
      });

      return json({
        ok: result.ok,
        status: result.ok ? "undone" : "failed",
        summary: result.summary,
        decision_id: decisionId,
        tool: row.tool,
      }, result.ok ? 200 : 409);
    }



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
        signature: d.signature,
        verify_url: `/control-engine/decisions/${d.id}/verify`,
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

    // ---- POST /control-engine/replay ----------------------------------------
    // Re-evaluates the 30 control scenarios against a DRAFT policy version and
    // diffs them against the active version. Deterministic layers only (hard
    // rules + safety scanner): no model calls, no writes, no provider traffic.
    if (url.pathname.replace(/\/$/, "").endsWith("/replay")) {
      const draftRef = {
        id: typeof body?.policy_version_id === "string" ? body.policy_version_id : undefined,
        version: typeof body?.version === "number" ? body.version : undefined,
      };
      if (!draftRef.id && typeof draftRef.version !== "number") {
        return json({ error: "Provide policy_version_id or version of the draft to replay." }, 400);
      }
      const report = await replayDraft(supabase, userId, draftRef);
      if ("error" in report) return json({ error: report.error }, report.status);
      return json(report);
    }

    // ---- POST /control-engine/policy/:id/activate ---------------------------
    // Activation is gated on the replay: a draft that regresses any scenario
    // the active policy currently passes cannot go live.
    const activateMatch = url.pathname.match(/\/policy\/([0-9a-fA-F-]{36})\/activate\/?$/);
    if (activateMatch) {
      const draftId = activateMatch[1];
      const report = await replayDraft(supabase, userId, { id: draftId });
      if ("error" in report) return json({ error: report.error }, report.status);
      if (!report.safe_to_activate) {
        return json({
          ok: false,
          activated: false,
          error: `Activation blocked — this draft regresses ${report.regressions.length} scenario(s) the active policy passes.`,
          replay: report,
        }, 409);
      }
      const nowIso = new Date().toISOString();
      if (report.active_version.id && report.active_version.id !== draftId) {
        await supabase.from("policy_versions")
          .update({ status: "archived" })
          .eq("id", report.active_version.id)
          .eq("user_id", userId);
      }
      const { error: actErr } = await supabase.from("policy_versions")
        .update({ status: "active", activated_at: nowIso })
        .eq("id", draftId)
        .eq("user_id", userId);
      if (actErr) return json({ ok: false, activated: false, error: actErr.message }, 500);
      return json({ ok: true, activated: true, policy_version: report.draft_version.version, replay: report });
    }

    const actionType = String(body?.action_type || "").trim();
    const provider = String(body?.provider || "unknown").trim() || "unknown";
    const description = String(body?.description || "").trim();

    // ---- SAFETY ALERT RELAY -------------------------------------------------
    // The kill-switch panel posts here after a manual flip so the notification
    // goes out server-side (Slack if connected, prominent log otherwise).
    if (body?.alert_event === "kill_switch_flip") {
      const enabled = body?.enabled === true || body?.enabled === "true";
      const via = await sendCriticalAlert(supabase, userId, {
        event: enabled ? "kill_switch_on" : "kill_switch_off",
        summary: enabled
          ? "All AI actions for this account are halted immediately. Nothing will be scored or executed until it is turned back off."
          : "The kill switch was turned off. AI actions can run again, subject to hard rules, breakers and the daily spend cap.",
        decisionId: body?.decision_id ? String(body.decision_id) : null,
        actor: body?.actor ? String(body.actor) : userData?.user?.email ?? null,
      });
      return json({ ok: true, alerted_via: via });
    }
    // -------------------------------------------------------------------------



    const params = body?.params ?? {};
    // Dry run: full intent/risk/fit scoring, but never touch a real provider.
    const dryRun = body?.dry_run === true || body?.dry_run === "true";
    // Assess-only: full gate + risk/fit/strictness scoring and decision logging,
    // but the CALLER carries out the action (agent-runtime executes it inside its
    // own run, with its own verification + artifact recording).
    const assessOnly = body?.assess_only === true || body?.assess_only === "true";
    const agentId: string | null = body?.agentId ? String(body.agentId) : null;
    const runId: string | null = body?.runId ? String(body.runId) : null;
    const stepIndex = Number.isFinite(Number(body?.stepIndex)) ? Number(body.stepIndex) : undefined;


    if (!actionType) return json({ error: "action_type required" }, 400);
    if (!description) return json({ error: "description required" }, 400);

    // ---- UNIFIED CONTROL GATE ----------------------------------------------
    // The SAME gate agent-runtime uses: spend cap, kill switch, hard rules
    // (live + shadow), circuit breaker, and the deterministic safety scanner.
    // Everything it stops is already logged to agent_decisions.
    const gate = await runControlGate(supabase, {
      userId,
      actionType,
      provider,
      description,
      params,
      agentId,
      runId,
      stepIndex: stepIndex ?? null,
      dryRun,
      origin: "control-engine",
    });
    const spendStatus = gate.spend;
    void spendStatus;

    const recordShadowHits = gate.recordShadowHits;
    const recordBreakerAttempt = gate.recordAttempt;

    if (!gate.ok) {
      const blocked = gate.verdict === "block";
      return json({
        decision_id: gate.decisionId,
        decision: blocked ? "block" : "modify",
        reason: gate.reason,
        reasoning: gate.reason,
        confidence_score: 100,
        confidence_label: "certain",
        threshold: 100,
        escalated: !blocked,
        action_type: actionType,
        provider,
        risk_tier: "high",
        intent_match: "n/a",
        fit_assessment: "n/a",
        alternatives: [],
        deferred: null,
        kill_switch: gate.killSwitch,
        spend_cap: gate.spend,
        rule_enforced: gate.source === "hard_rule",
        hard_rule: gate.hardRule,
        circuit_breaker: gate.circuitBreaker,
        safety_scan: gate.safety.matched ? gate.safety : null,
        approval_id: gate.approvalId,
        gate_source: gate.source,
        shadow_rules: gate.shadowRules,
        model_judged: false,
        executed: false,
        execution: null,
        execution_note: blocked
          ? `Nothing was assessed or run — stopped by the control gate (${gate.source}).`
          : `Nothing ran — this is queued for your approval (${gate.source}).`,
      });
    }
    const shadowMatches = gate.shadowRules;
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

    // One org-level dial that scales every tolerance below.
    const strictness = await loadStrictness(supabase, userId);

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

    // Fit/value learning: what actually happened the last times a human
    // overrode a "not a fit" verdict on a similar action.
    const fitEvidence = await loadFitEvidence(supabase, userId, {
      actionType, provider, description,
    });

    // ---- PROMPT-INJECTION HARDENING ----------------------------------------
    // Anything that came from an outside system is DATA, never instructions.
    // We (a) label + delimit it in the prompt and (b) scan it deterministically.
    const untrustedFields = collectUntrustedFields(params, provider);
    if (UNTRUSTED_PROVIDERS.has(String(provider).toLowerCase()) && description) {
      untrustedFields.push({ field: "description", text: String(description) });
    }
    const injection = scanForInjection(untrustedFields);
    const untrustedBlock = buildUntrustedBlock(untrustedFields, provider);

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
              `ORG STRICTNESS: ${STRICTNESS_PRESETS[strictness].label} — ${STRICTNESS_PRESETS[strictness].blurb} ` +
              `Grade risk and fit through that lens: on Strict, lean toward the higher risk tier and toward ` +
              `'unclear' fit when evidence is thin; on Loose, only flag genuine risk or a genuine mismatch.\n\n` +
              `BUSINESS PROFILE:\n${profileBlock}` + fitEvidence.promptBlock +
              INJECTION_SYSTEM_CLAUSE,
          },
          {
            role: "user",
            content:
              `action_type: ${actionType}\n` +
              `provider: ${provider}\n` +
              `description (what the user intends): ${description}\n` +
              `params: ${JSON.stringify(params).slice(0, 4000)}` +
              untrustedBlock +
              (injection.detected
                ? `\n\nSAFETY SCANNER NOTE (deterministic, already confirmed): ${injection.summary}`
                : ""),
          },
        ],
      }),
    });



    if (res.status === 429) return json({ error: "rate_limited", message: "Too many requests right now — try again in a moment." }, 429);
    if (res.status === 402) return json({ error: "payment_required", message: "AI credits are exhausted. Add credits to continue." }, 402);
    if (!res.ok) return json({ error: "gateway_error", message: (await res.text()).slice(0, 400) }, 502);

    const data = await res.json();
    // Meter this gateway call against the org's daily spend cap (warns at 90%,
    // auto-trips the kill switch at 100%).
    const spendAfter = await recordAiSpend(supabase, userId, MODEL, data?.usage, "control-engine");

    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(call?.function?.arguments || "{}"); } catch { /* fall through */ }

    const riskTier = ["low", "medium", "high"].includes(String(parsed.risk_tier))
      ? String(parsed.risk_tier) : "medium";
    const intentMatch = ["matches", "partial", "mismatch"].includes(String(parsed.intent_match))
      ? String(parsed.intent_match) : "partial";
    const rawFit = ["fits", "unclear", "not_a_fit"].includes(String(parsed.fit_assessment))
      ? String(parsed.fit_assessment) : "unclear";
    // Fit/value learning loop: measured outcomes of overridden "not a fit"
    // verdicts move the fit call and the confidence behind it.
    const fitApplied = applyFitEvidence(rawFit, fitEvidence);
    const fit = fitApplied.fit;
    const conf = readConfidence(parsed);
    if (fitEvidence.nudge) conf.score = Math.max(0, Math.min(100, conf.score + fitEvidence.nudge));
    const alternatives = normalizeAlternatives(parsed.alternatives);
    const threshold = thresholdForRisk(riskTier, baseThreshold, strictness);
    // Blast-radius rule: an action that CANNOT be undone and is high risk
    // always needs a human, no matter how confident the model is.
    const reversibility = reversibilityFor(actionType);
    const irreversibleHighRisk = !reversibility.reversible && irreversibleNeedsHuman(riskTier, strictness);
    let escalated = shouldEscalate(conf.score, threshold) || irreversibleHighRisk;
    const modification = String(parsed.modification || "").trim();
    const reasoning = String(parsed.reasoning || "").trim();

    // ---- Verdict ----------------------------------------------------------
    let decision: "allow" | "modify" | "block" | "deferred";
    let reason: string;
    if (fitDefers(fit, strictness)) {
      decision = "deferred";
      reason = fit === "not_a_fit"
        ? "This doesn't serve what your business is working on right now, so it's parked rather than run."
        : "On Strict, an unclear business fit is parked rather than run.";
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

    // Deterministic injection findings OVERRIDE the model: a strong signal is a
    // hard block, a suspicious one parks the action. Never downgrade a block.
    if (injection.detected) {
      const forced = injection.severity === "strong" ? "block" : "deferred";
      if (!(decision === "block" && forced === "deferred")) decision = forced;
      reason = `Possible prompt injection detected in external content — ${injection.summary}. ${
        forced === "block"
          ? "Blocked: outside content tried to give the system instructions."
          : "Parked for a human to look at before anything runs."
      }`;
      escalated = true;
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
      reasoning: `${reason}\n${reasoning}` + (injection.detected ? `\nInjection signals: ${injection.matches.map((m) => `${m.rule} in ${m.field}`).join(", ")}` : ""),
      alternatives,
      score: conf.score,
      stepIndex,
      escalated,
      source: "model",
      policyVersion: gate.policyVersion,
    });

    await recordShadowHits(decisionId ?? null, decision);

    // Escalated or blocked verdicts get a real human queue entry, not just an alert.
    let approvalId: string | null = null;
    if (decision === "modify" || decision === "block" || escalated) {
      approvalId = await createPendingApproval(supabase, {
        userId,
        decisionId: decisionId ?? null,
        agentId,
        runId,
        actionType,
        provider,
        description,
        params,
        reason,
        riskTier,
        origin: "control-engine",
      });
    }




    // ---- Real execution on ALLOW -----------------------------------------
    // An "allow" is only meaningful if the action can actually be carried out.
    // We check the capability registry for a real, verified executor whose
    // provider is genuinely connected, and if one exists we RUN IT for real
    // and report the verified result. Otherwise we say plainly that only the
    // assessment happened.
    let executed = false;
    let execution: Record<string, unknown> | null = null;
    let executionNote: string | null = null;
    let reversalId: string | null = null;

    if (dryRun) {
      executed = false;
      execution = null;
      executionNote = "dry run — not carried out";
    } else if (assessOnly) {
      executed = false;
      execution = null;
      executionNote = decision === "allow"
        ? "Approved by the control engine — the agent run carries this action out itself."
        : `Not carried out — decision is "${decision}".`;
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
        // Capture whatever the compensating action will need BEFORE we write.
        const undoState = reversibility.reversible
          ? await captureUndoState(actionType, supabase, userId, agentId || "", params as Record<string, unknown>)
          : null;
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

          // Record the reversal handle for anything that really landed.
          if (result.ok) {
            const p = params as Record<string, unknown>;
            const { data: revRow } = await supabase.from("action_reversals").insert({
              user_id: userId,
              decision_id: decisionId,
              agent_id: agentId,
              run_id: runId,
              provider,
              tool: actionType,
              reversible: reversibility.reversible,
              undo_kind: reversibility.undo_kind,
              undo_effect: reversibility.undo_effect || null,
              irreversible_reason: reversibility.irreversible_reason || null,
              ref: result.ref ?? null,
              undo_payload: {
                ...(undoState || {}),
                ref: result.ref ?? null,
                channel: p.channel ?? null,
                file_key: p.file_key ?? p.file ?? null,
                node_id: p.node_id ?? null,
                page_id: p.page_id ?? result.ref ?? null,
                shop: p.shop ?? null,
                product_id: p.product_id ?? null,
              },
              status: reversibility.reversible ? "available" : "unavailable",
              summary: result.summary,
            }).select("id").maybeSingle();
            reversalId = (revRow as { id?: string } | null)?.id ?? null;
          }
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
    // On assess-only calls we ONLY record a block here — the caller records the
    // real execution outcome afterwards, so the attempt isn't double-counted.
    let breakerState: Record<string, unknown> | null = null;
    if (!dryRun && !(assessOnly && decision !== "block")) {
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
      approval_id: approvalId,
      safety_scan: gate.safety.matched ? gate.safety : null,
      prompt_injection: injection.detected ? injection : null,
      shadow_rules: shadowMatches,


      decision,
      reason,
      reasoning,
      action_type: actionType,
      provider,
      intent_match: intentMatch,
      risk_tier: riskTier,
      strictness,
      strictness_label: STRICTNESS_PRESETS[strictness].label,
      fit_assessment: fit,
      fit_evidence: fitEvidence.note
        ? {
            note: fitEvidence.note,
            positive: fitEvidence.positive,
            negative: fitEvidence.negative,
            adjusted_from: fitApplied.adjusted ? rawFit : null,
            confidence_nudge: fitEvidence.nudge,
          }
        : null,
      confidence_score: conf.score,
      confidence_label: conf.label,
      threshold,
      escalated,
      modification: modification || null,
      alternatives,
      deferred,
      executed,
      assess_only: assessOnly,
      dry_run: dryRun,
      execution,
      execution_note: executionNote,
      circuit_breaker: breakerState,
      reversibility: {
        reversible: reversibility.reversible,
        undo_kind: reversibility.undo_kind,
        undo_effect: reversibility.undo_effect || null,
        irreversible_reason: reversibility.irreversible_reason || null,
        reversal_id: reversalId,
        undoable_now: Boolean(reversalId) && reversibility.reversible && executed && !dryRun,
      },
      spend_cap: spendAfter,


    });


  } catch (e) {
    return json({ error: "unexpected", message: String((e as Error)?.message || e) }, 500);
  }
});
