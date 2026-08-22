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
import { scanAction, type SafetyRule, type SafetyScan } from "./safety-scanner.ts";
import { countTodaySuccesses, detectAnomaly, loadAgentBaseline, type AnomalyCheck } from "./anomaly-detector.ts";
import { loadStrictness } from "./decision-scoring.ts";
import { finalizeTrace, type TraceEntry } from "./gate-trace.ts";
import { ruleMatchesAction, selectRulesForAgent } from "./rule-matching.ts";
import { triggerWebhooks } from "./webhooks.ts";

export const BREAKER_WINDOW = 10;
export const BREAKER_MIN_ATTEMPTS = 4;
export const BREAKER_FAIL_RATE = 0.5;

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
  /** Total wall-clock time the gate spent on this call, in milliseconds. */
  gateDurationMs: number;
  /** Records what matching shadow rules WOULD have done, against the real verdict. */
  recordShadowHits: (decisionId: string | null, actualDecision: string) => Promise<void>;
  /** Same, for shadow-mode safety rules (safety.shadowMatches). */
  recordSafetyShadowHits: (decisionId: string | null, actualDecision: string) => Promise<void>;
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
  // ---- 1 & 2: spend cap + global kill switch --------------------------------
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
      .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, agent_id")
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
    const reason = blocking
      ? `Blocked by your hard rule: "${matched.rule_text}". This was enforced by your rule, not judged by the model.`
      : `Your hard rule requires approval first: "${matched.rule_text}". Nothing ran — approve it explicitly to proceed.`;
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
      recordSafetyShadowHits,
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
      await recordSafetyShadowHits(decisionId, "modify");
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
        safety,
        recordSafetyShadowHits,
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

  return { ...base, ok: true, verdict: "allow", reason: null, decisionId: null, source: null, safety, recordSafetyShadowHits, trace: finalizeTrace(trace) };
  } catch (err) {
    // Explicit fail-closed: an unexpected error while judging an action
    // means the action is BLOCKED, never allowed through by default. Best
    // effort to log and alert, but the block itself never depends on either
    // succeeding.
    const message = err instanceof Error ? err.message : String(err);
    const reason = "Blocked — the control gate hit an unexpected error and failed closed. Nothing was assessed or run.";
    const emptyScan: SafetyScan = { matched: false, severity: null, matches: [], summary: null, shadowMatches: [] };
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
        source: "gate_error" satisfies AgentDecisionSource,
        escalated: true,
        policy_version: policyVersion,
        gate_trace: finalizeTrace(trace),
        action_type: actionType,
        provider,
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
      recordSafetyShadowHits: async () => {},
      recordAttempt: async () => null,
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
    const shouldTrip = windowArr.length >= BREAKER_MIN_ATTEMPTS && rate > BREAKER_FAIL_RATE;

    const payload = {
      user_id: userId,
      agent_id: agentId,
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
