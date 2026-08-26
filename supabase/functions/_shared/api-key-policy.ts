// "Zero human review" plan, item 1: pure resolution logic for an API
// key's on_uncertain policy -- kept separate from createPendingApproval's
// DB side effects (control-gate.ts) so the actual decision-making is
// unit-testable without a fake Supabase client.
//
// Only ever consulted for a "needs a second look" outcome (a non-blocking
// hard-rule match, a non-blocking safety-scanner match, or an anomaly-
// detector flag) -- an outright block is never routed through this at
// all, so no policy value here can ever override one.
export type OnUncertainPolicy = "human_review" | "auto_deny" | "auto_allow" | "auto_narrow";

export const ON_UNCERTAIN_POLICIES: readonly OnUncertainPolicy[] = ["human_review", "auto_deny", "auto_allow", "auto_narrow"];

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
 * "auto_narrow" is deliberately NOT handled here: it only makes sense
 * where a real narrower alternative exists at all (control-engine's
 * model-scored path, via `modification`/`modified_params`) -- the
 * deterministic hard-rule/safety-scanner matches this function otherwise
 * serves have no such alternative to offer, so a key set to "auto_narrow"
 * falls back to this same pending/human_review result there. Callers that
 * CAN attempt a narrow (control-engine) check for "auto_narrow" and run
 * extractNarrowedAction/narrowedActionResolution themselves BEFORE ever
 * reaching this function, passing the outcome to createPendingApproval as
 * an explicit forced resolution instead.
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
