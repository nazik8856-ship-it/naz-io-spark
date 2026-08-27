// Control Engine — structured gate for a single proposed action.
// Input: { action_type, provider, description, params, agentId?, runId?, stepIndex? }
// Runs an intent check (matches/partial/mismatch) and a risk check
// (low/medium/high), scores confidence with the SHARED decision-scoring
// helpers agent-runtime uses, returns Allow / Modify / Block, and logs every
// verdict to agent_decisions.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAccountScope } from "../_shared/account-scope.ts";
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
import { openIncident } from "../_shared/incidents.ts";
import { runControlGate, createPendingApproval, loadOnUncertainPolicy } from "../_shared/control-gate.ts";
import { extractNarrowedAction, narrowedActionResolution } from "../_shared/api-key-policy.ts";
import { checkApprovalQuorum } from "../_shared/quorum.ts";
import { claimIdempotencyKey, saveIdempotencyResponse, releaseIdempotencyKey, claimRowOnce, releaseRowClaim, type ClaimResult } from "../_shared/idempotency.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";
import { loadActiveConfidenceBucketFlags, widenThresholdForFlags } from "../_shared/confidence-bucket-flags.ts";

// Generous enough that a legitimate agent-runtime run bursting several
// assess_only calls, or a human actively using the chat, never trips it —
// well below what an actual abuse pattern looks like.
const RATE_LIMIT_PER_MINUTE = 120;


