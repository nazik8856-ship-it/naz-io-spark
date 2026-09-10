// "Knowledge & autonomy" plan, item 11: let an account export a real,
// SIGNED compliance attestation -- not just raw numbers, a summary an
// external company can hand to its own customers or auditors as proof
// its automated decisions ran under real governance, backed by NazAI's
// own decision-signing so it can't be quietly altered afterward.
//
// Composes three things that already exist independently: decision
// counts/autonomy split (roi-report.ts's summarizeDecisionsForRoi, the
// exact same automation-value numbers item 14 of the prior round already
// exposes), which policy version(s) actually governed the period, and how
// many of those decisions carry a real signature (agent_decisions.signature,
// "zero human review" plan item 10) -- no new metric computation. The one
// genuinely new piece is signing the resulting SUMMARY itself, via a new
// but minimal RPC (sign_compliance_attestation) that reuses the exact same
// server secret and digest algorithm the per-decision signer
// (sign_agent_decision(), decision_canonical_payload()) already uses --
// no new signing mechanism, no new secret.
//
// Pure aggregation/canonicalization only -- the DB reads and the actual
// RPC call to sign the result live in control-api/index.ts.

export type ComplianceAttestationCounts = {
  total: number;
  autonomous: number;
  escalated: number;
  signed: number;
};

/** Pure -- the same autonomous/escalated split roi-report.ts's summarizeDecisionsForRoi computes from decision TEXT, computed here directly from the escalated column since this attestation doesn't need the block/modify/allow breakdown that function also derives. `signed` counts real signatures (agent_decisions.signature IS NOT NULL), not verified ones -- a full per-row re-verification is what the existing per-decision /verify endpoint is for. */
export function summarizeAttestationCounts(
  rows: { escalated: boolean; signature: string | null }[],
): ComplianceAttestationCounts {
  let autonomous = 0, escalated = 0, signed = 0;
  for (const r of rows) {
    if (r.escalated) escalated++;
    else autonomous++;
    if (r.signature) signed++;
  }
  return { total: rows.length, autonomous, escalated, signed };
}

/** Pure -- every distinct real policy version that governed at least one decision in the period, ascending. A decision predating policy versioning (policy_version null) is simply omitted, never reported as version 0 or a guess. */
export function distinctPolicyVersions(rows: { policy_version: number | null }[]): number[] {
  const versions = new Set<number>();
  for (const r of rows) {
    if (r.policy_version != null) versions.add(r.policy_version);
  }
  return [...versions].sort((a, b) => a - b);
}

export type ComplianceAttestationIncidentCounts = {
  opened: number;
  resolvedWithinPeriod: number;
  stillOpen: number;
};

/** Pure -- opened-in-period / resolved-in-period / still-open-now counts, the same "did anything go wrong, and was it fixed" governance signal an external auditor would otherwise have to ask about separately. `stillOpen` is judged against `rows` themselves (each row already carries its current status), not the period boundary -- an incident opened in-period can still be open well after the period ends. */
export function summarizeAttestationIncidents(
  rows: { opened_at: string; resolved_at: string | null; status: string }[],
  periodStart: string,
  periodEnd: string,
): ComplianceAttestationIncidentCounts {
  let opened = 0, resolvedWithinPeriod = 0, stillOpen = 0;
  for (const r of rows) {
    if (r.opened_at >= periodStart && r.opened_at < periodEnd) {
      opened++;
      if (r.status !== "resolved") stillOpen++;
    }
    if (r.resolved_at && r.resolved_at >= periodStart && r.resolved_at < periodEnd) resolvedWithinPeriod++;
  }
  return { opened, resolvedWithinPeriod, stillOpen };
}

export type ComplianceAttestationFields = {
  userId: string;
  periodStart: string;
  periodEnd: string;
  counts: ComplianceAttestationCounts;
  policyVersions: number[];
  spendUsd: number;
  costPerAutonomousDecisionUsd: number | null;
  estimatedManualReviewHoursSaved: number;
  incidents: ComplianceAttestationIncidentCounts;
};

/**
 * Pure -- a deterministic, pipe-joined canonical string over every field
 * this attestation actually reports, mirroring the exact same
 * concat_ws-style convention decision_canonical_payload (the per-decision
 * SQL signer) already established: a caller can recompute this string
 * from the plain fields the endpoint returns and hand it back to NazAI to
 * re-derive the same signature, the same way an individual decision's
 * signature is independently checkable. Field ORDER matters and must
 * never change once shipped -- changing it would silently invalidate
 * every attestation signed before the change. New fields (like
 * `incidents` below) are always APPENDED after `generatedAt`'s position,
 * never inserted earlier -- each attestation is self-describing (the
 * response documents exactly which fields, in which order, produced its
 * own canonical_payload), so an older attestation stays independently
 * verifiable exactly as it was signed.
 */
export function buildAttestationCanonicalPayload(fields: ComplianceAttestationFields, generatedAt: string): string {
  return [
    fields.userId,
    fields.periodStart,
    fields.periodEnd,
    String(fields.counts.total),
    String(fields.counts.autonomous),
    String(fields.counts.escalated),
    String(fields.counts.signed),
    fields.policyVersions.join(","),
    fields.spendUsd.toFixed(6),
    fields.costPerAutonomousDecisionUsd == null ? "" : fields.costPerAutonomousDecisionUsd.toFixed(6),
    fields.estimatedManualReviewHoursSaved.toFixed(2),
    generatedAt,
    String(fields.incidents.opened),
    String(fields.incidents.resolvedWithinPeriod),
    String(fields.incidents.stillOpen),
  ].join("|");
}
