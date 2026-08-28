// Unified control gate — ONE enforcement path for every real action, whether
// it comes from the Control System chat or an autonomous agent run.
//
// Order of checks (all deterministic, no LLM):
//   1. daily AI spend cap (auto kill-switch trip)
//   2. global kill switch
//   3. hard rules (live ones enforce; shadow ones only log)
//   4. per-action circuit breaker
//   5. deterministic content safety scanner (PII, secrets, destructive, reach)
//   6. per-agent behavioral-baseline anomaly detector (only when agentId is
//      known) — a distinct risk class from the circuit breaker: catches
//      abnormal-but-SUCCESSFUL volume or a brand-new provider/action_type for
//      this agent, even when every individual action would pass on its own.
//      Its sensitivity scales with the same org strictness dial as the
//      confidence bar (Strict trips smaller, Loose needs a bigger spike).
//
// Every stop writes to agent_decisions, so the audit trail is identical no
// matter where the action originated. Escalations create a pending_approvals
// row so a human has a real queue instead of a Slack ping.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearExpiredSpendKillSwitch, clearExpiredAgentSpendKillSwitch, getSpendStatus, getAgentSpendStatus, type SpendStatus } from "./spend-guard.ts";
import { sendCriticalAlert } from "./critical-alerts.ts";
import { openIncident } from "./incidents.ts";
import { scanAction, type SafetyRule, type SafetyScan } from "./safety-scanner.ts";
import { countTodaySuccesses, detectAnomaly, loadAgentBaseline, type AnomalyCheck } from "./anomaly-detector.ts";
import { loadStrictness } from "./decision-scoring.ts";
import { finalizeTrace, type TraceEntry } from "./gate-trace.ts";
import { ruleMatchesAction, selectRulesForAgent } from "./rule-matching.ts";
import { triggerWebhooks } from "./webhooks.ts";
import { recordPolicyWatchObservations } from "./policy-watch.ts";
import { resolveOnUncertain, resolveSweepFallback, type AutoResolution } from "./api-key-policy.ts";
import { notifyAndAwaitCallback, type CallbackConfig } from "./callback-delegation.ts";
import { embedDecisionIfExternal } from "./decision-embeddings.ts";
import { countsTowardRealUsage } from "./sandbox-mode.ts";
import { findPrecedent, loadOutcomeDirections, loadStoredEmbeddingLiteral } from "./precedent-search.ts";
import { alignPrecedentSignals, evaluatePrecedentForAutoApprove, shouldRejectOnPrecedent, summarizePrecedentOverride } from "./precedent-advice.ts";
import { buildPrecedentCitationRecord, recordPrecedentCitation } from "./precedent-citation.ts";
import { isWithinQuietHours, summarizeQuietHoursEscalation, type QuietHoursConfig } from "./quiet-hours.ts";
import { isCallbackFailureTrouble, summarizePolicyDowngrade } from "./policy-downgrade.ts";
import { triggerWebhooks } from "./webhooks.ts";
import { resolveEffectiveOnUncertain, type ActionTypeOverride } from "./action-type-policy.ts";

export const BREAKER_WINDOW = 10;
export const BREAKER_MIN_ATTEMPTS = 4;
export const BREAKER_FAIL_RATE = 0.5;
// 2026-08-24: a tripped breaker never cleared itself -- no cron, no
// time-based logic anywhere, manual reset only (CircuitBreakerPanel.tsx).
// Contrast with the spend-cap kill switch, which already auto-clears at UTC
// day rollover. Once tripped_at is older than this cooldown, the NEXT
// attempt for that action type is let through as a single half-open
// "trial" instead of blocked outright -- if it succeeds the breaker clears,
// if it fails it re-trips immediately and the cooldown timer restarts.
export const BREAKER_COOLDOWN_MS = 15 * 60_000;

// The exact set agent_decisions_source_check (migrations) currently allows.
// 2026-08-23: found that "agent_kill_switch"/"agent_ai_spend_cap" had been
// written by this file since 2026-08-21 without ever being added to that
// constraint -- three days of per-agent kill-switch/spend-cap blocks
// produced no agent_decisions row at all, silently (supabase-js doesn't
// throw on a constraint violation, and logStop() only destructures `data`).
// Typing logStop's `source` param (and every direct agent_decisions insert
// in this file) against this union makes that class of drift a compile
// error instead of a silent runtime no-op: adding a new source string here
// without also extending the real CHECK constraint is still possible, but
// forgetting to add a NEW source to this list when introducing one in code
// is now caught by tsc, not discovered days later by an empty audit trail.
// "model" and "human_override" are written elsewhere (decision-scoring.ts,
// agent-runtime.ts, control-engine.ts), not from this file, but are listed
// for completeness since they share the same constraint.
export const AGENT_DECISION_SOURCES = [
  "model", "human_override",
  "kill_switch", "ai_spend_cap", "agent_kill_switch", "agent_ai_spend_cap",
  "hard_rule", "circuit_breaker", "circuit_breaker_trip",
  "safety_scanner", "anomaly_detector", "gate_error",
  "external_api", "platform_kill_switch",
  // Flip-EVENT sources (not a gate stop -- logged by KillSwitchPanel.tsx
  // when someone toggles a switch, distinct from "kill_switch"/
  // "platform_kill_switch" which mark an ACTION blocked because a switch
  // was already on). "kill_switch_flip" was a pre-existing, previously
  // undiscovered instance of this exact "used in code, missing from this
  // constraint" bug -- every flip has silently failed to log until now.
  "kill_switch_flip", "platform_kill_switch_flip",
  // "Zero human review" plan, item 8: distinct from plain "gate_error" --
  // that value always means the gate failed CLOSED (the platform
  // default); this one means a specific api key's own on_gate_error
  // policy chose to fail OPEN instead. Deliberately a different value,
  // not a boolean flag next to "gate_error", so the two are never
  // silently blended together in a report or audit query grouped by
  // source.
  "gate_error_fail_open",
] as const;
export type AgentDecisionSource = typeof AGENT_DECISION_SOURCES[number];

export type GateContext = {
  userId: string;
  actionType: string;
  provider: string;
  description: string;
  params: unknown;
  agentId?: string | null;
  runId?: string | null;
  stepIndex?: number | null;
  dryRun?: boolean;
  origin: "control-engine" | "agent-runtime" | "agent-approval" | "external-api";
  // Which api_keys row authenticated this request, when origin is
  // "external-api" -- threaded onto any agent_decisions row this call
  // logs so a decision is traceable back to a specific key without
  // exposing the key's raw secret or hash anywhere in the audit log.
  // Always null for every other origin.
  apiKeyId?: string | null;
  // "Knowledge & autonomy" plan, item 7: true only for a sandbox/test-mode
  // api_keys row. Judged exactly the same as a real key (every layer
  // above runs unchanged) -- this only stamps the resulting decision row
  // and skips embedding/precedent storage (see sandbox-mode.ts's
  // countsTowardRealUsage, used at every "does this count toward
  // something real" call site this gate owns). Always false/undefined
  // for every non-external-api origin.
  isTest?: boolean;
};

export type ShadowHit = {
  id: string;
  rule_text: string;
  would_have: "block" | "require_approval";
  enforced: false;
};

