// Real tests for the daily-digest "is there anything to say" gate.
//
// Run with: deno test --allow-none supabase/functions/_shared/digest_test.ts
import { digestHasContent } from "./digest.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("nothing to report: no digest", () => {
  assertFalse(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 10 }));
});

Deno.test("any open incident is worth a digest, even just one", () => {
  assert(digestHasContent({ openIncidents: 1, pendingApprovals: 0, spendPct: 0 }));
});

Deno.test("any pending approval is worth a digest", () => {
  assert(digestHasContent({ openIncidents: 0, pendingApprovals: 1, spendPct: 0 }));
});

Deno.test("spend under 80% of cap is not worth a digest on its own", () => {
  assertFalse(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 79 }));
});

Deno.test("spend at or above 80% of cap is worth a digest", () => {
  assert(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 80 }));
  assert(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 100 }));
});

Deno.test("a failing audit-integrity sweep is worth a digest, even with nothing else going on", () => {
  assert(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 0, auditIntegrityFailing: true }));
});

Deno.test("a passing (or absent) audit-integrity sweep does not force a digest on its own", () => {
  assertFalse(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 0, auditIntegrityFailing: false }));
  assertFalse(digestHasContent({ openIncidents: 0, pendingApprovals: 0, spendPct: 0 }));
});
