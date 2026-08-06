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

/** Risk tier raises the bar a decision must clear before it runs unattended. */
export const thresholdForRisk = (
  riskTier: string,
  base = DEFAULT_CONFIDENCE_THRESHOLD,
): number => {
  const bump = riskTier === "high" ? 25 : riskTier === "medium" ? 10 : 0;
  return Math.max(0, Math.min(100, base + bump));
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
    }).select("id").single();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
};
