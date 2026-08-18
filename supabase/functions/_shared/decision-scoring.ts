// Shared decision scoring + provenance logging.
// One decision engine: agent-runtime and the AI Control System chat both score
// confidence the same way and write to the SAME agent_decisions table.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

/** Read the org's strictness dial off the profile row. Never throws. */
export const loadStrictness = async (
  supabase: SupabaseClient,
  userId: string,
): Promise<Strictness> => {
  try {
    const { data } = await supabase
      .from("profiles").select("control_strictness").eq("id", userId).maybeSingle();
    return normalizeStrictness((data as { control_strictness?: string } | null)?.control_strictness);
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
    }).select("id").single();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
};
