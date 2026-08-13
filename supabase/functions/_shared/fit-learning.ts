// Fit/Value learning loop.
//
// The risk/confidence loop already learns from measured outcomes. This does the
// same for the FIT dimension: every time a human OVERRODE a "Deferred — not a
// fit" verdict and let the action run, `measure-decision-outcomes` measures what
// actually happened. Those measured results are read back here and fed to the
// control engine, so the fit model stops parking things the business keeps
// proving valuable — and keeps parking the ones that measured badly.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type FitEvidence = {
  /** Overridden defers that measured well / badly. */
  positive: number;
  negative: number;
  neutral: number;
  samples: Array<{ decision: string; direction: string; metric: string; delta_pct: number | null }>;
  /** Prompt text injected into the control-engine system message. */
  promptBlock: string;
  /** Confidence nudge (-10..+10) applied to the model's own assessment. */
  nudge: number;
  /** Plain-language note surfaced on the decision card. */
  note: string | null;
};

export const EMPTY_FIT_EVIDENCE: FitEvidence = {
  positive: 0, negative: 0, neutral: 0, samples: [], promptBlock: "", nudge: 0, note: null,
};

const STOP = new Set(["the", "a", "an", "to", "for", "and", "of", "in", "on", "with", "this", "that", "all"]);

const tokens = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));

/** Cheap token-overlap similarity, same shape as the runtime's outcome matcher. */
export const similarity = (a: string, b: string): number => {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
};

/**
 * Load measured outcomes of past "not a fit" verdicts a human overrode, scoped
 * to actions similar to the one being judged now. Never throws.
 */
export const loadFitEvidence = async (
  supabase: SupabaseClient,
  userId: string,
  action: { actionType: string; provider: string; description: string },
): Promise<FitEvidence> => {
  try {
    // Deferred verdicts a human explicitly allowed anyway.
    const { data: overridden } = await supabase
      .from("agent_decisions")
      .select("id, decision, reasoning, human_response, created_at")
      .eq("user_id", userId)
      .eq("human_response", "allowed")
      .ilike("decision", "DEFERRED%")
      .order("created_at", { ascending: false })
      .limit(60);

    const rows = (overridden ?? []) as Array<{ id: string; decision: string; reasoning: string }>;
    if (!rows.length) return EMPTY_FIT_EVIDENCE;

    const target = `${action.actionType} ${action.provider} ${action.description}`;
    const related = rows
      .map((r) => ({ ...r, sim: similarity(target, `${r.decision} ${r.reasoning}`) }))
      .filter((r) => r.sim >= 0.18 || r.decision.toLowerCase().includes(action.actionType.toLowerCase()))
      .slice(0, 12);
    if (!related.length) return EMPTY_FIT_EVIDENCE;

    const { data: outcomes } = await supabase
      .from("decision_outcomes")
      .select("decision_id, direction, linked_metric, delta_pct, provider")
      .in("decision_id", related.map((r) => r.id))
      .order("measured_at", { ascending: false })
      .limit(120);

    const byDecision = new Map(related.map((r) => [r.id, r]));
    let positive = 0, negative = 0, neutral = 0;
    const samples: FitEvidence["samples"] = [];
    for (const o of (outcomes ?? []) as Array<Record<string, unknown>>) {
      const dir = String(o.direction);
      if (dir === "positive") positive++;
      else if (dir === "negative") negative++;
      else { neutral++; continue; }
      if (samples.length < 6) {
        samples.push({
          decision: String(byDecision.get(String(o.decision_id))?.decision ?? "").slice(0, 140),
          direction: dir,
          metric: String(o.linked_metric ?? ""),
          delta_pct: typeof o.delta_pct === "number" ? o.delta_pct : null,
        });
      }
    }

    if (!positive && !negative) return { ...EMPTY_FIT_EVIDENCE, neutral };

    const net = positive - negative;
    const nudge = Math.max(-10, Math.min(10, net * 5));
    const note = net > 0
      ? `Fit history: ${positive} similar action(s) you overrode as "not a fit" measured positively (${negative} negative) — the fit bar was relaxed for this one.`
      : net < 0
      ? `Fit history: ${negative} similar overridden action(s) measured negatively (${positive} positive) — the fit bar was tightened for this one.`
      : `Fit history: ${positive} positive vs ${negative} negative measured results on similar overrides — no adjustment.`;

    const promptBlock =
      `\n# MEASURED FIT HISTORY (what happened when the human overrode a "not a fit" verdict on similar actions)\n` +
      samples.map((s) =>
        `- ${s.direction.toUpperCase()}: ${s.decision} → ${s.metric}` +
        (s.delta_pct === null ? "" : ` ${s.delta_pct > 0 ? "+" : ""}${s.delta_pct}%`)
      ).join("\n") +
      `\nTotals: ${positive} positive, ${negative} negative, ${neutral} neutral.\n` +
      (net > 0
        ? "This class of action has repeatedly proven valuable after being overridden. Do NOT mark it 'not_a_fit' unless you have a specific, concrete reason beyond it feeling off-priority.\n"
        : net < 0
        ? "This class of action measured badly when it was let through anyway. Hold a high bar before calling it a fit.\n"
        : "");

    return { positive, negative, neutral, samples, promptBlock, nudge, note };
  } catch {
    return EMPTY_FIT_EVIDENCE;
  }
};

/**
 * Apply learned fit evidence to the model's fit call.
 * Positive measured history can lift "not_a_fit" to "unclear"; negative history
 * can pull an over-eager "fits" back to "unclear".
 */
export const applyFitEvidence = (
  fit: string,
  ev: FitEvidence,
): { fit: string; adjusted: boolean } => {
  const net = ev.positive - ev.negative;
  if (net >= 2 && fit === "not_a_fit") return { fit: "unclear", adjusted: true };
  if (net <= -2 && fit === "fits") return { fit: "unclear", adjusted: true };
  return { fit, adjusted: false };
};