export type GateResult = {
  /** true => the caller may continue to scoring / execution. */
  ok: boolean;
  verdict: "allow" | "block" | "require_approval";
  reason: string | null;
  decisionId: string | null;
  source: string | null;
  approvalId: string | null;
  spend: SpendStatus;
  safety: SafetyScan;
  shadowRules: ShadowHit[];
  hardRule: { id: string; rule_text: string; effect: string } | null;
  circuitBreaker: Record<string, unknown> | null;
  /** True when a tripped breaker's cooldown had elapsed and this specific
   * attempt was let through as a half-open recovery trial rather than
   * blocked outright. A caller that records the real outcome through a
   * path OTHER than this result's own `recordAttempt` (e.g. agent-runtime,
   * which relays the gate check over HTTP to control-engine and records the
   * outcome itself afterwards) must thread this through so that outcome
   * still gets the trial's decisive (not windowed) treatment. */
  circuitBreakerHalfOpenTrial: boolean;
  anomaly: AnomalyCheck | null;
  killSwitch: boolean;
  /** The policy version whose snapshot judged this action. */
  policyVersion: number | null;
  policyVersionId: string | null;
  /** Every layer the gate checked, in order — not just the one that stopped it. */
  trace: TraceEntry[];
  /** Total wall-clock time the gate spent on this call, in milliseconds. */
  gateDurationMs: number;
  /** Records what matching shadow rules WOULD have done, against the real verdict. */
  recordShadowHits: (decisionId: string | null, actualDecision: string) => Promise<void>;
  /** Same, for shadow-mode safety rules (safety.shadowMatches). */
  recordSafetyShadowHits: (decisionId: string | null, actualDecision: string) => Promise<void>;
  /** Feeds an attempt into the rolling circuit-breaker window. */
  recordAttempt: (failed: boolean, why: string) => Promise<Record<string, unknown> | null>;
  /** "Zero human review" plan, item 1: true when a "needs a second look"
   * outcome (a non-blocking hard rule or safety-scanner match) was resolved
   * automatically by the calling API key's on_uncertain policy instead of
   * creating a pending_approvals row for a human -- never true for an
   * outright block, which no policy can override. */
  autoResolved: boolean;
  /** Set only when autoResolved is true -- explains what the policy did and why, distinct from `reason` (which stays the original trigger explanation). */
  autoResolutionReason: string | null;
};


type HardRule = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider: string | null;
  shadow_mode?: boolean;
  agent_id?: string | null;
  // "Policy autonomy" plan, item 1: why this rule exists, not just what
  // it matches -- shown in the decision reasoning when it actually
  // fires. Optional: an existing rule with none set yet just omits it.
  rationale?: string | null;
};

/** Shape of a policy_versions.snapshot row (built by build_policy_snapshot). */
type PolicySnapshot = {
  hard_rules?: unknown;
  safety_rules?: unknown;
  thresholds?: unknown;
  spend_cap?: unknown;
  captured_at?: string;
};


export type PendingApprovalOutcome = {
  approvalId: string | null;
  autoResolved: boolean;
  resolution: "approved" | "rejected" | null;
};

/**
 * Shared lookup so this file's own apiKeyId-based branch below and a
 * caller that needs to know the policy value BEFORE deciding how to call
 * createPendingApproval (control-engine's auto_narrow flow, "zero human
 * review" plan item 3) don't duplicate the same query.
 */
export async function loadOnUncertainPolicy(
  admin: SupabaseClient,
  apiKeyId: string | null | undefined,
  // "Policy autonomy" plan, item 10: when the caller knows which
  // action_type this decision is for, an action-type-specific override
  // (if one matches) governs instead of the key's own blanket column --
  // exactly the same resolution createPendingApproval's own apiKeyId
  // branch below applies. Omitting it (every call site that predates
  // this item) keeps returning the plain blanket policy, unchanged.
  actionType?: string,
): Promise<string | null> {
  if (!apiKeyId) return null;
  const { data } = await admin.from("api_keys").select("on_uncertain").eq("id", apiKeyId).maybeSingle();
  const blanket = (data as { on_uncertain?: string } | null)?.on_uncertain ?? null;
  if (!actionType) return blanket;
  const overrides = await loadActionTypeOverrides(admin, apiKeyId);
  return resolveEffectiveOnUncertain(blanket, actionType, overrides).policy;
}

/** "Policy autonomy" plan, item 10: every action-type override configured for one api key, oldest first -- so a tie between two matching patterns always resolves the same predictable way (the oldest one wins), matching hard_rules matching's own existing precedent. Never throws. Exported so control-engine's own threshold resolution ("knowledge & autonomy" plan, item 9) can reuse the exact same query instead of a second one. */
export async function loadActionTypeOverrides(admin: SupabaseClient, apiKeyId: string): Promise<ActionTypeOverride[]> {
  try {
    const { data } = await admin
      .from("api_key_action_policies")
      .select("action_type_pattern, on_uncertain, confidence_threshold")
      .eq("api_key_id", apiKeyId)
      .order("created_at", { ascending: true });
    return (data ?? []) as ActionTypeOverride[];
  } catch {
    return [];
  }
}

export type ApiKeyCallbackRow = {
  on_uncertain: string | null;
  callback_url: string | null;
  callback_secret: string | null;
  callback_timeout_seconds: number | null;
  callback_fallback: string | null;
  // "Zero human review" plan, item 6: a separate, optional shadow-mode
  // policy value an account can preview without it actually governing any
  // real escalation -- read alongside the real columns above since both
  // are always needed together (the shadow guess below reuses
  // callback_fallback for a 'callback' shadow value, same as the real
  // resolution path does).
  shadow_on_uncertain: string | null;
  // "Policy autonomy" plan, item 3: quiet_hours_timezone is the "is this
  // even configured" flag -- start/end hour alone (both nullable, no
  // sentinel needed) default to meaningless 0 values in Postgres only if
  // someone set one without the other, which never happens through any
  // real write path this round adds.
  quiet_hours_start_hour: number | null;
  quiet_hours_end_hour: number | null;
  quiet_hours_timezone: string | null;
  // "Policy autonomy" plan, item 4: how many callback attempts in a row
  // have failed to get a real answer back -- reset to 0 the moment a
  // real answer arrives again.
  callback_failure_streak: number | null;
};

/** "Zero human review" plan, item 4: the fuller row createPendingApproval's own "callback" branch needs -- kept separate from loadOnUncertainPolicy above since most callers only ever need the one column. */
async function loadApiKeyCallbackConfig(admin: SupabaseClient, apiKeyId: string): Promise<ApiKeyCallbackRow | null> {
  const { data } = await admin
    .from("api_keys")
    .select("on_uncertain, callback_url, callback_secret, callback_timeout_seconds, callback_fallback, shadow_on_uncertain, quiet_hours_start_hour, quiet_hours_end_hour, quiet_hours_timezone, callback_failure_streak")
    .eq("id", apiKeyId)
    .maybeSingle();
  return data as ApiKeyCallbackRow | null;
}

/**
 * Queue a human approval for an escalated action -- or, when the calling
 * API key has an auto-resolve policy configured (its `on_uncertain`
 * column), resolve it automatically instead and record that it happened
 * that way, no pending_approvals row left for a human. Never throws.
 */
