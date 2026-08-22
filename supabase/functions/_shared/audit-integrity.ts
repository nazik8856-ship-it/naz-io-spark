// Pure classification for the weekly audit-integrity sweep — extracted out
// of the edge function's DB-coupled orchestration so it's directly unit
// testable, same reasoning as self-audit-diff.ts for control-self-audit.

export type SignatureVerifyResult = {
  checked: number;
  verified: number;
  unsigned: number;
  mismatched_count: number;
};

/**
 * A sweep is a failure worth alerting on if ANY signature didn't match
 * what was actually signed at creation (the audit trail may have been
 * altered) OR any decision in range has no signature at all (the signing
 * trigger should fire on every insert -- an unsigned row in a recent
 * window means it silently didn't).
 */
export function isAuditIntegrityFailure(r: SignatureVerifyResult): boolean {
  return r.mismatched_count > 0 || r.unsigned > 0;
}

export function summarizeAuditIntegrityFailure(r: SignatureVerifyResult): string {
  const parts = [`Audit integrity sweep: checked ${r.checked} decision(s), ${r.verified} verified.`];
  if (r.mismatched_count > 0) {
    parts.push(`${r.mismatched_count} signature mismatch(es) -- the audit trail may have been altered.`);
  }
  if (r.unsigned > 0) {
    parts.push(`${r.unsigned} decision(s) in range have no signature at all.`);
  }
  return parts.join(" ");
}
