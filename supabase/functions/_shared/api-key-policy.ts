// "Zero human review" plan, item 1: pure resolution logic for an API
// key's on_uncertain policy -- kept separate from createPendingApproval's
// DB side effects (control-gate.ts) so the actual decision-making is
// unit-testable without a fake Supabase client.
//
// Only ever consulted for a "needs a second look" outcome (a non-blocking
// hard-rule match, a non-blocking safety-scanner match, or an anomaly-
// detector flag) -- an outright block is never routed through this at
// all, so no policy value here can ever override one.
export type OnUncertainPolicy = "human_review" | "auto_deny" | "auto_allow" | "auto_narrow" | "callback";

export const ON_UNCERTAIN_POLICIES: readonly OnUncertainPolicy[] = ["human_review", "auto_deny", "auto_allow", "auto_narrow", "callback"];

export function isValidOnUncertainPolicy(value: unknown): value is OnUncertainPolicy {
  return typeof value === "string" && (ON_UNCERTAIN_POLICIES as readonly string[]).includes(value);
}

export type AutoResolution = {
  autoResolved: boolean;
  resolution: "approved" | "rejected" | null;
  status: "pending" | "auto_approved" | "auto_rejected";
};

/**
 * Pure -- decides what a "needs a second look" outcome becomes under a
 * given policy value. An unrecognized or missing value is treated
 * identically to "human_review" -- today's exact behavior -- rather than
 * guessing or defaulting to an automatic resolution.
 *
 * "auto_narrow" and "callback" are deliberately NOT handled here: both
 * need more than a policy string to decide anything. "auto_narrow" only
 * makes sense where a real narrower alternative exists at all
 * (control-engine's model-scored path, via `modification`/
 * `modified_params`) -- the deterministic hard-rule/safety-scanner
 * matches this function otherwise serves have no such alternative to
 * offer. "callback" needs actual async I/O (notify the caller's own
 * system, wait for its answer) that has no place in a pure function.
 * Both fall back to this same pending/human_review result here; the
 * caller (control-gate.ts's createPendingApproval) checks for them
 * BEFORE ever reaching this function and handles each one's real logic
 * itself, passing the outcome in as an explicit forced resolution.
 */
export function resolveOnUncertain(policy: string | null | undefined): AutoResolution {
  if (policy === "auto_allow") return { autoResolved: true, resolution: "approved", status: "auto_approved" };
  if (policy === "auto_deny") return { autoResolved: true, resolution: "rejected", status: "auto_rejected" };
  return { autoResolved: false, resolution: null, status: "pending" };
}

/**
 * Pure -- is there a genuine, usable structured narrower action to retry
 * with? Only ever true for a "modify" verdict (the only decision that
 * carries a `modification` suggestion in the first place) with a real,
 * non-empty params object -- an empty object, a non-object, or any other
 * decision value all mean "nothing to narrow with."
 */
export function extractNarrowedAction(decision: string, modifiedParams: unknown): Record<string, unknown> | null {
  if (decision !== "modify") return null;
  if (!modifiedParams || typeof modifiedParams !== "object" || Array.isArray(modifiedParams)) return null;
  if (Object.keys(modifiedParams as Record<string, unknown>).length === 0) return null;
  return modifiedParams as Record<string, unknown>;
}

export type NarrowedActionResolution = { resolution: "approved" | "rejected"; note: string };

/**
 * Pure -- classifies the outcome of re-running a narrowed action through
 * the deterministic gate layers (hard rules, safety scanner). A clean
 * pass auto-allows the narrowed version; anything else -- the narrowed
 * version ALSO trips a rule or safety match -- auto-denies rather than
 * ever silently falling back to a blind allow.
 */
export function narrowedActionResolution(gateOutcome: "pass_through" | "require_approval" | "block"): NarrowedActionResolution {
  if (gateOutcome === "pass_through") {
    return {
      resolution: "approved",
      note: "Resolved automatically to approved: the model's suggested narrower version passed the same deterministic checks (hard rules, safety scanner) cleanly — no human reviewed this.",
    };
  }
  return {
    resolution: "rejected",
    note: "Resolved automatically to rejected: the model's suggested narrower version still failed the deterministic checks (hard rules or safety scanner), so this was denied rather than auto-allowed — no human reviewed this.",
  };
}