export async function createPendingApproval(
  admin: SupabaseClient,
  input: {
    userId: string;
    decisionId: string | null;
    agentId?: string | null;
    runId?: string | null;
    actionType: string;
    provider: string;
    description: string;
    params?: unknown;
    reason: string;
    riskTier?: string;
    origin: string;
    approverRole?: string;
    requiredApprovals?: number;
    // "Zero human review" plan, item 1: only ever non-null for an
    // external-api-origin call (GateContext's own documented invariant --
    // null for every other origin). When present (and forcedResolution
    // isn't), this outcome is governed by that key's on_uncertain policy
    // instead of always creating a human-only queue entry.
    apiKeyId?: string | null;
    // "Zero human review" plan, item 3: set by a caller (control-engine's
    // auto_narrow flow) that has ALREADY computed the outcome itself --
    // e.g. by re-checking a model-suggested narrower action against the
    // deterministic gate -- bypassing the simple apiKeyId policy lookup
    // above entirely. Takes priority over apiKeyId when both are set.
    forcedResolution?: { resolution: "approved" | "rejected"; note: string } | null;
  },
  // "Policy autonomy" plan, item 3: injectable so quiet-hours behavior is
  // actually testable against a fixed clock, same as computePauseUntil/
  // isCurrentlyPaused elsewhere already do -- every real caller just
  // omits it and gets the real current time.
  now: Date = new Date(),
): Promise<PendingApprovalOutcome> {
  try {
    let auto: AutoResolution = { autoResolved: false, resolution: null, status: "pending" };
    let comment: string | null = null;
    // "Zero human review" plan, item 4: set only when this key's policy is
    // "callback" with a real callback_url configured -- the row is still
    // inserted as a genuine pending row below (the callback flow needs a
    // real id to notify about and poll), then delegated to
    // notifyAndAwaitCallback right after the insert.
    let callbackConfig: CallbackConfig | null = null;
    // "Zero human review" plan, item 6: loaded whenever an api key is
    // known, EVEN when forcedResolution also short-circuits the real
    // resolution below -- shadow-mode observation (right after the insert
    // further down) needs this key's shadow_on_uncertain regardless of
    // which path decided the real outcome, so a shadow policy can be
    // previewed against every escalation this key sees, not just the ones
    // that reach the plain apiKeyId branch.
    const keyRow = input.apiKeyId ? await loadApiKeyCallbackConfig(admin, input.apiKeyId) : null;
    // "Policy autonomy" plan, item 10: an action-type-specific override
    // (if one matches this decision's actionType) replaces the key's own
    // blanket on_uncertain for THIS decision only -- callback config,
    // shadow preview, and quiet hours below all stay governed by the
    // blanket columns, unaffected.
    const actionTypeOverrides = input.apiKeyId ? await loadActionTypeOverrides(admin, input.apiKeyId) : [];
    const effectiveOnUncertain = keyRow
      ? resolveEffectiveOnUncertain(keyRow.on_uncertain, input.actionType, actionTypeOverrides)
      : { policy: null, matchedOverride: null };
    if (input.forcedResolution) {
      auto = input.forcedResolution.resolution === "approved"
        ? { autoResolved: true, resolution: "approved", status: "auto_approved" }
        : { autoResolved: true, resolution: "rejected", status: "auto_rejected" };
      comment = input.forcedResolution.note;
    } else if (keyRow) {
      if (effectiveOnUncertain.policy === "callback" && keyRow.callback_url && keyRow.callback_secret) {
        callbackConfig = {
          url: keyRow.callback_url,
          secret: keyRow.callback_secret,
          timeoutSeconds: keyRow.callback_timeout_seconds ?? 20,
          fallback: keyRow.callback_fallback === "auto_allow" ? "auto_allow" : "auto_deny",
        };
      } else {
        auto = resolveOnUncertain(effectiveOnUncertain.policy);
        if (auto.autoResolved) {
          comment = effectiveOnUncertain.matchedOverride
            ? `Resolved automatically to ${auto.resolution} by this API key's action-type-specific policy for "${effectiveOnUncertain.matchedOverride.action_type_pattern}" — no human reviewed this.`
            : `Resolved automatically to ${auto.resolution} by this API key's configured policy — no human reviewed this.`;
        }
      }
    }
    // "Real precedent memory" plan, item 3: before finalizing an
    // automatic APPROVAL specifically -- never a denial, which is
    // already the safe choice and is never second-guessed -- check
    // whether real precedent for this exact api key disagrees. Reuses
    // whatever embedding item 1 already computed for THIS decision
    // moments ago (via input.decisionId) rather than generating a
    // second one for the same action. A missing embedding (the live
    // attempt failed, or there's no apiKeyId at all) is a silent no-op,
    // the same "precedent is optional enrichment, never required"
    // posture embedding generation itself already has.
    if (auto.autoResolved && auto.resolution === "approved" && input.apiKeyId && input.decisionId) {
      const embeddingLiteral = await loadStoredEmbeddingLiteral(admin, input.decisionId);
      if (embeddingLiteral) {
        const matches = await findPrecedent(admin, input.apiKeyId, embeddingLiteral, input.decisionId);
        if (matches.length > 0) {
          try {
            const { data: precedentRows } = await admin
              .from("agent_decisions")
              .select("id, decision")
              .in("id", matches.map((m) => m.decisionId));
            const decisionById = new Map(((precedentRows ?? []) as { id: string; decision: string }[]).map((r) => [r.id, r.decision]));
            // Item 6: refine the plain verdict flag with what actually
            // happened, when it's known -- falls back to verdict-only
            // when no outcome has been measured for that past decision.
            const outcomeDirections = await loadOutcomeDirections(admin, matches.map((m) => m.decisionId));
            // Item 10: older precedent counts for less -- weights decay
            // with each match's own age.
            const { nonAllowFlags, weights } = alignPrecedentSignals(matches, decisionById, outcomeDirections);
            const advice = evaluatePrecedentForAutoApprove(nonAllowFlags, weights);
            if (shouldRejectOnPrecedent(advice) && advice.available) {
              auto = { autoResolved: true, resolution: "rejected", status: "auto_rejected" };
              comment = summarizePrecedentOverride(advice);
              await recordPrecedentCitation(admin, input.decisionId, buildPrecedentCitationRecord(advice, matches, nonAllowFlags));
            }
          } catch { /* precedent is optional enrichment -- a lookup hiccup here must never block the real resolution */ }
        }
      }
    }
    // "Policy autonomy" plan, item 3: the LAST check before finalizing an
    // automatic APPROVAL -- runs after precedent above so quiet hours
    // never re-litigates a case precedent already pulled back to reject.
    // Never touches a denial (already the safe choice) or the callback
    // path (a real external system is asked in real time either way).
    if (auto.autoResolved && auto.resolution === "approved" && keyRow?.quiet_hours_timezone != null
      && keyRow.quiet_hours_start_hour != null && keyRow.quiet_hours_end_hour != null) {
      const quietConfig: QuietHoursConfig = {
        startHour: keyRow.quiet_hours_start_hour,
        endHour: keyRow.quiet_hours_end_hour,
        timezone: keyRow.quiet_hours_timezone,
      };
      if (isWithinQuietHours(now, quietConfig)) {
        auto = { autoResolved: false, resolution: null, status: "pending" };
        comment = summarizeQuietHoursEscalation(quietConfig);
      }
    }
    const resolvedAt = auto.autoResolved ? now.toISOString() : null;

    const { data } = await admin.from("pending_approvals").insert({
      user_id: input.userId,
      decision_id: input.decisionId,
      requester_id: input.userId,
      agent_id: input.agentId ?? null,
      run_id: input.runId ?? null,
      action_type: input.actionType,
      provider: input.provider,
      description: input.description.slice(0, 800),
      params: (input.params ?? {}) as Record<string, unknown>,
      reason: input.reason.slice(0, 800),
      risk_tier: input.riskTier ?? "medium",
      origin: input.origin,
      approver_role: input.approverRole ?? "owner",
      required_approvals: Math.max(1, Math.min(5, input.requiredApprovals ?? (input.riskTier === "high" ? 2 : 1))),
      status: auto.status,
      resolved_at: resolvedAt,
      comment,
    }).select("id").maybeSingle();
    const id = (data as { id?: string } | null)?.id ?? null;
    // "Zero human review" plan, item 6: a shadow policy is previewed
    // independently of whatever actually resolved this escalation (a real
    // policy, a human, or forcedResolution above) -- reuses
    // resolveSweepFallback, the exact same "what would this policy value
    // decide with no live model output or caller system left to consult"
    // logic item 5's safety-net sweep already needed for the identical
    // shape of problem. Only recorded when the shadow value would
    // genuinely auto-resolve something (never for 'human_review' or an
    // unrecognized value, which have nothing meaningful to preview) --
    // never lets a bad shadow config affect the real outcome above.
    if (id && keyRow?.shadow_on_uncertain) {
      const shadowGuess = resolveSweepFallback(keyRow.shadow_on_uncertain, keyRow.callback_fallback);
      if (shadowGuess.autoResolved && shadowGuess.resolution) {
        try {
          await admin.from("api_key_shadow_observations").insert({
            user_id: input.userId,
            api_key_id: input.apiKeyId,
            approval_id: id,
            action_type: input.actionType,
            provider: input.provider,
            shadow_resolution: shadowGuess.resolution,
          });
        } catch { /* shadow-mode observation must never affect the real outcome */ }
      }
    }
    // "Zero human review" plan, item 4: delegate to the caller's own
    // system instead of the generic human-facing webhook below -- a real
    // row was needed first (notifyAndAwaitCallback both notifies about
    // and polls THIS id), so this only happens once the insert above has
    // actually produced one.
    if (id && callbackConfig) {
      const delegated = await notifyAndAwaitCallback(admin, id, callbackConfig, {
        action_type: input.actionType,
        provider: input.provider,
        description: input.description,
        params: input.params ?? {},
        reason: input.reason,
      });
      // "Policy autonomy" plan, item 4: a broken callback URL should
      // eventually pull this key back to human_review, not silently lean
      // on its fallback forever. Tracking (and the downgrade itself) is
      // best-effort -- a hiccup here must never affect the real
      // resolution the caller already got back above.
      if (input.apiKeyId) {
        try {
          if (delegated.usedFallback) {
            const streak = (keyRow?.callback_failure_streak ?? 0) + 1;
            const updates: Record<string, unknown> = { callback_failure_streak: streak };
            const troubled = isCallbackFailureTrouble(streak);
            if (troubled) {
              updates.on_uncertain = "human_review";
              updates.on_uncertain_downgraded_at = now.toISOString();
              updates.on_uncertain_downgrade_reason = summarizePolicyDowngrade("callback_failures", String(streak));
            }
            await admin.from("api_keys").update(updates).eq("id", input.apiKeyId);
            if (troubled) {
              const summary = summarizePolicyDowngrade("callback_failures", String(streak));
              await sendCriticalAlert(admin, input.userId, { event: "on_uncertain_auto_downgraded", summary });
              await openIncident(admin, input.userId, { kind: "on_uncertain_auto_downgraded", summary });
              // "Knowledge & autonomy" plan, item 6: tell the account's
              // own systems the moment this happens, instead of making
              // them keep polling for it.
              await triggerWebhooks(admin, input.userId, "api_key_on_uncertain_downgraded", {
                api_key_id: input.apiKeyId, reason: summary,
              });
            }
          } else if ((keyRow?.callback_failure_streak ?? 0) > 0) {
            await admin.from("api_keys").update({ callback_failure_streak: 0 }).eq("id", input.apiKeyId);
          }
        } catch { /* tracking must never affect the real callback resolution already decided above */ }
      }
      return { approvalId: id, autoResolved: true, resolution: delegated.resolution };
    }
    // A resolution nobody needs to act on shouldn't page anyone -- only a
    // real, still-pending queue entry fires the human-facing webhook.
    if (id && !auto.autoResolved) {
      await triggerWebhooks(admin, input.userId, "approval_created", {
        approval_id: id,
        action_type: input.actionType,
        provider: input.provider,
        risk_tier: input.riskTier ?? "medium",
        reason: input.reason,
      });
    }
    return { approvalId: id, autoResolved: auto.autoResolved, resolution: auto.resolution };
  } catch {
    return { approvalId: null, autoResolved: false, resolution: null };
  }
}

