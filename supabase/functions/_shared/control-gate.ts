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
import { clearExpiredSpendKillSwitch, getSpendStatus, type SpendStatus } from "./spend-guard.ts";
import { sendCriticalAlert } from "./critical-alerts.ts";
import { scanAction, type SafetyRule, type SafetyScan } from "./safety-scanner.ts";
import { countTodaySuccesses, detectAnomaly, loadAgentBaseline, type AnomalyCheck } from "./anomaly-detector.ts";
import { loadStrictness } from "./decision-scoring.ts";
import { finalizeTrace, type TraceEntry } from "./gate-trace.ts";
import { ruleMatchesAction, selectRulesForAgent } from "./rule-matching.ts";
import { triggerWebhooks } from "./webhooks.ts";

export const BREAKER_WINDOW = 10;
export const BREAKER_MIN_ATTEMPTS = 4;
export const BREAKER_FAIL_RATE = 0.5;

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
  origin: "control-engine" | "agent-runtime" | "agent-approval";
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
  anomaly: AnomalyCheck | null;
  killSwitch: boolean;
  /** The policy version whose snapshot judged this action. */
  policyVersion: number | null;
  policyVersionId: string | null;
  /** Every layer the gate checked, in order — not just the one that stopped it. */
  trace: TraceEntry[];
  /** Records what matching shadow rules WOULD have done, against the real verdict. */
  recordShadowHits: (decisionId: string | null, actualDecision: string) => Promise<void>;
  /** Feeds an attempt into the rolling circuit-breaker window. */
  recordAttempt: (failed: boolean, why: string) => Promise<Record<string, unknown> | null>;
};


type HardRule = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider: string | null;
  shadow_mode?: boolean;
  agent_id?: string | null;
};

/** Shape of a policy_versions.snapshot row (built by build_policy_snapshot). */
type PolicySnapshot = {
  hard_rules?: unknown;
  safety_rules?: unknown;
  thresholds?: unknown;
  spend_cap?: unknown;
  captured_at?: string;
};


/** Queue a human approval for an escalated action. Never throws. */
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
  },
): Promise<string | null> {
  try {
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
      status: "pending",
    }).select("id").maybeSingle();
    const id = (data as { id?: string } | null)?.id ?? null;
    if (id) {
      await triggerWebhooks(admin, input.userId, "approval_created", {
        approval_id: id,
        action_type: input.actionType,
        provider: input.provider,
        risk_tier: input.riskTier ?? "medium",
        reason: input.reason,
      });
    }
    return id;
  } catch {
    return null;
  }
}

