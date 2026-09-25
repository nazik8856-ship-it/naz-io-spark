// Frontend port of supabase/functions/_shared/decision-explanation.ts's
// buildDecisionExplanation(). The narrative it composes (gate trace +
// precedent citations + confidence + source, all folded into one readable
// paragraph) was previously only ever produced for the external Control
// API (control-api/index.ts) -- an operator using the in-app Decision
// History / Pending Approvals pages never saw it, only the raw `reasoning`
// string and a separate gate-trace checklist. Kept as a plain, dependency-
// free function (no Deno imports) so it can run in the browser; logic is
// identical to the edge-function version and must be kept in sync with it.
import type { TraceEntry } from "@/components/control/GateTraceList";

export type PrecedentCitationRecord = {
  reason: "non_allow_majority" | "contradictory";
  sampleSize: number;
  nonAllowShare: number;
  citedDecisions: { decisionId: string; similarity: number; nonAllow: boolean }[];
};

// A resolved pending_approvals row referencing this decision -- covers BOTH a
// normal escalation resolved through the approvals queue (ControlApprovals.tsx,
// record_approval_signoff) and a later dispute/re-review of an already-resolved
// decision (decision-dispute.ts reuses the same table). Neither path ever
// writes back to agent_decisions.human_response.
export type ApprovalResolution = { vote: "approved" | "rejected"; resolvedAt: string | null; comment: string | null };

// A break-glass override: a human bypassing an earlier hard-rule/safety-
// scanner BLOCK. Modeled as a SEPARATE agent_decisions row (source:
// "human_override", override_of: <this decision's id>) -- the original
// blocked decision is never mutated beyond an overridden_at timestamp.
export type DecisionOverride = { reasoning: string | null; createdAt: string; actionType: string | null; provider: string | null };

// A "deferred" verdict's rich explanation -- previously only ever returned
// in the live chat response's `deferred` field and never persisted.
export type DeferredDetail = {
  whyNotNow: string;
  whatWouldChangeIt: string;
  improvementSteps: string[];
  reconsiderWhen: string;
};

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
  // Oldest first. Empty/omitted when nothing was ever escalated or disputed
  // through the approvals queue for this decision.
  approvalResolutions?: ApprovalResolution[] | null;
  // Oldest first. Empty/omitted when this decision was never overridden.
  overrides?: DecisionOverride[] | null;
  // Only present when this was (originally) a DEFERRED verdict.
  deferredDetail?: DeferredDetail | null;
  // Only present for a "modify" verdict with a genuine, non-empty narrower
  // params object.
  modifiedParams?: Record<string, unknown> | null;
};

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
  control_engine_unreachable: "the control engine being unreachable, so this ran through the deterministic gate only, with no full model review",
};

// KillSwitchPanel.tsx logs a switch TOGGLE itself (distinct from
// "kill_switch"/"platform_kill_switch", which mark an ACTION blocked because
// a switch was already on) under these two sources -- not an action NazAI
// took at all, so it gets its own opening sentence instead of the generic
// template (which otherwise quoted the raw source string).
const SWITCH_FLIP_SOURCES = new Set(["kill_switch_flip", "platform_kill_switch_flip"]);

/** Pure -- the opening sentence for a kill-switch/platform-kill-switch TOGGLE event, never a normal gated decision. Kept in lockstep with the edge-function original. */
function describeSwitchFlip(source: string, decisionText: string, when: string): string {
  const turnedOn = leadingVerdict(decisionText) === "BLOCK";
  const switchLabel = source === "platform_kill_switch_flip" ? "NazAI's platform-wide kill switch" : "this account's kill switch";
  return `On ${when}, a human turned ${switchLabel} ${turnedOn ? "ON" : "OFF"}.`;
}

