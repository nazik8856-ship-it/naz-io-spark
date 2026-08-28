// Shared decision scoring + provenance logging.
// One decision engine: agent-runtime and the AI Control System chat both score
// confidence the same way and write to the SAME agent_decisions table.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { triggerWebhooks } from "./webhooks.ts";
import { embedDecisionIfExternal } from "./decision-embeddings.ts";
import { countsTowardRealUsage } from "./sandbox-mode.ts";

export const DEFAULT_CONFIDENCE_THRESHOLD = 60;

export const scoreFromLabel = (label: string): number =>
  label === "high" ? 90 : label === "medium" ? 65 : label === "low" ? 35 : 50;

export const labelFromScore = (n: number): "high" | "medium" | "low" =>
  n >= 80 ? "high" : n >= 50 ? "medium" : "low";

export const readConfidence = (p: Record<string, unknown>): { score: number; label: string } => {
  const rawScore = p.confidence_score;
  let score: number | null = null;
  if (typeof rawScore === "number" && Number.isFinite(rawScore)) score = rawScore;
  else if (typeof rawScore === "string" && rawScore.trim() !== "" && !Number.isNaN(Number(rawScore))) score = Number(rawScore);
  const labelRaw = typeof p.confidence === "string" ? p.confidence.trim().toLowerCase() : "";
  const label = labelRaw === "high" || labelRaw === "medium" || labelRaw === "low" ? labelRaw : "";
  if (score === null) return { score: label ? scoreFromLabel(label) : 50, label: label || "medium" };
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: label || labelFromScore(score) };
};

export const normalizeAlternatives = (alternatives: unknown): string[] =>
  Array.isArray(alternatives)
    ? alternatives.map((a) => String(a).slice(0, 200)).slice(0, 8)
    : typeof alternatives === "string" && alternatives.trim()
    ? [alternatives.slice(0, 200)]
    : [];

/* ---------------------------------------------------------------------------
 * ORG STRICTNESS
 * One dial (loose / balanced / strict) that scales every tolerance in the
 * control engine: the confidence bar, how much risk raises that bar, whether
 * an unclear business fit is enough to park an action, and how small the
 * irreversibility blast radius has to be before a human must sign off.
 * ------------------------------------------------------------------------- */
export type Strictness = "loose" | "balanced" | "strict";

export const STRICTNESS_PRESETS: Record<Strictness, {
  label: string;
  blurb: string;
  /** Shift applied to the base confidence bar. */
  baseShift: number;
  /** Extra bar added per risk tier. */
  riskBump: { low: number; medium: number; high: number };
  /** Park the action when the business fit is merely "unclear". */
  deferOnUnclearFit: boolean;
  /** Risk tiers where an irreversible action always needs a human. */
  irreversibleNeedsHuman: Array<"low" | "medium" | "high">;
}> = {
  loose: {
    label: "Loose",
    blurb: "Higher tolerance — more runs through on its own, fewer things stop for you.",
    baseShift: -15,
    riskBump: { low: 0, medium: 5, high: 15 },
    deferOnUnclearFit: false,
    irreversibleNeedsHuman: ["high"],
  },
  balanced: {
    label: "Balanced",
    blurb: "The default — escalates low-confidence and high-risk work only.",
    baseShift: 0,
    riskBump: { low: 0, medium: 10, high: 25 },
    deferOnUnclearFit: false,
    irreversibleNeedsHuman: ["high"],
  },
  strict: {
    label: "Strict",
    blurb: "Low tolerance — narrow confidence bands, unclear fit gets parked, more sign-offs.",
    baseShift: 15,
    riskBump: { low: 10, medium: 20, high: 35 },
    deferOnUnclearFit: true,
    irreversibleNeedsHuman: ["medium", "high"],
  },
};

export const normalizeStrictness = (v: unknown): Strictness =>
  v === "loose" || v === "strict" ? v : "balanced";

/** Risk tier raises the bar a decision must clear before it runs unattended. */
export const thresholdForRisk = (
  riskTier: string,
  base = DEFAULT_CONFIDENCE_THRESHOLD,
  strictness: Strictness = "balanced",
): number => {
  const preset = STRICTNESS_PRESETS[strictness];
  const tier = riskTier === "high" ? "high" : riskTier === "medium" ? "medium" : "low";
  const bar = base + preset.baseShift + preset.riskBump[tier];
  return Math.max(0, Math.min(100, Math.round(bar)));
};

/** Does an irreversible action at this risk tier always need a human? */
export const irreversibleNeedsHuman = (riskTier: string, strictness: Strictness = "balanced"): boolean =>
  STRICTNESS_PRESETS[strictness].irreversibleNeedsHuman.includes(
    (riskTier === "high" ? "high" : riskTier === "medium" ? "medium" : "low"),
  );

/** Should this fit assessment park the action? */
export const fitDefers = (fit: string, strictness: Strictness = "balanced"): boolean =>
  fit === "not_a_fit" || (fit === "unclear" && STRICTNESS_PRESETS[strictness].deferOnUnclearFit);

export type StrictnessOverrideRow = { strictness?: string | null } | null | undefined;
export type ProfileStrictnessRow = { control_strictness?: string | null } | null | undefined;