/**
 * The real gate logic — has ~6 distinct early-return points (kill switch,
 * spend cap, hard rule, circuit breaker, safety scanner, anomaly detector)
 * plus the allow fallthrough and the fail-closed catch block, so timing is
 * NOT threaded through every individual `return` here. Instead the
 * exported runControlGate wrapper below times the whole call once and
 * persists it generically off whatever decisionId this returns.
 */
async function runControlGateInner(
  admin: SupabaseClient,
  ctx: GateContext,
): Promise<Omit<GateResult, "gateDurationMs">> {
  const { userId, actionType, provider } = ctx;
  const agentId = ctx.agentId ?? null;
  const runId = ctx.runId ?? null;
  const stepIndex = typeof ctx.stepIndex === "number" ? ctx.stepIndex : null;
  const apiKeyId = ctx.apiKeyId ?? null;
  const isTest = ctx.isTest === true;

  // ---- 0: pin the policy version that judges this action --------------------
  // The gate reads the ACTIVE policy version's snapshot, not the live tables, so
  // every decision is judged by an exact, auditable policy artifact.
  let policyVersion: number | null = null;
  let policyVersionId: string | null = null;
  let snapshot: PolicySnapshot = {};
  try {
    const { data: pv } = await admin.rpc("get_active_policy_version", { _user_id: userId });
    const row = (Array.isArray(pv) ? pv[0] : pv) as
      | { id?: string; version?: number; snapshot?: PolicySnapshot }
      | null;
    if (row) {
      policyVersion = typeof row.version === "number" ? row.version : null;
      policyVersionId = row.id ?? null;
      snapshot = (row.snapshot ?? {}) as PolicySnapshot;
    }
  } catch { /* fall back to live tables below */ }

  const trace: TraceEntry[] = [];

  const logStop = async (
    decision: string,
    reasoning: string,
    source: AgentDecisionSource,
    escalated: boolean,
    hardRuleId?: string | null,
    // The action payload -- ONLY passed by the two BLOCK call sites
    // (hard_rule, safety_scanner) that have it in scope and mean for it to
    // be replayable later by a break-glass override or a real-traffic
    // policy replay. Every other call site omits this, so it stays null
    // there, deliberately -- capturing the full params/description on
    // every block (kill switch, spend cap, circuit breaker), or on an
    // ALLOW verdict at all, is out of scope, not an oversight.
    params?: unknown,
    description?: string,
  ) => {
    try {
      const { data } = await admin.from("agent_decisions").insert({
        user_id: userId,
        agent_id: agentId,
        agent_run_id: runId,
        step_index: stepIndex,
        decision: decision.slice(0, 400),
        reasoning: reasoning.slice(0, 800),
        alternatives_considered: [],
        confidence_score: 100,
        source,
        escalated,
        policy_version: policyVersion,
        // Which hard rule actually enforced this, when the source is
        // "hard_rule" -- lets the rule-effectiveness finder answer "has this
        // live rule matched anything in the last N days" from real data
        // instead of guessing. Null for every other source.
        hard_rule_id: hardRuleId ?? null,
        action_type: actionType,
        provider,
        params: params ?? null,
        description: description ?? null,
        api_key_id: apiKeyId,
        is_test: isTest,
        // The trace array is closed over and already has every entry pushed
        // up to this call site — finalizeTrace fills the rest as not_reached.
        gate_trace: finalizeTrace(trace),
      }).select("id").maybeSingle();
      const decisionId = (data as { id?: string } | null)?.id ?? null;
      if (decisionId) {
        // Never lets a webhook-delivery hiccup turn an already-logged
        // decision's id into a null return (triggerWebhooks itself never
        // throws, but this is defense in depth, not reliance on that alone).
        try {
          await triggerWebhooks(admin, userId, "decision_logged", {
            id: decisionId, decision, source, escalated, agent_id: agentId,
          });
        } catch { /* ignore */ }
        // "Real precedent memory" plan, item 1: embeds using ctx's OWN
        // description/params (always in scope here, unlike this
        // closure's own params/description args above, which only ever
        // carry a value for the two BLOCK call sites and exist solely to
        // populate the STORED agent_decisions columns) -- a no-op
        // whenever apiKeyId is null, i.e. every non-external-api origin.
        // "Knowledge & autonomy" plan, item 7: also a no-op for a sandbox
        // key's own decisions -- a test key's traffic must never become
        // real, searchable precedent for anyone, including its own
        // account's real keys.
        if (countsTowardRealUsage(isTest)) {
          await embedDecisionIfExternal(admin, {
            decisionId, apiKeyId, userId, actionType, provider,
            description: ctx.description, params: ctx.params,
          });
        }
      }
      return decisionId;
    } catch {
      return null;
    }
  };

  // Everything below reads live tables (kill switch, hard rules, circuit
  // breaker, anomaly baseline) that can throw on a transient DB/network
  // error. Without this try/catch, that exception would propagate straight
  // out of runControlGate — safe ONLY because every current caller happens
  // to wrap its own call in a try/catch that aborts before executing
  // anything. That's an accident of caller structure, not a guarantee this
  // function makes. Fail closed explicitly, here, so the property holds no
  // matter what calls this later (including a future outer-NazAI caller).
  try {
  // ---- 0.5: platform-wide kill switch ---------------------------------------
  // Checked before EVERY other layer, for every account -- a platform
  // operator's emergency stop across the whole platform at once, distinct
  // from the per-account kill switch two lines below (that one's own
  // trace label was "Global kill switch," which is now actively
  // misleading now that a REAL platform-wide one exists -- relabeled to
  // "Account kill switch" just below). Reads platform_settings fresh on
  // every call, no caching, same "takes effect on the very next call"
  // property this project already holds api key revocation to. A read
  // failure here falls through to this same try block's own fail-closed
  // catch, same as every other check in this function -- no special
  // handling needed.
  const { data: platformRow } = await admin
    .from("platform_settings").select("kill_switch").eq("id", 1).maybeSingle();
  const platformKilled = (platformRow as { kill_switch?: boolean } | null)?.kill_switch === true;
  trace.push({
    layer: "platform_kill_switch", label: "Platform kill switch",
    status: platformKilled ? "stopped" : "ok",
    detail: platformKilled ? "A platform operator has paused every account" : null,
  });
  if (platformKilled) {
    const reason = "Blocked — a platform operator has paused all decision-gating across every account. This isn't specific to your account; try again shortly.";
    const decisionId = await logStop(`BLOCK ${actionType} (${provider})`, reason, "platform_kill_switch", false);
    return {
      ok: false, verdict: "block", reason, decisionId, source: "platform_kill_switch",
      approvalId: null,
      spend: { enabled: false, cap_usd: 0, spent_usd: 0, calls: 0, pct: 0, over_cap: false, day: new Date().toISOString().slice(0, 10) },
      safety: { matched: false, severity: null, matches: [], summary: null, shadowMatches: [] },
      shadowRules: [],
      hardRule: null,
      circuitBreaker: null,
      circuitBreakerHalfOpenTrial: false,
      anomaly: null,
      killSwitch: true,
      policyVersion,
      policyVersionId,
      trace: finalizeTrace(trace),
      recordShadowHits: async () => {},
      recordSafetyShadowHits: async () => {},
      recordAttempt: async () => null,
      autoResolved: false,
      autoResolutionReason: null,
    };
  }

  // ---- 1 & 2: spend cap + account-level kill switch --------------------------
  await clearExpiredSpendKillSwitch(admin, userId);
  const spend = await getSpendStatus(admin, userId);
  const { data: killRow } = await admin
    .from("profiles").select("kill_switch").eq("id", userId).maybeSingle();
  const killed = (killRow as { kill_switch?: boolean } | null)?.kill_switch === true;

  // ---- agent-level spend cap + kill switch (parallel to the account-wide
  // one above, only when this agent has its own cap configured or has
  // been individually killed -- an agent with neither is governed only by
  // the account-wide check, unchanged from before this existed) ----------
  let agentKilled = false;
  let agentSpend: Awaited<ReturnType<typeof getAgentSpendStatus>> | null = null;
  if (agentId) {
    await clearExpiredAgentSpendKillSwitch(admin, agentId);
    const [{ data: agentKillRow }, spendStatus] = await Promise.all([
      admin.from("agents").select("kill_switch").eq("id", agentId).maybeSingle(),
      getAgentSpendStatus(admin, userId, agentId),
    ]);
    agentKilled = (agentKillRow as { kill_switch?: boolean } | null)?.kill_switch === true;
    agentSpend = spendStatus;
  }

  // ---- hard rules (from the pinned snapshot; live tables only as fallback) ---
  let snapshotRules = Array.isArray(snapshot.hard_rules) ? (snapshot.hard_rules as HardRule[]) : null;
  if (!snapshotRules) {
    const { data: hardRules } = await admin
      .from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, agent_id, rationale")
      .eq("user_id", userId)
      // Deterministic match order: oldest rule wins a tie between two
      // enabled, overlapping rules. Without this, Postgres's return order
      // for an unordered SELECT is unspecified, so which rule "won" an
      // overlap could vary — exactly the ambiguity the rule-conflict
      // detector surfaces to customers, so evaluation itself needs to be
      // predictable for that warning to mean anything.
      .order("created_at", { ascending: true });
    snapshotRules = (hardRules ?? []) as HardRule[];
  }
  // Agent-scoped rules take precedence over the account-wide default --
  // selectRulesForAgent both excludes rules scoped to a DIFFERENT agent
  // and orders this agent's own rules first, so "first match wins" below
  // gives agent-specific rules precedence for free.
  const allRules = selectRulesForAgent(snapshotRules, agentId).filter((r) => (r as { enabled?: boolean }).enabled !== false);

  const ruleMatches = (r: HardRule) => ruleMatchesAction(r, actionType, provider);
  const shadowMatches = allRules.filter((r) => r.shadow_mode && ruleMatches(r));
  const shadowRules: ShadowHit[] = shadowMatches.map((r) => ({
    id: r.id,
    rule_text: r.rule_text,
    would_have: r.effect === "always_block" ? "block" : "require_approval",
    enforced: false,
  }));
  const recordShadowHits = async (decisionId: string | null, actualDecision: string) => {
    if (!shadowMatches.length) return;
    try {
      await admin.from("hard_rule_shadow_hits").insert(
        shadowMatches.map((r) => ({
          user_id: userId,
          rule_id: r.id,
          decision_id: decisionId,
          action_type: actionType,
          provider,
          would_have: r.effect === "always_block" ? "block" : "require_approval",
          actual_decision: actualDecision,
        })),
      );
    } catch { /* trial logging must never break a decision */ }
  };

  // ---- circuit breaker state --------------------------------------------
  // Per-agent, not account-wide-with-fallback (2026-08-22): when this
  // action is tied to an agent, its breaker lives ENTIRELY on that
  // agent's own row -- zero shared state with any other agent or the
  // account-wide row. Only an agent-less (chat-driven) action ever reads
  // the account-wide (agent_id NULL) row.
  type Breaker = {
    id: string; recent_outcomes: string[]; tripped: boolean;
    trip_count: number; tripped_at: string | null; failure_rate: number; last_reason: string | null;
  };
  const breakerQuery = admin
    .from("circuit_breakers")
    .select("id, recent_outcomes, tripped, trip_count, tripped_at, failure_rate, last_reason")
    .eq("user_id", userId)
    .eq("action_type", actionType);
  const { data: breakerRow } = await (agentId ? breakerQuery.eq("agent_id", agentId) : breakerQuery.is("agent_id", null)).maybeSingle();
  const breaker = (breakerRow as Breaker | null) ?? null;

  // Half-open cooldown: a tripped breaker whose tripped_at is old enough
  // lets exactly the NEXT attempt through as a trial, rather than staying
  // blocked forever until a human clicks reset. Every OTHER gate layer
  // still runs normally for this attempt -- this only bypasses the
  // breaker's own outright block.
  const isHalfOpenTrial = !!(
    breaker?.tripped && breaker.tripped_at &&
    (Date.now() - new Date(breaker.tripped_at).getTime() > BREAKER_COOLDOWN_MS)
  );

  const recordAttempt = async (failed: boolean, why: string) => {
    if (ctx.dryRun) return null;
    return await recordBreakerAttempt(admin, {
      userId,
      actionType,
      provider,
      failed,
      why,
      agentId,
      runId,
      stepIndex,
      policyVersion,
      isHalfOpenTrial,
    });
  };


  const emptyScan: SafetyScan = { matched: false, severity: null, matches: [], summary: null, shadowMatches: [] };
  const base = {
    spend,
    shadowRules,
    recordShadowHits,
    recordAttempt,
    // Overridden below once the safety scanner has actually run (steps 5+)
    // -- before that, nothing was scanned, so there's no shadow safety
    // data to record.
    recordSafetyShadowHits: async () => {},
    hardRule: null as GateResult["hardRule"],
    circuitBreaker: null as Record<string, unknown> | null,
    circuitBreakerHalfOpenTrial: isHalfOpenTrial,
    anomaly: null as AnomalyCheck | null,
    killSwitch: false,
    policyVersion,
    policyVersionId,
    approvalId: null as string | null,
    safety: emptyScan,
    trace: [] as TraceEntry[],
    autoResolved: false,
    autoResolutionReason: null as string | null,
  };

  trace.push({
    layer: "spend_cap", label: "Daily AI spend cap",
    status: spend.over_cap ? "stopped" : "ok",
    detail: spend.over_cap ? `$${spend.spent_usd.toFixed(2)} of $${spend.cap_usd.toFixed(2)} across ${spend.calls} calls` : null,
  });
  trace.push({
    layer: "kill_switch", label: "Account kill switch",
    status: killed ? "stopped" : "ok",
    detail: killed ? "Kill switch is on for this account" : null,
  });
  if (agentSpend?.has_cap || agentKilled) {
    trace.push({
      layer: "agent_spend_cap", label: "Agent spend cap",
      status: (agentSpend?.over_cap || agentKilled) ? "stopped" : "ok",
      detail: agentSpend?.over_cap
        ? `$${agentSpend.spent_usd.toFixed(2)} of $${agentSpend.cap_usd.toFixed(2)} across ${agentSpend.calls} calls (this agent only)`
        : agentKilled ? "This agent's own kill switch is on" : null,
    });
  }

  if (killed || spend.over_cap) {
    const reason = spend.over_cap
      ? `Blocked — today's AI spend cap is used up ($${spend.spent_usd.toFixed(2)} of $${spend.cap_usd.toFixed(2)} ` +
        `across ${spend.calls} calls). AI actions resume tomorrow, or when an owner raises the cap.`
      : "Blocked — kill switch active. All AI actions are halted for this account.";
    const decisionId = await logStop(
      `BLOCK ${actionType} (${provider})`, reason, spend.over_cap ? "ai_spend_cap" : "kill_switch", false,
    );
    await recordShadowHits(decisionId, "block");
    return {
      ...base, ok: false, verdict: "block", reason, decisionId,
      source: spend.over_cap ? "ai_spend_cap" : "kill_switch", killSwitch: true,
      trace: finalizeTrace(trace),
    };
  }

  // Agent-scoped stop: only this agent is blocked, the account-wide kill
  // switch is untouched and every other agent keeps running. Checked
  // after the account-wide gate above (an account-wide stop always wins).
  if (agentKilled || agentSpend?.over_cap) {
    const reason = agentSpend?.over_cap
      ? `Blocked — this agent's own daily AI spend cap is used up ($${agentSpend.spent_usd.toFixed(2)} of ` +
        `$${agentSpend.cap_usd.toFixed(2)} across ${agentSpend.calls} calls). Other agents on this account are unaffected.`
      : "Blocked — this agent's own kill switch is active. Other agents on this account are unaffected.";
    const decisionId = await logStop(
      `BLOCK ${actionType} (${provider})`, reason, agentSpend?.over_cap ? "agent_ai_spend_cap" : "agent_kill_switch", false,
    );
    await recordShadowHits(decisionId, "block");
    return {
      ...base, ok: false, verdict: "block", reason, decisionId,
      source: agentSpend?.over_cap ? "agent_ai_spend_cap" : "agent_kill_switch", killSwitch: true,
      trace: finalizeTrace(trace),
    };
  }

  // ---- 3: live hard rules ---------------------------------------------------
  const matched = allRules.find((r) => !r.shadow_mode && ruleMatches(r));
  trace.push({
    layer: "hard_rules", label: "Hard rules",
    status: matched ? "stopped" : "ok",
    detail: matched ? `Matched: "${matched.rule_text}"` : `${allRules.length} rule(s) checked, none matched`,
  });
  if (matched) {
    const blocking = matched.effect === "always_block";
    // "Policy autonomy" plan, item 1: name the rule AND why it exists,
    // when a rationale is set -- a rule with none yet reads exactly as
    // it always has.
    const why = matched.rationale ? ` Why this rule exists: ${matched.rationale}` : "";
    const reason = blocking
      ? `Blocked by your hard rule: "${matched.rule_text}".${why} This was enforced by your rule, not judged by the model.`
      : `Your hard rule requires approval first: "${matched.rule_text}".${why} Nothing ran — approve it explicitly to proceed.`;
    const decisionId = await logStop(
      `${blocking ? "BLOCK" : "APPROVAL_REQUIRED"} ${actionType} (${provider})`, reason, "hard_rule", !blocking, matched.id,
      // Only a real BLOCK needs its params/description captured for a
      // possible break-glass override or real-traffic policy replay -- an
      // APPROVAL_REQUIRED verdict already has its own params/description-
      // carrying pending_approvals row.
      blocking ? ctx.params : undefined,
      blocking ? ctx.description : undefined,
    );
    await recordShadowHits(decisionId, blocking ? "block" : "modify");
    let approvalId: string | null = null;
    let verdict: GateResult["verdict"] = blocking ? "block" : "require_approval";
    let ok = false;
    let finalReason = reason;
    let autoResolved = false;
    let autoResolutionReason: string | null = null;
    if (blocking) {
      await sendCriticalAlert(admin, userId, {
        event: "hard_rule_block",
        summary: `A proposed action was blocked by the hard rule "${matched.rule_text}". Nothing was scored or executed.`,
        decisionId,
        actionType,
        provider,
      });
    } else {
      const outcome = await createPendingApproval(admin, {
        userId, decisionId, agentId, runId, actionType, provider,
        description: ctx.description, params: ctx.params, reason, riskTier: "high", origin: ctx.origin,
        apiKeyId,
      });
      approvalId = outcome.approvalId;
      if (outcome.autoResolved) {
        autoResolved = true;
        ok = outcome.resolution === "approved";
        verdict = ok ? "allow" : "block";
        autoResolutionReason = `Resolved automatically to ${outcome.resolution} by this API key's configured policy — no human reviewed this.`;
      }
    }
    return {
      ...base,
      ok,
      verdict,
      reason: finalReason,
      decisionId,
      approvalId,
      source: "hard_rule",
      hardRule: { id: matched.id, rule_text: matched.rule_text, effect: matched.effect },
      trace: finalizeTrace(trace),
      autoResolved,
      autoResolutionReason,
    };
  }

  // ---- 4: circuit breaker ---------------------------------------------------
  trace.push({
    layer: "circuit_breaker", label: "Circuit breaker",
    status: (breaker?.tripped && !isHalfOpenTrial) ? "stopped" : "ok",
    detail: breaker
      ? `failure rate ${Math.round((breaker.failure_rate ?? 0) * 100)}% over last ${BREAKER_WINDOW} attempts` +
        (isHalfOpenTrial ? " (cooldown elapsed — letting this one attempt through as a recovery trial)" : "")
      : null,
  });
  if (breaker?.tripped && !isHalfOpenTrial) {
    const reason =
      `Blocked — the circuit breaker for "${actionType}" is tripped. ` +
      `${Math.round((breaker.failure_rate ?? 0) * 100)}% of the last ${BREAKER_WINDOW} attempts failed or were blocked, ` +
      `so this action type is paused until you reset it.`;
    const decisionId = await logStop(`BLOCK ${actionType} (${provider})`, reason, "circuit_breaker", false);
    await recordShadowHits(decisionId, "block");
    return {
      ...base,
      ok: false,
      verdict: "block",
      reason,
      decisionId,
      source: "circuit_breaker",
      circuitBreaker: {
        tripped: true,
        action_type: actionType,
        failure_rate: breaker.failure_rate,
        tripped_at: breaker.tripped_at,
        trip_count: breaker.trip_count,
        reset_hint: "Reset it in the Control System breaker panel to allow this action type again.",
      },
      trace: finalizeTrace(trace),
    };
  }

  // ---- 5: deterministic safety scanner (runs before any model judgement) ----
  const pinnedSafetyRules = Array.isArray(snapshot.safety_rules)
    ? (snapshot.safety_rules as SafetyRule[])
    : null;
  const safety = await scanAction(admin, userId, ctx.params, ctx.description, pinnedSafetyRules, agentId);
  trace.push({
    layer: "safety_scanner", label: "Safety scanner",
    status: (safety.matched && safety.severity) ? "stopped" : "ok",
    detail: safety.matched ? safety.summary : null,
  });
  // Same "would this have mattered" recording hard-rule shadow hits get --
  // only meaningful now that `safety` actually exists (nothing was scanned
  // before this point, so the no-op default in `base` covers every earlier
  // return).
  const recordSafetyShadowHits = async (decisionId: string | null, actualDecision: string) => {
    if (!safety.shadowMatches.length) return;
    try {
      await admin.from("safety_rule_shadow_hits").insert(
        safety.shadowMatches.map((m) => ({
          user_id: userId,
          rule_id: m.rule_id,
          decision_id: decisionId,
          action_type: actionType,
          provider,
          would_have: m.severity,
          actual_decision: actualDecision,
        })),
      );
    } catch { /* trial logging must never break a decision */ }
  };
  if (safety.matched && safety.severity) {
    const blocking = safety.severity === "block";
    const reason = safety.summary!;
    const decisionId = await logStop(
      `${blocking ? "BLOCK" : "APPROVAL_REQUIRED"} ${actionType} (${provider})`,
      `${reason}\nMatched: ${safety.matches.map((m) => `${m.name} on ${m.matched_on}`).join("; ")}`,
      "safety_scanner",
      !blocking,
      undefined,
      // Same rule as the hard_rule branch above: only a real BLOCK gets its
      // params/description captured.
      blocking ? ctx.params : undefined,
      blocking ? ctx.description : undefined,
    );
    await recordShadowHits(decisionId, blocking ? "block" : "modify");
    await recordSafetyShadowHits(decisionId, blocking ? "block" : "modify");
    // Real linkage for the safety-rule dead-rule finder (mirrors
    // agent_decisions.hard_rule_id) -- only custom rules, builtin ids
    // ("builtin:...") aren't real safety_rules rows to link against.
    const customMatches = safety.matches.filter((m) => !m.rule_id.startsWith("builtin:"));
    if (customMatches.length) {
      try {
        await admin.from("safety_rule_matches").insert(
          customMatches.map((m) => ({
            user_id: userId,
            rule_id: m.rule_id,
            decision_id: decisionId,
            action_type: actionType,
            provider,
          })),
        );
      } catch { /* trial logging must never break a decision */ }
    }
    let approvalId: string | null = null;
    let verdict: GateResult["verdict"] = blocking ? "block" : "require_approval";
    let ok = false;
    let autoResolved = false;
    let autoResolutionReason: string | null = null;
    if (!blocking) {
      const outcome = await createPendingApproval(admin, {
        userId, decisionId, agentId, runId, actionType, provider,
        description: ctx.description, params: ctx.params, reason, riskTier: "high", origin: ctx.origin,
        apiKeyId,
      });
      approvalId = outcome.approvalId;
      if (outcome.autoResolved) {
        autoResolved = true;
        ok = outcome.resolution === "approved";
        verdict = ok ? "allow" : "block";
        autoResolutionReason = `Resolved automatically to ${outcome.resolution} by this API key's configured policy — no human reviewed this.`;
      }
    }
    return {
      ...base,
      ok,
      verdict,
      reason,
      decisionId,
      approvalId,
      source: "safety_scanner",
      safety,
      recordSafetyShadowHits,
      trace: finalizeTrace(trace),
      autoResolved,
      autoResolutionReason,
    };
  }

  // ---- 6: per-agent behavioral-baseline anomaly detector ---------------------
  // Only meaningful when this action is tied to a specific agent with its own
  // history to baseline against — a one-off chat-originated action has none.
  if (agentId) {
    // Was previously dropping agentId, so an agent's own strictness override
    // (agent_strictness_overrides) was silently ignored here -- a "Strict"
    // agent got the account's default anomaly tolerance instead of its own,
    // contradicting this file's own header comment that anomaly sensitivity
    // "scales with the same org strictness dial as the confidence bar."
    const anomalyStrictness = await loadStrictness(admin, userId, agentId);
    const baseline = await loadAgentBaseline(admin, agentId);
    const todayCount = (await countTodaySuccesses(admin, agentId, actionType)) + 1; // +1: the one about to run
    const anomaly = detectAnomaly(baseline, actionType, todayCount, {}, anomalyStrictness);
    trace.push({
      layer: "anomaly_detector", label: "Anomaly detector",
      status: anomaly.anomalous ? "stopped" : "ok",
      detail: anomaly.anomalous ? anomaly.reason : null,
    });
    if (anomaly.anomalous) {
      const reason =
        `Unusual activity for this agent — ${anomaly.reason} Held for human review regardless of ` +
        `this action's own risk or confidence.`;
      const decisionId = await logStop(
        `APPROVAL_REQUIRED ${actionType} (${provider})`, reason, "anomaly_detector", true,
      );
      await recordShadowHits(decisionId, "modify");
      await recordSafetyShadowHits(decisionId, "modify");
      // In practice unreachable for origin: "external-api" today -- control-api
      // always passes agentId: null, and this whole branch is gated on agentId
      // above -- but wired identically to the other two call sites anyway so a
      // future external-api caller that DOES thread an agentId isn't left with
      // an inconsistent third path.
      const outcome = await createPendingApproval(admin, {
        userId, decisionId, agentId, runId, actionType, provider,
        description: ctx.description, params: ctx.params, reason, riskTier: "high", origin: ctx.origin,
        apiKeyId,
      });
      const autoResolved = outcome.autoResolved;
      const ok = autoResolved && outcome.resolution === "approved";
      const verdict: GateResult["verdict"] = autoResolved ? (ok ? "allow" : "block") : "require_approval";
      return {
        ...base,
        ok,
        verdict,
        reason,
        decisionId,
        approvalId: outcome.approvalId,
        source: "anomaly_detector",
        anomaly,
        safety,
        recordSafetyShadowHits,
        trace: finalizeTrace(trace),
        autoResolved,
        autoResolutionReason: autoResolved
          ? `Resolved automatically to ${outcome.resolution} by this API key's configured policy — no human reviewed this.`
          : null,
      };
    }
  } else {
    trace.push({
      layer: "anomaly_detector", label: "Anomaly detector",
      status: "skipped",
      detail: "No agent tied to this action — nothing to baseline against.",
    });
  }

  return { ...base, ok: true, verdict: "allow", reason: null, decisionId: null, source: null, safety, recordSafetyShadowHits, trace: finalizeTrace(trace) };
  } catch (err) {
    // Explicit fail-closed: an unexpected error while judging an action
    // means the action is BLOCKED, never allowed through by default. Best
    // effort to log and alert, but the block itself never depends on either
    // succeeding.
    const message = err instanceof Error ? err.message : String(err);
    // "Zero human review" plan, item 8: an api key can explicitly choose,
    // in advance, to fail OPEN instead of the platform's own default
    // fail-closed stance for exactly this case -- NazAI's own gate
    // throwing an unexpected error, never a deliberate kill switch (those
    // are separate, earlier return points in this same function, not
    // reachable from this catch block at all). Looked up in its own
    // try/catch: if reading the policy itself fails, this stays fail
    // CLOSED -- this is the one place in the whole gate where "I don't
    // know what to do" must never default to letting something through.
    let failOpen = false;
    if (apiKeyId) {
      try {
        const { data: keyRow } = await admin.from("api_keys").select("on_gate_error").eq("id", apiKeyId).maybeSingle();
        failOpen = (keyRow as { on_gate_error?: string } | null)?.on_gate_error === "allow";
      } catch { /* a failed policy lookup here must still fail closed, never open */ }
    }
    const reason = failOpen
      ? "Allowed — the control gate hit an unexpected error, but this API key is configured to fail OPEN during a NazAI outage rather than block. This action was NOT judged by any rule, safety scanner, or model."
      : "Blocked — the control gate hit an unexpected error and failed closed. Nothing was assessed or run.";
    const source: AgentDecisionSource = failOpen ? "gate_error_fail_open" : "gate_error";
    const emptyScan: SafetyScan = { matched: false, severity: null, matches: [], summary: null, shadowMatches: [] };
    let decisionId: string | null = null;
    try {
      const { data } = await admin.from("agent_decisions").insert({
        user_id: userId,
        agent_id: agentId,
        agent_run_id: runId,
        step_index: stepIndex,
        decision: `${failOpen ? "ALLOW" : "BLOCK"} ${actionType} (${provider})`.slice(0, 400),
        reasoning: `${reason}\n${message}`.slice(0, 800),
        alternatives_considered: [],
        confidence_score: 100,
        source,
        escalated: true,
        policy_version: policyVersion,
        gate_trace: finalizeTrace(trace),
        action_type: actionType,
        provider,
        api_key_id: apiKeyId,
        is_test: isTest,
      }).select("id").maybeSingle();
      decisionId = (data as { id?: string } | null)?.id ?? null;
    } catch { /* logging must never break the fail-closed/fail-open block */ }
    if (decisionId && countsTowardRealUsage(isTest)) {
      await embedDecisionIfExternal(admin, {
        decisionId, apiKeyId, userId, actionType, provider,
        description: ctx.description, params: ctx.params,
      });
    }
    try {
      await sendCriticalAlert(admin, userId, {
        event: failOpen ? "gate_error_fail_open" : "gate_error",
        summary: `${reason} (${message})`,
        decisionId,
        actionType,
        provider,
      });
    } catch { /* alerting must never break the fail-closed/fail-open block */ }
    // "15 more items" plan, item 4: gate_error is a real, listed
    // IncidentKind (incidents.ts explicitly calls out "the gate itself
    // failing closed" as incident-worthy) but this fail-closed block never
    // actually opened one -- only recorded the decision and alerted.
    // Fixed alongside control-engine/index.ts's own outer catch getting
    // the same three-part treatment for the first time. Still opened for
    // a fail-OPEN outcome too -- "every time that setting actually kicks
    // in, it's logged clearly as its own distinct, auditable event" (item
    // 8's own scope) applies just as much to an incident as to the
    // decision row above.
    try {
      await openIncident(admin, userId, {
        kind: failOpen ? "gate_error_fail_open" : "gate_error",
        summary: `${reason} (${message})`,
        actionType,
        provider,
        decisionId,
      });
    } catch { /* incident tracking must never break the fail-closed/fail-open block */ }
    return {
      ok: failOpen,
      verdict: failOpen ? "allow" : "block",
      reason,
      decisionId,
      source,
      approvalId: null,
      spend: { enabled: true, cap_usd: 0, spent_usd: 0, calls: 0, pct: 0, over_cap: false, day: new Date().toISOString().slice(0, 10) },
      safety: emptyScan,
      shadowRules: [],
      hardRule: null,
      circuitBreaker: null,
      circuitBreakerHalfOpenTrial: false,
      anomaly: null,
      killSwitch: false,
      policyVersion,
      policyVersionId,
      trace: finalizeTrace(trace),
      recordShadowHits: async () => {},
      recordSafetyShadowHits: async () => {},
      recordAttempt: async () => null,
      autoResolved: false,
      autoResolutionReason: null,
    };
  }
}