/** Pure -- composes one plain-English narrative from whatever pieces this decision actually has. Kept in lockstep with the edge-function original. */
export function buildDecisionExplanation(input: DecisionExplanationInput): string {
  const paragraphs: string[] = [];

  const isSwitchFlip = input.source != null && SWITCH_FLIP_SOURCES.has(input.source);
  const verdict = leadingVerdict(input.decisionText);
  const verb = VERDICT_VERBS[verdict] ?? "processed";
  const what = input.actionType
    ? `the "${input.actionType}"${input.provider ? ` action on ${input.provider}` : " action"}`
    : "this action";
  const when = new Date(input.createdAt).toISOString().slice(0, 10);
  const sourceLabel = input.source ? SOURCE_LABELS[input.source] ?? `"${input.source}"` : null;
  if (isSwitchFlip) {
    paragraphs.push(describeSwitchFlip(input.source as string, input.decisionText, when));
  } else {
    paragraphs.push(
      sourceLabel
        ? `On ${when}, NazAI ${verb} ${what}, decided by ${sourceLabel}.`
        : `On ${when}, NazAI ${verb} ${what}.`,
    );
  }

  if (input.confidenceScore != null && !isSwitchFlip) {
    paragraphs.push(`NazAI's own judgment scored this at ${input.confidenceScore}% confidence.`);
  }

  if (input.reasoning) {
    paragraphs.push(`Reasoning given at the time: ${input.reasoning.trim()}`);
  }

  if (input.deferredDetail) {
    paragraphs.push(describeDeferred(input.deferredDetail));
  }

  if (input.modifiedParams && Object.keys(input.modifiedParams).length) {
    paragraphs.push(`It was narrowed to this instead: ${JSON.stringify(input.modifiedParams)}`);
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

  if (input.overrides && input.overrides.length) {
    paragraphs.push(describeOverrides(input.overrides));
  }

  const resolutions = input.approvalResolutions ?? [];
  if (isSwitchFlip) {
    paragraphs.push("This was a manual action taken directly by a human -- no AI judgment or approval queue was involved.");
  } else if (input.escalated) {
    if (input.humanResponse) {
      paragraphs.push(`This was escalated for a second look, and a human resolved it: ${input.humanResponse}.`);
    } else if (resolutions.length) {
      paragraphs.push(describeApprovalResolutions(resolutions, "This was escalated for a second look."));
    } else {
      paragraphs.push("This was escalated for a second look and is awaiting (or was awaiting) human review.");
    }
  } else if (resolutions.length) {
    paragraphs.push(describeApprovalResolutions(resolutions, "This wasn't escalated at the time, but a human later reviewed it -- for example through a dispute or re-review request."));
  } else {
    paragraphs.push("No human was involved in resolving this decision.");
  }

  return paragraphs.join("\n\n");
}

/** Pure -- one sentence naming the most recent human resolution from the approvals queue, noting when there were several (e.g. a decision disputed more than once). Kept in lockstep with the edge-function original. */
function describeApprovalResolutions(resolutions: ApprovalResolution[], lead: string): string {
  const last = resolutions[resolutions.length - 1];
  const verb = last.vote === "approved" ? "approved" : "rejected";
  const when = last.resolvedAt ? ` on ${new Date(last.resolvedAt).toISOString().slice(0, 10)}` : "";
  const countNote = resolutions.length > 1 ? ` (reviewed ${resolutions.length} times in total; this is the most recent)` : "";
  const commentNote = last.comment ? ` The reviewer noted: ${last.comment}` : "";
  return `${lead} A human ${verb} it${when}.${countNote}${commentNote}`;
}

/** Pure -- expands a deferred verdict's rich guidance into the narrative. Kept in lockstep with the edge-function original. */
function describeDeferred(d: DeferredDetail): string {
  const steps = d.improvementSteps.length
    ? ` Steps that would help: ${d.improvementSteps.join("; ")}.`
    : "";
  return (
    `Why not now: ${d.whyNotNow} What would change it: ${d.whatWouldChangeIt}${steps} ` +
    `Reconsider when: ${d.reconsiderWhen}`
  );
}

/** Pure -- one sentence naming that this block was later overridden by a human, and why. Kept in lockstep with the edge-function original. */
function describeOverrides(overrides: DecisionOverride[]): string {
  if (overrides.length === 1) {
    const o = overrides[0];
    const when = new Date(o.createdAt).toISOString().slice(0, 10);
    return `A human later overrode this block on ${when}${o.reasoning ? `, with reasoning: "${o.reasoning}"` : ""}.`;
  }
  const last = overrides[overrides.length - 1];
  const when = new Date(last.createdAt).toISOString().slice(0, 10);
  return `A human later overrode this block ${overrides.length} separate times, most recently on ${when}${last.reasoning ? `, with reasoning: "${last.reasoning}"` : ""}.`;
}
