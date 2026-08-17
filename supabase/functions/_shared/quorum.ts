// Multi-approver quorum — the SAME distinct-signoff logic used both when a
// human clicks Approve (record_approval_signoff SQL RPC re-derives this) and
// when control-engine actually carries an approved action out. Extracted into
// its own pure function so it's directly unit-testable and so control-engine
// can never drift from what the DB itself enforces.

export type ApprovalRow = {
  status?: string | null;
  approvals?: unknown;
  required_approvals?: number | null;
};

export type QuorumResult =
  | { ok: true; distinct: number; needed: number; remaining: 0 }
  | {
      ok: false;
      reason: "rejected" | "quorum_not_met";
      distinct: number;
      needed: number;
      remaining: number;
    };

/** Counts distinct approver ids recorded on a pending_approvals row. */
export function distinctApprovalCount(approvals: unknown): number {
  const signoffs = Array.isArray(approvals) ? (approvals as { by?: unknown }[]) : [];
  return new Set(signoffs.map((s) => String(s?.by ?? "")).filter(Boolean)).size;
}

/**
 * Decides whether an approval row has genuinely met its quorum and may be
 * executed. Never trusts `status` alone — recomputes the distinct approver
 * count from the stored signoff log every time, so a row can never be
 * executed on fewer than `required_approvals` distinct humans no matter how
 * `status` got set.
 */
export function checkApprovalQuorum(ap: ApprovalRow): QuorumResult {
  const distinct = distinctApprovalCount(ap.approvals);
  const needed = Math.max(1, Number(ap.required_approvals ?? 1));

  if (ap.status === "rejected") {
    return { ok: false, reason: "rejected", distinct, needed, remaining: Math.max(0, needed - distinct) };
  }
  if (distinct < needed || ap.status !== "approved") {
    return {
      ok: false,
      reason: "quorum_not_met",
      distinct,
      needed,
      remaining: Math.max(0, needed - distinct),
    };
  }
  return { ok: true, distinct, needed, remaining: 0 };
}
