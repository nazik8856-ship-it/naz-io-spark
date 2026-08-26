// "Zero human review" plan, item 1: pure resolution logic for an API
// key's on_uncertain policy -- kept separate from createPendingApproval's
// DB side effects (control-gate.ts) so the actual decision-making is
// unit-testable without a fake Supabase client.
//
// Only ever consulted for a "needs a second look" outcome (a non-blocking
// hard-rule match, a non-blocking safety-scanner match, or an anomaly-
// detector flag) -- an outright block is never routed through this at
// all, so no policy value here can ever override one.
export type OnUncertainPolicy = "human_review" | "auto_deny" | "auto_allow";

export const ON_UNCERTAIN_POLICIES: readonly OnUncertainPolicy[] = ["human_review", "auto_deny", "auto_allow"];

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
 */
export function resolveOnUncertain(policy: string | null | undefined): AutoResolution {
  if (policy === "auto_allow") return { autoResolved: true, resolution: "approved", status: "auto_approved" };
  if (policy === "auto_deny") return { autoResolved: true, resolution: "rejected", status: "auto_rejected" };
  return { autoResolved: false, resolution: null, status: "pending" };
}