/**
 * Total gate latency, end to end — wraps runControlGateInner with a single
 * performance.now() start/stop rather than editing each of its internal
 * return points individually. Persisted onto whatever decision row that
 * call already logged (every early-return branch that stops/escalates an
 * action produces a decisionId; the allow fallthrough doesn't log its own
 * row here at all — the caller logs that one separately once model
 * scoring finishes, so there's nothing of the gate's own to attach this
 * to on that path). Never lets the persist step affect the real result.
 */
export async function runControlGate(admin: SupabaseClient, ctx: GateContext): Promise<GateResult> {
  const start = performance.now();
  const result = await runControlGateInner(admin, ctx);
  const gateDurationMs = Math.round(performance.now() - start);
  if (result.decisionId) {
    try {
      await admin.from("agent_decisions").update({ gate_duration_ms: gateDurationMs }).eq("id", result.decisionId);
    } catch { /* observability must never affect the gate's real result */ }
  }
  // "15 more items" plan, item 13: continuous whole-policy-version shadow
  // watching. Every live decision funnels through here regardless of
  // caller (control-engine, agent-runtime, control-api), making this the
  // one place to silently re-evaluate the SAME action against any DRAFT
  // policy version this account currently has marked "watching" -- a
  // no-op query for the overwhelming majority of accounts watching
  // nothing. Never let a failure here affect the real gate result.
  try {
    await recordPolicyWatchObservations(
      admin,
      ctx.userId,
      { action_type: ctx.actionType, provider: ctx.provider, description: ctx.description, params: ctx.params },
      result.verdict === "allow" ? "pass_through" : result.verdict,
      result.decisionId,
    );
  } catch { /* shadow-mode observation must never affect the gate's real result */ }
  return { ...result, gateDurationMs };
}