/**
 * "Zero human review" plan, item 5: how long a still-pending
 * pending_approvals row can sit untouched before the safety-net sweep
 * treats it as stuck, for an api key that has ALREADY opted into some
 * form of automatic resolution. Deliberately short and fixed, not
 * risk-tier-scaled like ESCALATION_HOURS (escalation.ts) -- those hours
 * are calibrated for a HUMAN to notice and act on an alert; this is a
 * backstop for automation that was already supposed to resolve within
 * seconds (a live "callback" policy's own bounded wait tops out at 60s,
 * item 4), so anything still pending this long on such a key almost
 * certainly means the normal path never ran to completion at all (a
 * crash mid-request, a policy set after the row was already queued),
 * not that it's still working.
 */
export const STUCK_APPROVAL_MAX_WAIT_MINUTES = 15;

const minutesSince = (isoDate: string, now: Date): number =>
  (now.getTime() - new Date(isoDate).getTime()) / (1000 * 60);

/** Pure -- is this still-pending row stuck long enough for the safety-net sweep to act on it? */
export function isStuckPastMaxWait(createdAtIso: string, now: Date = new Date()): boolean {
  return minutesSince(createdAtIso, now) >= STUCK_APPROVAL_MAX_WAIT_MINUTES;
}

/**
 * Pure -- what the safety-net sweep resolves a stuck row to, given the
 * api key's own on_uncertain policy. Unlike resolveOnUncertain (used at
 * the MOMENT an outcome is first decided, with a real model output or
 * caller system available to consult), this always has a real answer
 * for every automatic policy value: "auto_narrow" and "callback" both
 * fall back to their own already-established safety-first default
 * (item 3's own "nothing usable to narrow with -> reject"; item 4's own
 * configured callback_fallback) instead of resolveOnUncertain's generic
 * "still pending" for those two values, since a sweep has no live model
 * output or caller system left to ask -- by the time this runs, whatever
 * was supposed to answer already had its chance and didn't.
 * "human_review" (or an unrecognized/missing value) is untouched here,
 * same as resolveOnUncertain -- this sweep is a backstop for automation
 * that already opted in, never a way to override an account that is
 * still deliberately relying on a human.
 */
export function resolveSweepFallback(policy: string | null | undefined, callbackFallback?: string | null): AutoResolution {
  if (policy === "callback") return resolveOnUncertain(callbackFallback === "auto_allow" ? "auto_allow" : "auto_deny");
  if (policy === "auto_narrow") return resolveOnUncertain("auto_deny");
  return resolveOnUncertain(policy);
}

export type PendingApprovalDisposition = "approved" | "rejected" | "pending";

/**
 * Pure -- maps a pending_approvals.status value onto approved/rejected/
 * still-pending, covering both a genuine human decision (approved/
 * rejected) and any of this round's auto-resolved variants
 * (auto_approved/auto_rejected) identically -- callback-delegation.ts's
 * polling loop treats either source of "approved" the same way.
 */
export function classifyPendingApprovalStatus(status: string | null | undefined): PendingApprovalDisposition {
  if (status === "approved" || status === "auto_approved") return "approved";
  if (status === "rejected" || status === "auto_rejected") return "rejected";
  return "pending";
}

// ---- item 6: shadow-mode summary for an api key's candidate on_uncertain policy ----

export type ShadowObservationRow = {
  shadow_resolution: "approved" | "rejected";
  /** The linked pending_approvals row's CURRENT status, read live at
   * summary time -- never stored alongside shadow_resolution itself, so a
   * row observed before a human later resolves the real approval still
   * compares correctly without any second write. */
  actual_status: string | null;
  action_type: string;
  provider: string | null;
  created_at: string;
};

export type ShadowDisagreementSample = ShadowObservationRow & { actual: PendingApprovalDisposition };

