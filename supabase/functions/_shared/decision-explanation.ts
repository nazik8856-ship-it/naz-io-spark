// "Knowledge & autonomy" plan, item 13: compose ONE full plain-English
// explanation for a single decision -- the raw pieces of "why did NazAI
// decide this" already exist scattered across several places (gate_trace,
// precedent_citations, confidence/reasoning) but nothing combines them
// into one real, readable narrative. Valuable for an external company's
// own support team handling a question from their end customer without
// ever looping in a NazAI human. Read-only composition, no new signal.
import type { TraceEntry } from "./gate-trace.ts";
import type { PrecedentCitationRecord } from "./precedent-citation.ts";

export type DecisionExplanationInput = {
  decisionText: string;
  reasoning: string | null;
  confidenceScore: number | null;
  source: string | null;
  escalated: boolean;
  humanResponse: string | null;
  actionType: string | null;
  provider: string | null;
  createdAt: string;
  gateTrace: TraceEntry[] | null;
  precedentCitations: PrecedentCitationRecord | null;
};

/** Pure -- the first whitespace-separated word of the stored decision text, uppercased. Same convention roi-report.ts's classifyDecisionOutcome and this round's plan-escalation.ts already use to read a real verdict off free-text. */
function leadingVerdict(decisionText: string): string {
  return (decisionText.trim().split(/\s+/)[0] ?? "").toUpperCase();
}

const VERDICT_VERBS: Record<string, string> = {
  ALLOW: "allowed",
  BLOCK: "blocked",
  MODIFY: "modified",
  DEFERRED: "deferred",
  APPROVAL_REQUIRED: "flagged for approval",
};

const SOURCE_LABELS: Record<string, string> = {
  model: "NazAI's AI judgment",
  hard_rule: "one of this account's own hard rules",
  safety_scanner: "the deterministic safety scanner",
  circuit_breaker: "the circuit breaker (too many recent failures for this action type)",
  circuit_breaker_trip: "the circuit breaker tripping",
  anomaly_detector: "the anomaly detector (unusual volume or a new pattern for this agent)",
  kill_switch: "the account's kill switch",
  agent_kill_switch: "this agent's own kill switch",
  ai_spend_cap: "the account's daily AI spend cap",
  agent_ai_spend_cap: "this agent's own AI spend cap",
  external_api: "the Control API's deterministic gate",
  human_override: "a human manually overriding an earlier decision",
  gate_error: "an unexpected error in NazAI's own gate (failed closed)",
  gate_error_fail_open: "an unexpected error in NazAI's own gate (this key is configured to fail open)",
  platform_kill_switch: "NazAI's platform-wide emergency stop",
};

/**
 * Pure -- composes one plain-English paragraph narrative from whatever
 * pieces this decision actually has. Every input is optional/nullable
 * because older decisions predate some of these columns (gate_trace,
 * precedent_citations) -- a missing piece is simply skipped, never
 * rendered as an error or a guess.
 */
export function buildDecisionExplanation(input: DecisionExplanationInput): string {
  const paragraphs: string[] = [];

  const verdict = leadingVerdict(input.decisionText);
  const verb = VERDICT_VERBS[verdict] ?? "processed";
  const what = input.actionType
    ? `the "${input.actionType}"${input.provider ? ` action on ${input.provider}` : " action"}`
    : "this action";
  const when = new Date(input.createdAt).toISOString().slice(0, 10);
  const sourceLabel = input.source ? SOURCE_LABELS[input.source] ?? `"${input.source}"` : null;
  paragraphs.push(
    sourceLabel
      ? `On ${when}, NazAI ${verb} ${what}, decided by ${sourceLabel}.`
      : `On ${when}, NazAI ${verb} ${what}.`,
  );

  if (input.confidenceScore != null) {
    paragraphs.push(`NazAI's own judgment scored this at ${input.confidenceScore}% confidence.`);
  }

  if (input.reasoning) {
    paragraphs.push(`Reasoning given at the time: ${input.reasoning.trim()}`);
  }

  if (input.gateTrace && input.gateTrace.length) {
    const checked = input.gateTrace.filter((t) => t.status !== "not_reached");
    if (checked.length) {
      const lines = checked.map((t) => {
        if (t.status === "stopped") return `${t.label}: stopped the action${t.detail ? ` (${t.detail})` : ""}`;
        if (t.status === "skipped") return `${t.label}: skipped${t.detail ? ` (${t.detail})` : ""}`;
        return `${t.label}: passed cleanly`;
      });
      paragraphs.push(`Before any AI judgment ran, NazAI checked its deterministic safety layers in order: ${lines.join("; ")}.`);
    }
  }

  if (input.precedentCitations) {
    const c = input.precedentCitations;
    const sharePct = Math.round(c.nonAllowShare * 100);
    const reasonPhrase = c.reason === "contradictory"
      ? "the past outcomes for similar actions were a genuinely mixed signal, not a clear pattern either way"
      : "most similar past decisions did NOT come back a simple approval";
    paragraphs.push(
      `This decision was also informed by real precedent: NazAI reviewed ${c.sampleSize} similar past decision(s) for this ` +
      `same API key, and found that ${reasonPhrase} (${sharePct}% non-allow) -- which is why precedent pulled this decision toward caution.`,
    );
  }

  if (input.escalated) {
    paragraphs.push(
      input.humanResponse
        ? `This was escalated for a second look, and a human resolved it: ${input.humanResponse}.`
        : "This was escalated for a second look and is awaiting (or was awaiting) human review.",
    );
  } else {
    paragraphs.push("No human was involved in resolving this decision.");
  }

  return paragraphs.join("\n\n");
}
