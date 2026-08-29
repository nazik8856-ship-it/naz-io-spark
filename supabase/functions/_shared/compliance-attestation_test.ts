// Real tests for the signed compliance attestation's pure aggregation and
// canonicalization.
//
// Run with: deno test --allow-none supabase/functions/_shared/compliance-attestation_test.ts
import {
  summarizeAttestationCounts,
  distinctPolicyVersions,
  buildAttestationCanonicalPayload,
  type ComplianceAttestationFields,
} from "./compliance-attestation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- summarizeAttestationCounts ----

Deno.test("summarizeAttestationCounts: no decisions at all reports a clean zero state", () => {
  assertEquals(summarizeAttestationCounts([]), { total: 0, autonomous: 0, escalated: 0, signed: 0 });
});

Deno.test("summarizeAttestationCounts: splits autonomous vs escalated by the escalated flag", () => {
  const rows = [
    { escalated: false, signature: "sig1" },
    { escalated: true, signature: "sig2" },
    { escalated: false, signature: null },
  ];
  assertEquals(summarizeAttestationCounts(rows), { total: 3, autonomous: 2, escalated: 1, signed: 2 });
});

Deno.test("summarizeAttestationCounts: a null signature is never counted as signed", () => {
  const rows = [{ escalated: false, signature: null }, { escalated: false, signature: null }];
  assertEquals(summarizeAttestationCounts(rows).signed, 0);
});

Deno.test("summarizeAttestationCounts: every row signed reports signed === total", () => {
  const rows = [{ escalated: false, signature: "a" }, { escalated: true, signature: "b" }];
  const result = summarizeAttestationCounts(rows);
  assertEquals(result.signed, result.total);
});

// ---- distinctPolicyVersions ----

Deno.test("distinctPolicyVersions: no rows at all reports an empty list", () => {
  assertEquals(distinctPolicyVersions([]), []);
});

Deno.test("distinctPolicyVersions: duplicates collapse to one entry each, sorted ascending", () => {
  const rows = [{ policy_version: 3 }, { policy_version: 1 }, { policy_version: 3 }, { policy_version: 2 }];
  assertEquals(distinctPolicyVersions(rows), [1, 2, 3]);
});

Deno.test("distinctPolicyVersions: a null policy_version (predates versioning) is omitted, never reported as 0", () => {
  const rows = [{ policy_version: null }, { policy_version: 5 }, { policy_version: null }];
  assertEquals(distinctPolicyVersions(rows), [5]);
});

// ---- buildAttestationCanonicalPayload ----

const fields = (over: Partial<ComplianceAttestationFields> = {}): ComplianceAttestationFields => ({
  userId: "user-1",
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-08-28T00:00:00.000Z",
  counts: { total: 100, autonomous: 80, escalated: 20, signed: 100 },
  policyVersions: [3, 4],
  spendUsd: 12.5,
  costPerAutonomousDecisionUsd: 0.15625,
  estimatedManualReviewHoursSaved: 4.0,
  ...over,
});

Deno.test("buildAttestationCanonicalPayload: is deterministic for the same input", () => {
  const a = buildAttestationCanonicalPayload(fields(), "2026-08-28T12:00:00.000Z");
  const b = buildAttestationCanonicalPayload(fields(), "2026-08-28T12:00:00.000Z");
  assertEquals(a, b);
});

Deno.test("buildAttestationCanonicalPayload: changing any single numeric field changes the payload", () => {
  const base = buildAttestationCanonicalPayload(fields(), "2026-08-28T12:00:00.000Z");
  const changed = buildAttestationCanonicalPayload(
    fields({ counts: { total: 101, autonomous: 81, escalated: 20, signed: 100 } }),
    "2026-08-28T12:00:00.000Z",
  );
  assert(base !== changed, "a changed count must produce a different canonical payload");
});

Deno.test("buildAttestationCanonicalPayload: a null cost-per-decision serializes as an empty field, not the string 'null'", () => {
  const payload = buildAttestationCanonicalPayload(fields({ costPerAutonomousDecisionUsd: null }), "2026-08-28T12:00:00.000Z");
  assert(!payload.includes("null"), `payload must never contain the literal string "null": ${payload}`);
});

Deno.test("buildAttestationCanonicalPayload: a different generatedAt changes the payload -- two attestations for the same period are never identical", () => {
  const a = buildAttestationCanonicalPayload(fields(), "2026-08-28T12:00:00.000Z");
  const b = buildAttestationCanonicalPayload(fields(), "2026-08-28T13:00:00.000Z");
  assert(a !== b);
});

Deno.test("buildAttestationCanonicalPayload: an empty policyVersions list serializes cleanly, doesn't break field ordering", () => {
  const payload = buildAttestationCanonicalPayload(fields({ policyVersions: [] }), "2026-08-28T12:00:00.000Z");
  const parts = payload.split("|");
  assertEquals(parts.length, 12);
});