export async function runControlGate(
  admin: SupabaseClient,
  ctx: GateContext,
): Promise<GateResult> {
  const { userId, actionType, provider } = ctx;
  const agentId = ctx.agentId ?? null;
  const runId = ctx.runId ?? null;
  const stepIndex = typeof ctx.stepIndex === "number" ? ctx.stepIndex : null;

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

  const logStop = async (decision: string, reasoning: string, source: string, escalated: boolean) => {
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
        // The trace array is closed over and already has every entry pushed
        // up to this call site — finalizeTrace fills the rest as not_reached.
        gate_trace: finalizeTrace(trace),
      }).select("id").maybeSingle();
      return (data as { id?: string } | null)?.id ?? null;
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
  // ---- 1 & 2: spend cap + global kill switch --------------------------------
  await clearExpiredSpendKillSwitch(admin, userId);
  const spend = await getSpendStatus(admin, userId);
  const { data: killRow } = await admin
    .from("profiles").select("kill_switch").eq("id", userId).maybeSingle();
  const killed = (killRow as { kill_switch?: boolean } | null)?.kill_switch === true;

  // ---- hard rules (from the pinned snapshot; live tables only as fallback) ---
  let snapshotRules = Array.isArray(snapshot.hard_rules) ? (snapshot.hard_rules as HardRule[]) : null;
  if (!snapshotRules) {
    const { data: hardRules } = await admin
      .from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, agent_id")
      .eq("user_id", userId);
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

  // ---- circuit breaker state ------------------------------------------------
  type Breaker = {
    id: string; recent_outcomes: string[]; tripped: boolean;
    trip_count: number; tripped_at: string | null; failure_rate: number; last_reason: string | null;
  };
  const { data: breakerRow } = await admin
    .from("circuit_breakers")
    .select("id, recent_outcomes, tripped, trip_count, tripped_at, failure_rate, last_reason")
    .eq("user_id", userId)
    .eq("action_type", actionType)
    .maybeSingle();
  const breaker = (breakerRow as Breaker | null) ?? null;

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
    });
  };


  const emptyScan: SafetyScan = { matched: false, severity: null, matches: [], summary: null };
  const base = {
    spend,
    shadowRules,
    recordShadowHits,
    recordAttempt,
    hardRule: null as GateResult["hardRule"],
    circuitBreaker: null as Record<string, unknown> | null,
    anomaly: null as AnomalyCheck | null,
    killSwitch: false,
    policyVersion,
    policyVersionId,
    approvalId: null as string | null,
    safety: emptyScan,
    trace: [] as TraceEntry[],
  };

  trace.push({
    layer: "spend_cap", label: "Daily AI spend cap",
    status: spend.over_cap ? "stopped" : "ok",
    detail: spend.over_cap ? `$${spend.spent_usd.toFixed(2)} of $${spend.cap_usd.toFixed(2)} across ${spend.calls} calls` : null,
  });
  trace.push({
    layer: "kill_switch", label: "Global kill switch",
    status: killed ? "stopped" : "ok",
    detail: killed ? "Kill switch is on for this account" : null,
  });

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

  // ---- 3: live hard rules ---------------------------------------------------
  const matched = allRules.find((r) => !r.shadow_mode && ruleMatches(r));
  trace.push({
    layer: "hard_rules", label: "Hard rules",
    status: matched ? "stopped" : "ok",
    detail: matched ? `Matched: "${matched.rule_text}"` : `${allRules.length} rule(s) checked, none matched`,
  });
  if (matched) {
    const blocking = matched.effect === "always_block";
    const reason = blocking
      ? `Blocked by your hard rule: "${matched.rule_text}". This was enforced by your rule, not judged by the model.`
      : `Your hard rule requires approval first: "${matched.rule_text}". Nothing ran — approve it explicitly to proceed.`;
    const decisionId = await logStop(
      `${blocking ? "BLOCK" : "APPROVAL_REQUIRED"} ${actionType} (${provider})`, reason, "hard_rule", !blocking,
    );
    await recordShadowHits(decisionId, blocking ? "block" : "modify");
    let approvalId: string | null = null;
    if (blocking) {
      await sendCriticalAlert(admin, userId, {
        event: "hard_rule_block",
        summary: `A proposed action was blocked by the hard rule "${matched.rule_text}". Nothing was scored or executed.`,
        decisionId,
        actionType,
        provider,
      });
    } else {
      approvalId = await createPendingApproval(admin, {
        userId, decisionId, agentId, runId, actionType, provider,
        description: ctx.description, params: ctx.params, reason, riskTier: "high", origin: ctx.origin,
      });
    }
    return {
      ...base,
      ok: false,
      verdict: blocking ? "block" : "require_approval",
      reason,
      decisionId,
      approvalId,
      source: "hard_rule",
      hardRule: { id: matched.id, rule_text: matched.rule_text, effect: matched.effect },
      trace: finalizeTrace(trace),
    };
  }

  // ---- 4: circuit breaker ---------------------------------------------------
  trace.push({
    layer: "circuit_breaker", label: "Circuit breaker",
    status: breaker?.tripped ? "stopped" : "ok",
    detail: breaker ? `failure rate ${Math.round((breaker.failure_rate ?? 0) * 100)}% over last ${BREAKER_WINDOW} attempts` : null,
  });
  if (breaker?.tripped) {
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
  if (safety.matched && safety.severity) {
    const blocking = safety.severity === "block";
    const reason = safety.summary!;
    const decisionId = await logStop(
      `${blocking ? "BLOCK" : "APPROVAL_REQUIRED"} ${actionType} (${provider})`,
      `${reason}\nMatched: ${safety.matches.map((m) => `${m.name} on ${m.matched_on}`).join("; ")}`,
      "safety_scanner",
      !blocking,
    );
    await recordShadowHits(decisionId, blocking ? "block" : "modify");
    let approvalId: string | null = null;
    if (!blocking) {
      approvalId = await createPendingApproval(admin, {
        userId, decisionId, agentId, runId, actionType, provider,
        description: ctx.description, params: ctx.params, reason, riskTier: "high", origin: ctx.origin,
      });
    }
    return {
      ...base,
      ok: false,
      verdict: blocking ? "block" : "require_approval",
      reason,
      decisionId,
      approvalId,
      source: "safety_scanner",
      safety,
      trace: finalizeTrace(trace),
    };
  }

  // ---- 6: per-agent behavioral-baseline anomaly detector ---------------------
  // Only meaningful when this action is tied to a specific agent with its own
  // history to baseline against — a one-off chat-originated action has none.
  if (agentId) {
    const anomalyStrictness = await loadStrictness(admin, userId);
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
      const approvalId = await createPendingApproval(admin, {
        userId, decisionId, agentId, runId, actionType, provider,
        description: ctx.description, params: ctx.params, reason, riskTier: "high", origin: ctx.origin,
      });
      return {
        ...base,
        ok: false,
        verdict: "require_approval",
        reason,
        decisionId,
        approvalId,
        source: "anomaly_detector",
        anomaly,
        trace: finalizeTrace(trace),
      };
    }
  } else {
    trace.push({
      layer: "anomaly_detector", label: "Anomaly detector",
      status: "skipped",
      detail: "No agent tied to this action — nothing to baseline against.",
    });
  }

  return { ...base, ok: true, verdict: "allow", reason: null, decisionId: null, source: null, safety, trace: finalizeTrace(trace) };
  } catch (err) {
    // Explicit fail-closed: an unexpected error while judging an action
    // means the action is BLOCKED, never allowed through by default. Best
    // effort to log and alert, but the block itself never depends on either
    // succeeding.
    const message = err instanceof Error ? err.message : String(err);
    const reason = "Blocked — the control gate hit an unexpected error and failed closed. Nothing was assessed or run.";
    const emptyScan: SafetyScan = { matched: false, severity: null, matches: [], summary: null };
    let decisionId: string | null = null;
    try {
      const { data } = await admin.from("agent_decisions").insert({
        user_id: userId,
        agent_id: agentId,
        agent_run_id: runId,
        step_index: stepIndex,
        decision: `BLOCK ${actionType} (${provider})`.slice(0, 400),
        reasoning: `${reason}\n${message}`.slice(0, 800),
        alternatives_considered: [],
        confidence_score: 100,
        source: "gate_error",
        escalated: true,
        policy_version: policyVersion,
        gate_trace: finalizeTrace(trace),
      }).select("id").maybeSingle();
      decisionId = (data as { id?: string } | null)?.id ?? null;
    } catch { /* logging must never break the fail-closed block */ }
    try {
      await sendCriticalAlert(admin, userId, {
        event: "gate_error",
        summary: `${reason} (${message})`,
        decisionId,
        actionType,
        provider,
      });
    } catch { /* alerting must never break the fail-closed block */ }
    return {
      ok: false,
      verdict: "block",
      reason,
      decisionId,
      source: "gate_error",
      approvalId: null,
      spend: { enabled: true, cap_usd: 0, spent_usd: 0, calls: 0, pct: 0, over_cap: false, day: new Date().toISOString().slice(0, 10) },
      safety: emptyScan,
      shadowRules: [],
      hardRule: null,
      circuitBreaker: null,
      anomaly: null,
      killSwitch: false,
      policyVersion,
      policyVersionId,
      trace: finalizeTrace(trace),
      recordShadowHits: async () => {},
      recordAttempt: async () => null,
    };
  }
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
  },
): Promise<Record<string, unknown> | null> {
  const { userId, actionType, provider, failed } = input;
  const why = input.why ?? "";
  try {
    const { data: breakerRow } = await admin
      .from("circuit_breakers")
      .select("recent_outcomes, tripped, trip_count")
      .eq("user_id", userId)
      .eq("action_type", actionType)
      .maybeSingle();
    const breaker = (breakerRow as { recent_outcomes?: string[]; tripped?: boolean; trip_count?: number } | null) ?? null;

    const windowArr = [...(breaker?.recent_outcomes ?? []), failed ? "fail" : "ok"].slice(-BREAKER_WINDOW);
    const failures = windowArr.filter((o) => o === "fail").length;
    const rate = windowArr.length ? failures / windowArr.length : 0;
    const shouldTrip = windowArr.length >= BREAKER_MIN_ATTEMPTS && rate > BREAKER_FAIL_RATE;

    await admin.from("circuit_breakers").upsert({
      user_id: userId,
      action_type: actionType,
      recent_outcomes: windowArr,
      attempts: windowArr.length,
      failures,
      failure_rate: Number(rate.toFixed(3)),
      tripped: shouldTrip,
      tripped_at: shouldTrip ? new Date().toISOString() : null,
      trip_count: (breaker?.trip_count ?? 0) + (shouldTrip ? 1 : 0),
      last_reason: failed ? why.slice(0, 400) : null,
      last_attempt_at: new Date().toISOString(),
    }, { onConflict: "user_id,action_type" });

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
          source: "circuit_breaker_trip",
          escalated: true,
          policy_version: input.policyVersion ?? null,
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

    const { data: after } = await admin
      .from("circuit_breakers")
      .select("tripped, failure_rate, attempts, failures, trip_count, tripped_at")
      .eq("user_id", userId)
      .eq("action_type", actionType)
      .maybeSingle();
    return (after as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}
