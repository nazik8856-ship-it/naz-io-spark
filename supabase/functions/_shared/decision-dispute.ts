// "Knowledge & autonomy" plan, item 14: let an external company request a
// fresh human look at a decision NazAI already resolved -- e.g. its own
// end customer disputes an auto-resolved block. Reuses pending_approvals'
// own existing queue/notification machinery (the same table, the same
// approval_created webhook, the same structured-reason capture item 2
// already added to record_approval_signoff) -- just a new way to create a
// row scoped to a decision that already has a real verdict, rather than a
// new escalation mechanism.
export type ExistingDisputeRow = { status: string } | null;

/** Pure -- is there already an open (still-pending) review for this decision? Used to make re-disputing the same decision idempotent instead of piling up duplicate queue entries. */
export function hasOpenReview(existing: ExistingDisputeRow): boolean {
  return existing?.status === "pending";
}

/** Pure -- the reason text stored on the new pending_approvals row. A caller's own free-text reason is used verbatim (prefixed so it reads clearly in a human reviewer's queue); an absent one still produces a real, honest reason rather than an empty string. */
export function buildDisputeReasonText(callerReason: string | null | undefined, originalDecisionText: string): string {
  const trimmed = (callerReason ?? "").trim();
  return trimmed
    ? `Re-review requested: ${trimmed}`
    : `Re-review requested for a previously resolved decision ("${originalDecisionText}") -- no additional reason given.`;
}