export type ShadowPolicySummary = {
  /** Every observation recorded for this shadow policy, decided or not. */
  total: number;
  /** How many of those have a real, final outcome to compare against yet
   * -- still-pending real approvals can't be scored either way. */
  decided: number;
  agreed: number;
  disagreed: number;
  disagreement_samples: ShadowDisagreementSample[];
};

const MAX_SHADOW_DISAGREEMENT_SAMPLES = 25;

/**
 * Pure -- builds the human-reviewable summary from a batch of stored
 * shadow observation rows (each already joined with its
 * pending_approvals row's live status by the caller). Mirrors
 * summarizePolicyWatch's shape (policy-watch.ts) for the same whole-draft
 * shadow-mode idea, applied here to one api key's on_uncertain policy
 * instead of a whole policy version.
 */
export function summarizeShadowObservations(rows: ShadowObservationRow[]): ShadowPolicySummary {
  const decided = rows.filter((r) => classifyPendingApprovalStatus(r.actual_status) !== "pending");
  const scored = decided.map((r) => ({ ...r, actual: classifyPendingApprovalStatus(r.actual_status) }));
  const disagreement_samples = scored
    .filter((r) => r.actual !== r.shadow_resolution)
    .slice(0, MAX_SHADOW_DISAGREEMENT_SAMPLES);
  return {
    total: rows.length,
    decided: decided.length,
    agreed: scored.filter((r) => r.actual === r.shadow_resolution).length,
    disagreed: scored.filter((r) => r.actual !== r.shadow_resolution).length,
    disagreement_samples,
  };
}

// "Policy autonomy" plan, item 6: shadow mode already lets an account
// preview what a different on_uncertain policy would have done. Today a
// human has to manually eyeball summarizeShadowObservations' numbers and
// guess whether there's "enough" agreement to trust it. This computes
// that threshold for real -- a genuine sample size AND a genuine
// agreement rate -- so the account gets a clear, evidence-based answer
// instead of a guess. Never flips the switch itself: the account still
// confirms via the existing POST /api-keys/:id/policy endpoint.
export const MIN_DECIDED_SAMPLE_FOR_PROMOTION = 20;
export const MIN_AGREEMENT_RATE_FOR_PROMOTION = 0.9;

export type ShadowPromotionReadiness =
  | { ready: false; reason: "insufficient_sample"; decided: number; required: number }
  | { ready: false; reason: "too_many_disagreements"; agreementRate: number; decided: number; required: number }
  | { ready: true; agreementRate: number; decided: number };

/** Pure -- has this shadow policy earned promotion to live, based on real, decided observations? */
export function evaluateShadowPromotionReadiness(summary: ShadowPolicySummary): ShadowPromotionReadiness {
  if (summary.decided < MIN_DECIDED_SAMPLE_FOR_PROMOTION) {
    return { ready: false, reason: "insufficient_sample", decided: summary.decided, required: MIN_DECIDED_SAMPLE_FOR_PROMOTION };
  }
  const agreementRate = Math.round((summary.agreed / summary.decided) * 100) / 100;
  if (agreementRate < MIN_AGREEMENT_RATE_FOR_PROMOTION) {
    return { ready: false, reason: "too_many_disagreements", agreementRate, decided: summary.decided, required: MIN_AGREEMENT_RATE_FOR_PROMOTION };
  }
  return { ready: true, agreementRate, decided: summary.decided };
}

export function summarizeShadowPromotionReadiness(readiness: ShadowPromotionReadiness): string {
  if (readiness.ready) {
    return (
      `This shadow policy has agreed with what actually happened on ${Math.round(readiness.agreementRate * 100)}% of ` +
      `${readiness.decided} real decided outcomes -- ready to consider promoting to your live on_uncertain policy.`
    );
  }
  if (readiness.reason === "insufficient_sample") {
    return `Not enough real, decided outcomes yet to judge this shadow policy -- ${readiness.decided} of ${readiness.required} needed.`;
  }
  return (
    `This shadow policy still disagrees with what actually happened too often (${Math.round(readiness.agreementRate * 100)}% ` +
    `agreement across ${readiness.decided} decided outcomes, needs ${Math.round(readiness.required * 100)}%) -- not ready to promote yet.`
  );
}