/**
 * Standalone circuit-breaker recorder — the same rolling-window logic the gate
 * uses internally, exposed so callers that route their gate decision through
 * the control-engine HTTP endpoint (e.g. agent-runtime) can still feed the real
 * execution outcome back into the breaker. Never throws.
 */
export async function recordBreakerAttempt(
  admin: SupabaseClient,
  input: {
    userId: string;
    actionType: string;
    provider: string;
    failed: boolean;
    why: string;
    agentId?: string | null;
    runId?: string | null;
    stepIndex?: number | null;
    policyVersion?: number | null;
    /** True when the gate let this attempt through as a half-open recovery
     * trial (breaker was tripped, but past its cooldown). The trial's own
     * outcome is decisive on its own -- it doesn't wait for the rolling
     * window to confirm a pattern the way a normal attempt does. */
    isHalfOpenTrial?: boolean;
  },
): Promise<Record<string, unknown> | null> {
  const { userId, actionType, provider, failed } = input;
  const agentId = input.agentId ?? null;
  const why = input.why ?? "";
  try {
    // Per-agent scoping (2026-08-22): a known agentId reads/writes ONLY
    // that agent's own row (agent_id = agentId); an agent-less action
    // reads/writes ONLY the account-wide row (agent_id IS NULL). Never a
    // mix of the two.
    const readQuery = admin
      .from("circuit_breakers")
      .select("id, recent_outcomes, tripped, trip_count")
      .eq("user_id", userId)
      .eq("action_type", actionType);
    const { data: breakerRow } = await (agentId ? readQuery.eq("agent_id", agentId) : readQuery.is("agent_id", null)).maybeSingle();
    const breaker = (breakerRow as { id?: string; recent_outcomes?: string[]; tripped?: boolean; trip_count?: number } | null) ?? null;

    const windowArr = [...(breaker?.recent_outcomes ?? []), failed ? "fail" : "ok"].slice(-BREAKER_WINDOW);
    const failures = windowArr.filter((o) => o === "fail").length;
    const rate = windowArr.length ? failures / windowArr.length : 0;
    const normalShouldTrip = windowArr.length >= BREAKER_MIN_ATTEMPTS && rate > BREAKER_FAIL_RATE;

    // A half-open trial's own outcome overrides the windowed calculation --
    // a single success must clear an already-tripped breaker outright (the
    // normal windowed math wouldn't: one "ok" among nine stale "fail"s in
    // the window still computes a >50% rate and would stay tripped), and a
    // single failure must re-trip immediately, not wait for a fresh run of
    // BREAKER_MIN_ATTEMPTS. A successful trial also resets the window
    // (rather than keeping the stale mostly-failed history) so the very
    // next real attempt after recovery isn't one bad outcome away from
    // re-tripping off leftover pre-cooldown failures.
    const isTrial = !!input.isHalfOpenTrial;
    const shouldTrip = isTrial ? failed : normalShouldTrip;
    const effectiveWindow = isTrial && !failed ? ["ok"] : windowArr;
    const effectiveFailures = isTrial && !failed ? 0 : failures;
    const effectiveRate = isTrial && !failed ? 0 : rate;

    const payload = {
      user_id: userId,
      agent_id: agentId,
      action_type: actionType,
      recent_outcomes: effectiveWindow,
      attempts: effectiveWindow.length,
      failures: effectiveFailures,
      failure_rate: Number(effectiveRate.toFixed(3)),
      tripped: shouldTrip,
      tripped_at: shouldTrip ? new Date().toISOString() : null,
      trip_count: (breaker?.trip_count ?? 0) + (shouldTrip ? 1 : 0),
      last_reason: failed ? why.slice(0, 400) : null,
      last_attempt_at: new Date().toISOString(),
    };
    // Two partial unique indexes back this table now (account-wide vs.
    // per-agent), so a plain upsert can no longer infer the right conflict
    // target -- same fix SpendCapPanel.tsx already applies client-side for
    // ai_spend_caps: find the row first, then update or insert explicitly.
    if (breaker?.id) {
      await admin.from("circuit_breakers").update(payload).eq("id", breaker.id);
    } else {
      await admin.from("circuit_breakers").insert(payload);
    }

    if (shouldTrip) {
      const tripReason =
        `Circuit breaker tripped for "${actionType}" — ${failures} of the last ${windowArr.length} attempts ` +
        `failed or were blocked (${Math.round(rate * 100)}%). This action type is now auto-blocked until reset. ` +
        `Last failure: ${why.slice(0, 200)}`;
      let tripId: string | null = null;
      try {
        const { data } = await admin.from("agent_decisions").insert({
          user_id: userId,
          agent_id: input.agentId ?? null,
          agent_run_id: input.runId ?? null,
          step_index: input.stepIndex ?? null,
          decision: `CIRCUIT_BREAKER_TRIPPED ${actionType} (${provider})`.slice(0, 400),
          reasoning: tripReason.slice(0, 800),
          alternatives_considered: [],
          confidence_score: 100,
          source: "circuit_breaker_trip" satisfies AgentDecisionSource,
          escalated: true,
          policy_version: input.policyVersion ?? null,
          action_type: actionType,
          provider,
        }).select("id").maybeSingle();
        tripId = (data as { id?: string } | null)?.id ?? null;
      } catch { /* logging must never break the breaker */ }
      if (!breaker?.tripped) {
        await sendCriticalAlert(admin, userId, {
          event: "circuit_breaker_trip",
          summary: tripReason,
          decisionId: tripId,
          actionType,
          provider,
        });
      }
    }

    const afterQuery = admin
      .from("circuit_breakers")
      .select("tripped, failure_rate, attempts, failures, trip_count, tripped_at")
      .eq("user_id", userId)
      .eq("action_type", actionType);
    const { data: after } = await (agentId ? afterQuery.eq("agent_id", agentId) : afterQuery.is("agent_id", null)).maybeSingle();
    return (after as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}