/**
 * Pure — an agent-specific strictness override wins when set; otherwise
 * falls back to the account-wide default. Same precedence rule as every
 * other per-agent policy this session (hard rules, safety rules, spend
 * cap): agent-specific overrides, account-wide is the fallback for every
 * agent that never sets one.
 */
export function resolveStrictness(overrideRow: StrictnessOverrideRow, profileRow: ProfileStrictnessRow): Strictness {
  if (overrideRow?.strictness) return normalizeStrictness(overrideRow.strictness);
  return normalizeStrictness(profileRow?.control_strictness);
}

/**
 * Read the effective strictness dial: this agent's own override if one is
 * configured (agentId given and a row exists), otherwise the account-wide
 * profile default. Never throws.
 */
export const loadStrictness = async (
  supabase: SupabaseClient,
  userId: string,
  agentId?: string | null,
): Promise<Strictness> => {
  try {
    const [{ data: override }, { data: profile }] = await Promise.all([
      agentId
        ? supabase.from("agent_strictness_overrides").select("strictness").eq("agent_id", agentId).maybeSingle()
        : Promise.resolve({ data: null as StrictnessOverrideRow }),
      supabase.from("profiles").select("control_strictness").eq("id", userId).maybeSingle(),
    ]);
    return resolveStrictness(override as StrictnessOverrideRow, profile as ProfileStrictnessRow);
  } catch {
    return "balanced";
  }
};

export const shouldEscalate = (score: number, threshold: number): boolean => score < threshold;

/** Insert a provenance row. Never throws — provenance must not break a run. */
export const logDecision = async (
  supabase: SupabaseClient,
  scope: { userId: string; agentId?: string | null; runId?: string | null },
  d: {
    decision: string;
    reasoning: string;
    alternatives: unknown;
    score: number;
    stepIndex?: number;
    escalated?: boolean;
    source?: string;
    /** The policy version whose snapshot judged this decision. */
    policyVersion?: number | null;
    /** The full gate trace (every layer checked) that judged this action before the model ever ran. */
    trace?: unknown;
    /** Structured mirror of what's already embedded in `decision`'s free text -- lets a filterable decision log (or a future real-traffic policy replay) query directly instead of regex-parsing. */
    actionType?: string | null;
    provider?: string | null;
    /** Which api_keys row authenticated this request, when it came through the public control-api endpoint. Null for every other caller. */
    apiKeyId?: string | null;
    /** "Knowledge & autonomy" plan, item 7: true only when apiKeyId names a sandbox/test-mode key. Stamped onto the row and used to skip embedding storage (see sandbox-mode.ts) -- a test key's decisions must never become real, searchable precedent. */
    isTest?: boolean;
    /** "Knowledge & autonomy" plan, item 12: this decision's own plan_id (opaque, caller-chosen), when the caller sent one -- stamped onto the row so a LATER decision in the same plan can look up whether this one came back BLOCK (plan-escalation.ts, consulted by createPendingApproval). */
    planId?: string | null;
    /** "Real precedent memory" plan, item 1: the raw action, present only when the caller has it in scope (control-engine's model-scored path does) -- used solely to build this decision's embedding, never stored on the row itself, which only ever answers "what happened," not the exact payload. Omitted entirely (agent-runtime) means no embedding is attempted, same as apiKeyId being null. */
    description?: string | null;
    params?: unknown;
  },
): Promise<string | null> => {
  try {
    const { data } = await supabase.from("agent_decisions").insert({
      user_id: scope.userId,
      agent_id: scope.agentId ?? null,
      agent_run_id: scope.runId ?? null,
      step_index: d.stepIndex ?? null,
      decision: d.decision.slice(0, 400) || "unspecified",
      reasoning: d.reasoning.slice(0, 800),
      alternatives_considered: normalizeAlternatives(d.alternatives),
      confidence_score: Math.max(0, Math.min(100, Math.round(d.score))),
      source: d.source ?? "model",
      escalated: d.escalated ?? false,
      policy_version: d.policyVersion ?? null,
      gate_trace: d.trace ?? null,
      action_type: d.actionType ?? null,
      provider: d.provider ?? null,
      api_key_id: d.apiKeyId ?? null,
      is_test: d.isTest === true,
      plan_id: d.planId ?? null,
    }).select("id").single();
    const decisionId = (data as { id?: string } | null)?.id ?? null;
    if (decisionId) {
      // triggerWebhooks already never throws on its own, but the decision
      // was already successfully logged at this point either way -- this
      // must never be what turns a real decisionId into a null return.
      try {
        await triggerWebhooks(supabase, scope.userId, "decision_logged", {
          id: decisionId, decision: d.decision, source: d.source ?? "model",
          escalated: d.escalated ?? false, agent_id: scope.agentId ?? null,
        });
      } catch { /* ignore */ }
      // "Knowledge & autonomy" plan, item 7: a sandbox key's decision is
      // still logged (so its own caller can see its own test traffic) but
      // never embedded -- must never become real, searchable precedent.
      if (countsTowardRealUsage(d.isTest)) {
        await embedDecisionIfExternal(supabase, {
          decisionId, apiKeyId: d.apiKeyId, userId: scope.userId,
          actionType: d.actionType ?? "", provider: d.provider ?? "unknown",
          description: d.description ?? "", params: d.params,
        });
      }
    }
    return decisionId;
  } catch {
    return null;
  }
};