import { PROVIDER_WRITE_KINDS, runProviderWrite } from "../_shared/provider-writes.ts";
import { reversibilityFor, captureUndoState, runUndo } from "../_shared/reversibility.ts";
import { replayDraft, replayRealTraffic, previewProposedHardRules, evaluateAction, type PolicySnapshot, type ProposedHardRuleInput } from "../_shared/policy-replay.ts";
import { summarizePolicyWatch, type PolicyWatchObservationRow } from "../_shared/policy-watch.ts";
import { loadFitEvidence, applyFitEvidence } from "../_shared/fit-learning.ts";
import { buildEmbeddingInput, generateEmbeddingWithinBudget, formatEmbeddingLiteral } from "../_shared/decision-embeddings.ts";
import { findPrecedent, loadOutcomeDirections, loadPrecedentForPrompt } from "../_shared/precedent-search.ts";
import { buildPrecedentPromptBlock } from "../_shared/precedent-prompt.ts";
import { alignPrecedentSignals, evaluatePrecedentForAutoApprove, shouldRejectOnPrecedent, summarizePrecedentOverride } from "../_shared/precedent-advice.ts";
import { buildPrecedentCitationRecord, recordPrecedentCitation } from "../_shared/precedent-citation.ts";
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
        // "Zero human review" plan, item 3: `modification` above is free
        // text -- useless to an automated caller with no human to read and
        // act on it. This is the same suggestion in a form a caller's own
        // system (or NazAI's own auto_narrow policy) can actually retry
        // with. Deliberately NOT in `required` below -- omit entirely
        // when there's no structured narrower version to offer, same as
        // `modification` uses an empty string for "none."
        modified_params: {
          type: "object",
          description:
            "If 'modification' describes a narrower/safer version of this action, the actual params object for that narrower version (e.g. fewer recipients, a smaller amount, a redacted field) -- same shape as the original params, just narrower. Omit entirely if there's no structured narrower version to suggest.",
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
  // Hoisted out of the try block (rather than declared with const inside
  // it) so the outer catch below can still see whichever account this
  // request belongs to, if resolution got that far before failing --
  // undefined only for the narrow case of a failure before auth itself
  // resolves (e.g. a missing platform env var), where there's no account
  // to attribute a record/alert/incident to in the first place.
  let userId: string | undefined;
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
    userId = userData?.user?.id ?? (isInternal ? internalUserId! : undefined);
    if (!userId) return json({ error: "Not authenticated" }, 401);

    // Trusted decision-source override -- only honored when the caller
    // actually holds the service-role key (isInternal), so a normal user
    // JWT holder can never spoof where a decision "came from." Set by
    // control-api/index.ts when it forwards an external API-key caller's
    // request in here for the full LLM-scored assessment (mode="full").
    // Every other internal caller (agent-runtime) never sends this header,
    // so decisions there keep logging as "model", exactly as before.
    const decisionSourceHeader = req.headers.get("x-decision-source");
    const trustedDecisionSource = isInternal && decisionSourceHeader === "external_api" ? "external_api" : null;
    // Same trust boundary as the decision-source header above -- only
    // honored when isInternal, so a normal user can never attribute a
    // decision to an api_keys row that isn't theirs.
    const trustedApiKeyId = isInternal ? (req.headers.get("x-api-key-id") || null) : null;
    // "Zero human review" plan, item 2: pending_approvals.origin was
    // hardcoded to "control-engine" everywhere in this file, even for a
    // request genuinely forwarded from control-api's mode="full" path --
    // so a pending approval created by an external company's own decision
    // was mislabeled as an internal one, and (for the createPendingApproval
    // call below) the api key was never threaded through at all, silently
    // blocking item 1's auto-resolve policy from ever applying here.
    const decisionOrigin: "external-api" | "control-engine" = trustedDecisionSource === "external_api" ? "external-api" : "control-engine";

    // ---- Rate limit --------------------------------------------------------
    // Nothing previously stopped a misbehaving client from hammering this
    // endpoint. Fails OPEN if the limiter itself can't be reached — an
    // infrastructure hiccup in the counter must not become a full outage
    // for legitimate traffic (unlike the control gate, which fails closed).
    const rate = await checkRateLimit(supabase, userId, "control-engine", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return json({
        error: "rate_limited",
        message: `Too many requests — ${rate.count} in the last minute (limit ${rate.limit}). Try again shortly.`,
      }, 429);
    }

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
        actionType: (row.tool as string) ?? null,
        provider: (row.provider as string) ?? null,
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
        gate_trace: d.gate_trace ?? null,
        gate_duration_ms: d.gate_duration_ms ?? null,
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

    // "15 more items" plan, item 3: the policy-version routes below
    // (/replay, /replay-real, /policy/:id/activate) all filtered
    // policy_versions by `userId` -- which, for a genuine user-JWT call,
    // is always the CALLER's own id, with no way for an invited team
    // owner to manage policy versions on an account they don't literally
    // own (the exact gap ControlPolicy.tsx's own missing accountId wiring
    // mirrors on the frontend side). Resolves an optional account_id the
    // same way api-keys/index.ts's resolveAccountScope does -- verified
    // via is_account_member, never trusted outright -- but only lazily,
    // and only for these three routes: an internal service-role call
    // already names its target explicitly via x-internal-user-id and has
    // no "acting on behalf of a team" concept, and every other route in
    // this file has never accepted an account_id at all, so this must
    // not change behavior for any of them.
    const resolvePolicyScopeUserId = async (): Promise<string | null> => {
      if (isInternal) return userId;
      const requested = body?.account_id;
      if (typeof requested !== "string" || !requested || requested === userId) return userId;
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      return resolveAccountScope(userClient, userId, requested, "policy");
    };

    // ---- POST /control-engine/approvals/:id/execute -------------------------
    // The ONLY path that carries out an action queued for human approval.
    // Quorum is re-checked here from the stored sign-off log — a row with
    // required_approvals = 2 and one sign-off is refused (409), never executed.
    //
    // executed_at is claimed ATOMICALLY (a single UPDATE ... WHERE executed_at
    // IS NULL) before the real write runs, so a double-click, a retried
    // request, or two open tabs racing each other can only ever have ONE of
    // them actually carry the action out — the loser sees already_executed,
    // not a second send/post/order. If the write itself fails, the claim is
    // released so the row stays genuinely retryable.
    const execMatch = url.pathname.match(/\/approvals\/([0-9a-fA-F-]{36})\/execute\/?$/);
    if (execMatch) {
      const approvalId = execMatch[1];
      const { data: apRow } = await supabase
        .from("pending_approvals").select("*").eq("id", approvalId).maybeSingle();
      const ap = apRow as Record<string, unknown> | null;
      if (!ap) return json({ ok: false, error: "not_found" }, 404);
      if (ap.user_id !== userId) return json({ ok: false, error: "forbidden" }, 403);

      if (ap.executed_at) {
        return json({
          ok: true, executed: false, already_executed: true,
          message: "This action was already carried out — nothing ran again.",
        });
      }

      const quorum = checkApprovalQuorum(ap);
      if (!quorum.ok) {
        if (quorum.reason === "rejected") {
          return json({ ok: false, executed: false, error: "rejected", message: "This action was rejected." }, 409);
        }
        return json({
          ok: false,
          executed: false,
          error: "quorum_not_met",
          approvals: quorum.distinct,
          required: quorum.needed,
          remaining: quorum.remaining,
          message: `Nothing ran — ${quorum.distinct} of ${quorum.needed} required approvals recorded.`,
        }, 409);
      }
      const { distinct, needed } = quorum;

      const actType = String(ap.action_type || "");
      if (!PROVIDER_WRITE_KINDS.has(actType)) {
        return json({
          ok: true, executed: false, approvals: distinct, required: needed,
          message: `Quorum met, but "${actType}" runs inside an agent run, not from the control engine.`,
        });
      }

      // Atomic claim: only succeeds if executed_at is still NULL right now.
      const claimed = await claimRowOnce(supabase, "pending_approvals", approvalId, "executed_at");
      if (!claimed) {
        return json({
          ok: true, executed: false, already_executed: true,
          message: "This action was already carried out — nothing ran again.",
        });
      }

      const result = await runProviderWrite(
        actType, supabase, userId, String(ap.agent_id || ""), (ap.params ?? {}) as Record<string, unknown>,
      );
      if (!result.ok) {
        // Nothing real happened — release the claim so this stays retryable.
        await releaseRowClaim(supabase, "pending_approvals", approvalId, "executed_at");
      }
      return json({
        ok: result.ok, executed: result.ok, approvals: distinct, required: needed,
        summary: result.summary, url: result.url ?? null, ref: result.ref ?? null,
      }, result.ok ? 200 : 502);
    }


    // ---- POST /control-engine/decisions/:id/override ------------------------
    // Break-glass: carries out a BLOCKed action anyway, over an explicit
    // human reason. A BLOCK verdict otherwise dead-ends -- only
    // require_approval verdicts get a pending_approvals row today. Scoped
    // deliberately narrow: only decisions whose block came from a hard rule
    // or the safety scanner are eligible, because those are the only two
    // BLOCK sources that capture ctx.params at block time (see
    // control-gate.ts's logStop calls) -- kill switch, spend cap, and
    // circuit breaker blocks have no params to replay and stay out of scope.
    //
    // overridden_at is claimed ATOMICALLY (a single UPDATE ... WHERE
    // overridden_at IS NULL) before the real write runs, mirroring
    // /approvals/:id/execute's own claim, so two concurrent override
    // attempts on the same blocked decision can only ever have ONE of them
    // actually carry the action out.
    const overrideMatch = url.pathname.match(/\/decisions\/([0-9a-fA-F-]{36})\/override\/?$/);
    if (overrideMatch) {
      const decisionId = overrideMatch[1];
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        return json({ ok: false, error: "reason_required", message: "A reason is required to override a blocked action." }, 400);
      }

      const { data: origRow } = await supabase
        .from("agent_decisions").select("*").eq("id", decisionId).maybeSingle();
      const orig = origRow as Record<string, unknown> | null;
      if (!orig) return json({ ok: false, error: "not_found" }, 404);
      if (orig.user_id !== userId) return json({ ok: false, error: "forbidden" }, 403);

      const eligibleSource = orig.source === "hard_rule" || orig.source === "safety_scanner";
      const isBlock = String(orig.decision || "").startsWith("BLOCK ");
      const hasParams = orig.params !== null && orig.params !== undefined;
      if (!eligibleSource || !isBlock || !hasParams) {
        return json({
          ok: false,
          error: "not_overridable",
          message: "Only a hard-rule or safety-scanner BLOCK with a captured action payload can be overridden here.",
        }, 400);
      }

      const actType = String(orig.action_type || "");
      if (!PROVIDER_WRITE_KINDS.has(actType)) {
        return json({
          ok: false,
          error: "not_executable",
          message: `"${actType}" has no provider-write path to re-run from here.`,
        }, 400);
      }

      // Atomic claim: only succeeds if overridden_at is still NULL right now.
      const claimed = await claimRowOnce(supabase, "agent_decisions", decisionId, "overridden_at");
      if (!claimed) {
        return json({
          ok: true, executed: false, already_overridden: true,
          message: "This blocked action was already overridden — nothing ran again.",
        });
      }

      const origProvider = (orig.provider as string) ?? null;
      const origAgentId = (orig.agent_id as string) ?? null;
      const { data: overrideRow } = await supabase.from("agent_decisions").insert({
        user_id: userId,
        agent_id: origAgentId,
        agent_run_id: orig.agent_run_id ?? null,
        decision: `OVERRIDE ${actType} (${origProvider ?? "unknown"})`,
        reasoning: reason.slice(0, 800),
        alternatives_considered: [],
        confidence_score: 100,
        source: "human_override",
        escalated: false,
        override_of: decisionId,
        action_type: actType,
        provider: origProvider,
      }).select("id").maybeSingle();
      const overrideDecisionId = (overrideRow as { id?: string } | null)?.id ?? null;
      if (overrideDecisionId) {
        try {
          await triggerWebhooks(supabase, userId, "decision_logged", {
            id: overrideDecisionId, decision: `OVERRIDE ${actType} (${origProvider ?? "unknown"})`,
            source: "human_override", escalated: false, agent_id: origAgentId,
          });
        } catch { /* ignore */ }
      }

      // A human bypassing a block is consequential regardless of whether the
      // resulting write itself later succeeds -- alert and open an incident
      // for the override event, not for the write's outcome.
      await sendCriticalAlert(supabase, userId, {
        event: "break_glass_override",
        summary: `A blocked action was overridden by a human: "${reason.slice(0, 300)}"`,
        decisionId: overrideDecisionId,
        actionType: actType,
        provider: origProvider,
        actor: userId,
      });

      const result = await runProviderWrite(
        actType, supabase, userId, origAgentId ?? "", (orig.params ?? {}) as Record<string, unknown>,
      );
      if (!result.ok) {
        // Nothing real happened -- release the claim so this stays
        // retryable. Each retry still gets its own audited human_override
        // decision row above, so the audit trail of every attempt survives
        // even though the claim itself resets.
        await releaseRowClaim(supabase, "agent_decisions", decisionId, "overridden_at");
      }
      return json({
        ok: result.ok, executed: result.ok, override_decision_id: overrideDecisionId,
        summary: result.summary, url: result.url ?? null, ref: result.ref ?? null,
      }, result.ok ? 200 : 502);
    }


    // ---- POST /control-engine/replay ----------------------------------------
    // Re-evaluates the 30 control scenarios against a DRAFT policy version and
    // diffs them against the active version. Deterministic layers only (hard
    // rules + safety scanner): no model calls, no writes, no provider traffic.
    if (url.pathname.replace(/\/$/, "").endsWith("/replay")) {
      const scopedUserId = await resolvePolicyScopeUserId();
      if (!scopedUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
      const draftRef = {
        id: typeof body?.policy_version_id === "string" ? body.policy_version_id : undefined,
        version: typeof body?.version === "number" ? body.version : undefined,
      };
      if (!draftRef.id && typeof draftRef.version !== "number") {
        return json({ error: "Provide policy_version_id or version of the draft to replay." }, 400);
      }
      const report = await replayDraft(supabase, scopedUserId, draftRef);
      if ("error" in report) return json({ error: report.error }, report.status);
      return json(report);
    }

    // ---- POST /control-engine/replay-real ------------------------------------
    // Same idea as /replay above, but against REAL historical decisions
    // instead of the 30 fixed scenarios -- "would this draft have decided
    // any of my last N real actions differently than my active policy
    // did." Only decisions with a captured action payload are replayable
    // (get_replayable_real_decisions); plain historical ALLOWs have none
    // captured and are excluded, by design.
    if (url.pathname.replace(/\/$/, "").endsWith("/replay-real")) {
      const scopedUserId = await resolvePolicyScopeUserId();
      if (!scopedUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
      const draftRef = {
        id: typeof body?.policy_version_id === "string" ? body.policy_version_id : undefined,
        version: typeof body?.version === "number" ? body.version : undefined,
      };
      if (!draftRef.id && typeof draftRef.version !== "number") {
        return json({ error: "Provide policy_version_id or version of the draft to replay." }, 400);
      }
      const limit = typeof body?.limit === "number" ? body.limit : undefined;
      const report = await replayRealTraffic(supabase, scopedUserId, draftRef, limit);
      if ("error" in report) return json({ error: report.error }, report.status);
      return json(report);
    }

    // ---- POST /control-engine/replay-preview ---------------------------------
    // "Policy autonomy" plan, item 7: preview one or more proposed hard
    // rules against real recent traffic WITHOUT first saving them as a
    // draft policy_versions row -- lets an account see what would have
    // come out differently before committing to the change at all, not
    // just before activating an already-drafted one.
    if (url.pathname.replace(/\/$/, "").endsWith("/replay-preview")) {
      const scopedUserId = await resolvePolicyScopeUserId();
      if (!scopedUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
      const proposedRules = Array.isArray(body?.hard_rules) ? (body.hard_rules as ProposedHardRuleInput[]) : [];
      const limit = typeof body?.limit === "number" ? body.limit : undefined;
      const report = await previewProposedHardRules(supabase, scopedUserId, proposedRules, limit);
      if ("error" in report) return json({ error: report.error }, report.status);
      return json(report);
    }

    // ---- POST /control-engine/policy/:id/activate ---------------------------
    // Activation is gated on the replay: a draft that regresses any scenario
    // the active policy currently passes cannot go live.
    const activateMatch = url.pathname.match(/\/policy\/([0-9a-fA-F-]{36})\/activate\/?$/);
    if (activateMatch) {
      const scopedUserId = await resolvePolicyScopeUserId();
      if (!scopedUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
      const draftId = activateMatch[1];
      const report = await replayDraft(supabase, scopedUserId, { id: draftId });
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
          .eq("user_id", scopedUserId);
      }
      const { error: actErr } = await supabase.from("policy_versions")
        // Watching a draft only makes sense before it goes live -- once
        // it's the real active policy, it's no longer "shadow" observed,
        // it's enforced directly. Stop watching automatically on activation
        // rather than leaving a stale watching=true on a now-active row.
        .update({ status: "active", activated_at: nowIso, watching: false, watching_since: null })
        .eq("id", draftId)
        .eq("user_id", scopedUserId);
      if (actErr) return json({ ok: false, activated: false, error: actErr.message }, 500);
      return json({ ok: true, activated: true, policy_version: report.draft_version.version, replay: report });
    }

    // ---- POST /control-engine/policy/:id/watch ------------------------------
    // "15 more items" plan, item 13: mark a whole DRAFT policy version as
    // "watching" -- from now on, every new live decision is silently
    // re-evaluated against this draft's snapshot too (see control-gate.ts's
    // runControlGate wrapper), without ever affecting the real decision.
    // Distinct from the existing per-RULE shadow_mode on hard_rules/
    // safety_rules, which watches one rule at a time; this watches an
    // entire policy version, continuously, until stopped or activated.
    const watchMatch = url.pathname.match(/\/policy\/([0-9a-fA-F-]{36})\/watch\/?$/);
    if (watchMatch) {
      const scopedUserId = await resolvePolicyScopeUserId();
      if (!scopedUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
      const draftId = watchMatch[1];
      const start = body?.start !== false;
      const { data: draftRow } = await supabase.from("policy_versions")
        .select("id, status").eq("id", draftId).eq("user_id", scopedUserId).maybeSingle();
      if (!draftRow) return json({ error: "Policy version not found for this account." }, 404);
      if (start && draftRow.status !== "draft") {
        return json({ error: "Only a draft policy version can be put into watch mode." }, 400);
      }
      const { error: watchErr } = await supabase.from("policy_versions")
        .update({ watching: start, watching_since: start ? new Date().toISOString() : null })
        .eq("id", draftId).eq("user_id", scopedUserId);
      if (watchErr) return json({ error: watchErr.message }, 500);
      return json({ ok: true, watching: start });
    }

    // ---- POST /control-engine/policy/:id/watch-summary -----------------------
    // The human-reviewable report a watching draft builds up over however
    // many days it's been observing real traffic: how many live decisions
    // it's seen, how many it would have decided differently, and a capped
    // sample of the changed ones -- reusing the exact same regression/
    // improvement classifier real-traffic replay already uses, since a
    // watch observation and a real-traffic-replay row are the same shape
    // of comparison.
    const watchSummaryMatch = url.pathname.match(/\/policy\/([0-9a-fA-F-]{36})\/watch-summary\/?$/);
    if (watchSummaryMatch) {
      const scopedUserId = await resolvePolicyScopeUserId();
      if (!scopedUserId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);
      const draftId = watchSummaryMatch[1];
      const { data: draftRow } = await supabase.from("policy_versions")
        .select("id, watching, watching_since").eq("id", draftId).eq("user_id", scopedUserId).maybeSingle();
      if (!draftRow) return json({ error: "Policy version not found for this account." }, 404);
      const { data: obsRows, error: obsErr } = await supabase.from("policy_watch_observations")
        .select("action_type, provider, active_outcome, draft_outcome, created_at")
        .eq("policy_version_id", draftId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (obsErr) return json({ error: obsErr.message }, 500);
      const summary = summarizePolicyWatch(draftId, draftRow.watching_since, (obsRows ?? []) as PolicyWatchObservationRow[]);
      return json({ ok: true, watching: draftRow.watching, ...summary });
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
    // Optional — only protects the real provider-write step below. Callers
    // that don't send one behave exactly as before.
    const idempotencyKey: string | null = body?.idempotency_key ? String(body.idempotency_key).slice(0, 200) : null;


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
      origin: decisionOrigin,
      apiKeyId: trustedApiKeyId,
    });
    const spendStatus = gate.spend;
    void spendStatus;

    const recordShadowHits = gate.recordShadowHits;
    const recordSafetyShadowHits = gate.recordSafetyShadowHits;
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
        safety_shadow_matches: gate.safety.shadowMatches,
        approval_id: gate.approvalId,
        gate_source: gate.source,
        shadow_rules: gate.shadowRules,
        gate_trace: gate.trace,
        model_judged: false,
        executed: false,
        execution: null,
        execution_note: gate.autoResolved
          ? `Resolved automatically to ${blocked ? "block" : "allow"} by this API key's configured policy — no human reviewed this.`
          : blocked
            ? `Nothing was assessed or run — stopped by the control gate (${gate.source}).`
            : `Nothing ran — this is queued for your approval (${gate.source}).`,
        resolved_automatically: gate.autoResolved,
        resolution_reason: gate.autoResolutionReason,
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

    // One org-level dial that scales every tolerance below -- an agent
    // with its own strictness override uses that instead of the account
    // default (Wave 5 session 1's per-agent policy scoping, closed out).
    const strictness = await loadStrictness(supabase, userId, agentId);

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

    // "Real precedent memory" plan, item 4: real semantic precedent for
    // the AI-scored judgment, scoped to trustedApiKeyId traffic ONLY --
    // this never changes how NazAI's own internal agents are judged.
    // Unlike item 3 (which reuses an embedding already stored moments
    // earlier), there's no decisionId yet at this point in the flow --
    // the decision hasn't been logged until after the model responds --
    // so this generates its own embedding purely to search with; that
    // embedding is never stored here (item 1's own embed-at-log-time
    // call still runs later, once a real decisionId exists). Best-effort
    // throughout: any failure here just means an empty prompt block, the
    // same "precedent is optional enrichment" posture as item 3.
    let precedentPromptBlock = "";
    if (trustedApiKeyId) {
      try {
        const queryEmbedding = await generateEmbeddingWithinBudget(supabase, userId, trustedApiKeyId, buildEmbeddingInput({ actionType, provider, description, params }));
        if (queryEmbedding) {
          const precedentRows = await loadPrecedentForPrompt(supabase, trustedApiKeyId, formatEmbeddingLiteral(queryEmbedding));
          precedentPromptBlock = buildPrecedentPromptBlock(precedentRows);
        }
      } catch { /* precedent is optional enrichment -- a lookup hiccup here must never block the real judgment */ }
    }

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
              "and a safer narrowed 'modification' if the action should be tightened before running. " +
              "When you suggest a modification, also fill in 'modified_params' with the actual narrower " +
              "params for it (same shape as the original params, just narrower) whenever you can express " +
              "it structurally -- e.g. a shorter recipient list, a smaller amount, a redacted field. " +
              "Only leave it out when the fix genuinely can't be expressed as changed params.\n" +
              "Always call the check_action tool.\n\n" +
              `ORG STRICTNESS: ${STRICTNESS_PRESETS[strictness].label} — ${STRICTNESS_PRESETS[strictness].blurb} ` +
              `Grade risk and fit through that lens: on Strict, lean toward the higher risk tier and toward ` +
              `'unclear' fit when evidence is thin; on Loose, only flag genuine risk or a genuine mismatch.\n\n` +
              `BUSINESS PROFILE:\n${profileBlock}` + fitEvidence.promptBlock +
              precedentPromptBlock +
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
    const spendAfter = await recordAiSpend(supabase, userId, MODEL, data?.usage, "control-engine", agentId, trustedApiKeyId);

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
    // A bucket flagged severely miscalibrated (calibrate-confidence's
    // weekly job, on real measured outcomes) widens the effective threshold
    // for any decision scored inside that exact range, until a human
    // clears the flag -- fail toward more review, never less.
    const activeConfidenceFlags = await loadActiveConfidenceBucketFlags(supabase, userId);
    const threshold = widenThresholdForFlags(
      thresholdForRisk(riskTier, baseThreshold, strictness),
      conf.score,
      activeConfidenceFlags,
    );
    // Blast-radius rule: an action that CANNOT be undone and is high risk
    // always needs a human, no matter how confident the model is.
    const reversibility = reversibilityFor(actionType);
    const irreversibleHighRisk = !reversibility.reversible && irreversibleNeedsHuman(riskTier, strictness);
    let escalated = shouldEscalate(conf.score, threshold) || irreversibleHighRisk;
    const modification = String(parsed.modification || "").trim();
    // "Zero human review" plan, item 3: only meaningful alongside a real
    // `modification`, and only usable when it's a genuine non-empty object
    // -- extractNarrowedAction (api-key-policy.ts) is the single source of
    // truth for what counts as "usable," consulted again below once the
    // final `decision` is known.
    const modifiedParams = parsed.modified_params ?? null;
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
      source: trustedDecisionSource ?? "model",
      policyVersion: gate.policyVersion,
      trace: gate.trace,
      actionType,
      provider,
      apiKeyId: trustedApiKeyId,
      description,
      params,
    });

    await recordShadowHits(decisionId ?? null, decision);
    await recordSafetyShadowHits(decisionId ?? null, decision);

    // Escalated or blocked verdicts get a real human queue entry, not just an
    // alert -- or, when the calling API key has an on_uncertain policy
    // configured ("zero human review" plan, items 1-2), resolved
    // automatically instead. The agent_decisions row above already logged
    // the model's own original judgment (unchanged, for an honest audit
    // trail); only what gets RETURNED to the caller reflects the
    // auto-resolution, same precedent as control-gate.ts's own three
    // deterministic-layer call sites.
    let approvalId: string | null = null;
    let autoResolved = false;
    let autoResolutionReason: string | null = null;
    if (decision === "modify" || decision === "block" || escalated) {
      // "Zero human review" plan, item 3: an "auto_narrow" policy needs a
      // real safety re-check BEFORE createPendingApproval's simple
      // apiKeyId lookup could ever get involved -- computed here as a
      // forcedResolution so createPendingApproval just records the
      // outcome, the same way it already does for control-gate.ts's own
      // deterministic-layer call sites.
      let forcedResolution: { resolution: "approved" | "rejected"; note: string } | null = null;
      if (trustedApiKeyId && (await loadOnUncertainPolicy(supabase, trustedApiKeyId)) === "auto_narrow") {
        const narrowedParams = extractNarrowedAction(decision, modifiedParams);
        if (narrowedParams) {
          // Fail closed: if the snapshot lookup itself throws, treat the
          // re-check as failed (never a blind auto-allow on an error).
          let recheckOutcome: "pass_through" | "require_approval" | "block" = "block";
          try {
            const { data: pv } = await supabase.rpc("get_active_policy_version", { _user_id: userId });
            const row = (Array.isArray(pv) ? pv[0] : pv) as { snapshot?: PolicySnapshot } | null;
            const evalResult = evaluateAction(
              { action_type: actionType, provider, description: `${description} (narrowed automatically)`, params: narrowedParams },
              (row?.snapshot ?? {}) as PolicySnapshot,
            );
            recheckOutcome = evalResult.gate_outcome;
          } catch { /* recheckOutcome stays "block" -- auto-denied below */ }
          forcedResolution = narrowedActionResolution(recheckOutcome);

          // "Real precedent memory" plan, item 5: the deterministic
          // re-check above only knows about hard rules/safety patterns --
          // it has no idea whether a similarly-narrowed version of this
          // kind of action has actually gone well before for this exact
          // api key. Only ever consulted when the re-check ITSELF already
          // passed cleanly -- precedent can pull a would-be approval back
          // to reject, same one-directional posture item 3 already
          // established, never push a real rule/safety failure through.
          // Generates its own embedding for the NARROWED variant
          // specifically (not the original action's), since that's a
          // materially different thing to have precedent about.
          if (forcedResolution.resolution === "approved" && trustedApiKeyId) {
            try {
              const narrowedEmbedding = await generateEmbeddingWithinBudget(supabase, userId, trustedApiKeyId, buildEmbeddingInput({
                actionType, provider, description: `${description} (narrowed automatically)`, params: narrowedParams,
              }));
              if (narrowedEmbedding) {
                const matches = await findPrecedent(
                  supabase, trustedApiKeyId, formatEmbeddingLiteral(narrowedEmbedding), decisionId ?? null,
                );
                if (matches.length > 0) {
                  const { data: precedentRows } = await supabase
                    .from("agent_decisions").select("id, decision").in("id", matches.map((m) => m.decisionId));
                  const decisionById = new Map(((precedentRows ?? []) as { id: string; decision: string }[]).map((r) => [r.id, r.decision]));
                  const outcomeDirections = await loadOutcomeDirections(supabase, matches.map((m) => m.decisionId));
                  // Item 10: older precedent counts for less -- weights
                  // decay with each match's own age.
                  const { nonAllowFlags, weights } = alignPrecedentSignals(matches, decisionById, outcomeDirections);
                  const advice = evaluatePrecedentForAutoApprove(nonAllowFlags, weights);
                  if (shouldRejectOnPrecedent(advice) && advice.available) {
                    forcedResolution = { resolution: "rejected", note: summarizePrecedentOverride(advice) };
                    if (decisionId) {
                      await recordPrecedentCitation(supabase, decisionId, buildPrecedentCitationRecord(advice, matches, nonAllowFlags));
                    }
                  }
                }
              }
            } catch { /* precedent is optional enrichment -- a lookup hiccup here must never block the real re-check outcome */ }
          }
        } else {
          // Policy says auto_narrow, but there's nothing structured to
          // retry with -- never left silently pending for a human who
          // was never going to look; deny rather than guess.
          forcedResolution = {
            resolution: "rejected",
            note: "Resolved automatically to rejected: this key's policy is auto_narrow, but no usable structured narrower version was provided to retry — no human reviewed this.",
          };
        }
      }
      const outcome = await createPendingApproval(supabase, {
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
        origin: decisionOrigin,
        apiKeyId: trustedApiKeyId,
        forcedResolution,
      });
      approvalId = outcome.approvalId;
      if (outcome.autoResolved) {
        autoResolved = true;
        autoResolutionReason = `Resolved automatically to ${outcome.resolution} by this API key's configured policy — no human reviewed this.`;
        decision = outcome.resolution === "approved" ? "allow" : "block";
        escalated = false;
      }
    }
    // `deferred` was built from the model's ORIGINAL decision, before any
    // auto-resolution above could have moved it away from "deferred" --
    // stale deferred guidance would otherwise ship alongside a decision
    // that's no longer actually deferred.
    const finalDeferred = autoResolved ? null : deferred;




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
    // Set only when THIS request itself claimed the idempotency key (not on
    // a cache replay, which returns early) — used at the end to save the
    // response so a retry with the same key gets it back instead of
    // running the write again.
    let idemClaim: ClaimResult | undefined;

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

      const wouldExecute = Boolean(cap) && offer.offerable && PROVIDER_WRITE_KINDS.has(actionType);

      // The claim only happens right here — right before a real write would
      // actually run — never for an action that was only ever going to be
      // assessed. Claiming earlier would occupy the key for a write that
      // never happens, permanently 409-ing a legitimate retry.
      if (wouldExecute && idempotencyKey) {
        idemClaim = await claimIdempotencyKey(supabase, userId, idempotencyKey);
      }

      if (!cap || !offer.offerable) {
        executionNote = offer && !("offerable" in offer && offer.offerable)
          ? `Assessment only — the action was NOT carried out. ${(offer as { message?: string }).message ?? ""}`.trim()
          : `Assessment only — "${actionType}" has no real executor in NazAI yet, so nothing was actually done.`;
      } else if (!PROVIDER_WRITE_KINDS.has(actionType)) {
        executionNote =
          `Assessment only — "${actionType}" is real, but it runs inside an agent run (agent-runtime), ` +
          `not from the control engine. Approve it on the agent to actually execute it.`;
      } else if (idemClaim?.status === "replay") {
        return json(idemClaim.response);
      } else if (idemClaim?.status === "in_progress") {
        return json({
          error: "idempotency_key_in_progress",
          message: "A request with this idempotency key is already being carried out (or didn't finish cleanly). Retry shortly, or use a new key for a genuinely new attempt.",
        }, 409);
      } else {
        // Capture whatever the compensating action will need BEFORE we write.
        const undoState = reversibility.reversible
          ? await captureUndoState(actionType, supabase, userId, agentId || "", params as Record<string, unknown>)
          : null;
        try {
          const result = await runProviderWrite(actionType, supabase, userId, agentId || "", params as Record<string, unknown>);
          executed = result.ok;
          if (idempotencyKey && !result.ok) await releaseIdempotencyKey(supabase, userId, idempotencyKey);
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
          if (idempotencyKey && idemClaim?.status === "claimed") await releaseIdempotencyKey(supabase, userId, idempotencyKey);
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
          // Bug fix (found while building item 6's outcome-weighting): the
          // table's own CHECK constraint only allows 'positive' | 'negative'
          // | 'neutral' | 'unknown' -- "up"/"flat" silently violated it, so
          // this insert has thrown (and been swallowed by the catch below)
          // on every single call since this path was written. "neutral" =
          // ran without error but real business impact isn't known yet at
          // insert time; "unknown" = didn't run, nothing to measure.
          direction: executed ? "neutral" : "unknown",
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

    const responseBody = {

      decision_id: decisionId,
      approval_id: approvalId,
      safety_scan: gate.safety.matched ? gate.safety : null,
      safety_shadow_matches: gate.safety.shadowMatches,
      prompt_injection: injection.detected ? injection : null,
      shadow_rules: shadowMatches,
      gate_trace: gate.trace,


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
      deferred: finalDeferred,
      resolved_automatically: autoResolved,
      resolution_reason: autoResolutionReason,
      executed,
      assess_only: assessOnly,
      dry_run: dryRun,
      execution,
      execution_note: executionNote,
      circuit_breaker: breakerState,
      // assess_only callers (agent-runtime) record the real execution
      // outcome themselves, after this response, via their own
      // recordBreakerAttempt call -- they need this flag to give that later
      // call the same decisive (not windowed) half-open-trial treatment
      // gate.recordAttempt already gives it here.
      breaker_half_open_trial: gate.circuitBreakerHalfOpenTrial,
      reversibility: {
        reversible: reversibility.reversible,
        undo_kind: reversibility.undo_kind,
        undo_effect: reversibility.undo_effect || null,
        irreversible_reason: reversibility.irreversible_reason || null,
        reversal_id: reversalId,
        undoable_now: Boolean(reversalId) && reversibility.reversible && executed && !dryRun,
      },
      spend_cap: spendAfter,


    };

    // A key is only ever claimed right before a real provider write — save
    // the response so a retry with the same key replays it instead of
    // running that write again. Only meaningful on a genuine success; a
    // failure already released the claim above so a retry can try for real.
    if (idempotencyKey && idemClaim?.status === "claimed" && executed) {
      await saveIdempotencyResponse(supabase, userId, idempotencyKey, responseBody);
    }

    return json(responseBody);

  } catch (e) {
    const message = String((e as Error)?.message || e);
    // "15 more items" plan, item 4: this outer catch used to just return a
    // bare 500 -- no decision row, no alert, no incident, unlike the INNER
    // gate-logic catch (control-gate.ts's own fail-closed block) which at
    // least records and alerts. It catches things the inner one never
    // sees: a missing/invalid auth token making it past getUser() in some
    // unexpected shape, malformed request bodies, an LLM provider timing
    // out, or any other uncaught exception anywhere in this large handler.
    //
    // Only meaningful when an account is already known -- userId is
    // undefined only for the narrower case of a failure before auth even
    // resolved (e.g. a missing platform env var), where there's no
    // specific customer to attribute a record/alert/incident to; that
    // case still surfaces via this log line, but a genuinely account-less
    // alerting path is a separate, bigger undertaking than this item (more
    // naturally paired with a platform-wide mechanism, not a per-account
    // one).
    if (userId) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      let decisionId: string | null = null;
      try {
        const { data } = await admin.from("agent_decisions").insert({
          user_id: userId,
          decision: "BLOCK control-engine (unexpected error)".slice(0, 400),
          reasoning: `Blocked — control-engine hit an unhandled error and failed closed.\n${message}`.slice(0, 800),
          alternatives_considered: [],
          confidence_score: 100,
          source: "gate_error",
          escalated: true,
        }).select("id").maybeSingle();
        decisionId = (data as { id?: string } | null)?.id ?? null;
      } catch { /* logging must never mask the real error below */ }
      try {
        await sendCriticalAlert(admin, userId, {
          event: "gate_error",
          summary: `control-engine failed with an unhandled error: ${message}`,
          decisionId,
        });
      } catch { /* alerting must never mask the real error below */ }
      try {
        await openIncident(admin, userId, {
          kind: "gate_error",
          summary: `control-engine failed with an unhandled error: ${message}`,
          decisionId,
        });
      } catch { /* incident tracking must never mask the real error below */ }
    } else {
      console.error("control-engine: unhandled error before an account could be resolved:", message);
    }
    return json({ error: "unexpected", message }, 500);
  }
});
