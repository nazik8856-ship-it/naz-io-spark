// Real test for multi-approver quorum enforcement — the exact function
// control-engine's POST /approvals/:id/execute calls before it will ever run
// a real provider write. Run with: deno test supabase/functions/_shared/quorum_test.ts
//
// No remote imports on purpose (this repo's sandboxed CI cannot always reach
// deno.land/jsr.io) — these three helpers are all `deno test` needs.
import { checkApprovalQuorum, distinctApprovalCount } from "./quorum.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("1 of 2 required approvals still blocks execution", () => {
  const result = checkApprovalQuorum({
    status: "pending",
    required_approvals: 2,
    approvals: [{ by: "user-a", at: "2026-08-17T00:00:00Z" }],
  });
  assertFalse(result.ok);
  if (!result.ok) {
    assertEquals(result.reason, "quorum_not_met");
    assertEquals(result.distinct, 1);
    assertEquals(result.needed, 2);
    assertEquals(result.remaining, 1);
  }
});

Deno.test("2 of 2 required approvals allows execution", () => {
  const result = checkApprovalQuorum({
    status: "approved",
    required_approvals: 2,
    approvals: [
      { by: "user-a", at: "2026-08-17T00:00:00Z" },
      { by: "user-b", at: "2026-08-17T00:01:00Z" },
    ],
  });
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.distinct, 2);
    assertEquals(result.needed, 2);
  }
});

Deno.test("a single approver on a required_approvals=1 row is sufficient", () => {
  const result = checkApprovalQuorum({
    status: "approved",
    required_approvals: 1,
    approvals: [{ by: "user-a", at: "2026-08-17T00:00:00Z" }],
  });
  assert(result.ok);
});

Deno.test("the same approver signing off twice does not count twice", () => {
  const result = checkApprovalQuorum({
    status: "pending",
    required_approvals: 2,
    approvals: [
      { by: "user-a", at: "2026-08-17T00:00:00Z" },
      { by: "user-a", at: "2026-08-17T00:05:00Z" },
    ],
  });
  assertFalse(result.ok);
  if (!result.ok) {
    assertEquals(result.distinct, 1);
    assertEquals(result.remaining, 1);
  }
});

Deno.test("a rejected row is refused even with full quorum recorded before rejection", () => {
  const result = checkApprovalQuorum({
    status: "rejected",
    required_approvals: 2,
    approvals: [
      { by: "user-a", at: "2026-08-17T00:00:00Z" },
      { by: "user-b", at: "2026-08-17T00:01:00Z" },
    ],
  });
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.reason, "rejected");
});

Deno.test("status other than approved is refused even when the approval count is met", () => {
  // Defends against a scenario where `approvals` was somehow populated to the
  // right length but `status` was never actually flipped by the signoff RPC —
  // status is authoritative, not just the count.
  const result = checkApprovalQuorum({
    status: "pending",
    required_approvals: 1,
    approvals: [{ by: "user-a", at: "2026-08-17T00:00:00Z" }],
  });
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.reason, "quorum_not_met");
});

Deno.test("required_approvals is clamped to a minimum of 1 (never 0 or negative)", () => {
  const zero = checkApprovalQuorum({ status: "approved", required_approvals: 0, approvals: [] });
  const negative = checkApprovalQuorum({ status: "approved", required_approvals: -3, approvals: [] });
  // With zero distinct approvals and a floor of 1 required, neither can pass.
  assertFalse(zero.ok);
  assertFalse(negative.ok);
});

Deno.test("missing/malformed approvals array is treated as zero signoffs, not a crash", () => {
  assertEquals(distinctApprovalCount(undefined), 0);
  assertEquals(distinctApprovalCount(null), 0);
  assertEquals(distinctApprovalCount("not-an-array"), 0);
  assertEquals(distinctApprovalCount([{ notBy: "x" }]), 0);
});

Deno.test("5 of 5 required approvals (max quorum) allows execution", () => {
  const result = checkApprovalQuorum({
    status: "approved",
    required_approvals: 5,
    approvals: Array.from({ length: 5 }, (_, i) => ({ by: `user-${i}`, at: "2026-08-17T00:00:00Z" })),
  });
  assert(result.ok);
});

Deno.test("4 of 5 required approvals (one short of max quorum) still blocks", () => {
  const result = checkApprovalQuorum({
    status: "pending",
    required_approvals: 5,
    approvals: Array.from({ length: 4 }, (_, i) => ({ by: `user-${i}`, at: "2026-08-17T00:00:00Z" })),
  });
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.remaining, 1);
});
