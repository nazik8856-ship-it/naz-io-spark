// Real tests for the integration-revocation-sweep pure classification logic.
//
// Run with: deno test --allow-env supabase/functions/_shared/integration-revocation_test.ts
import { newlyBrokenIntegrations, summarizeRevokedIntegration, type ErroredIntegrationRow } from "./integration-revocation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function row(overrides: Partial<ErroredIntegrationRow> = {}): ErroredIntegrationRow {
  return {
    id: "int-1",
    userId: "user-1",
    agentId: null,
    provider: "Gmail",
    lastError: "Google refresh token revoked or expired — reconnect required.",
    updatedAt: "2026-08-25T10:00:00.000Z",
    revokedAlertedAt: null,
    ...overrides,
  };
}

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}\n  ${(e as Error).message}`);
  }
}

test("newlyBrokenIntegrations: a row never alerted is newly broken", () => {
  const rows = [row({ revokedAlertedAt: null })];
  assertEquals(newlyBrokenIntegrations(rows).length, 1);
});

test("newlyBrokenIntegrations: a row already alerted after its last break is NOT newly broken", () => {
  const rows = [row({ updatedAt: "2026-08-25T10:00:00.000Z", revokedAlertedAt: "2026-08-25T10:05:00.000Z" })];
  assertEquals(newlyBrokenIntegrations(rows).length, 0);
});

test("newlyBrokenIntegrations: a row that broke AGAIN after being alerted is newly broken", () => {
  const rows = [row({ updatedAt: "2026-08-25T11:00:00.000Z", revokedAlertedAt: "2026-08-25T10:05:00.000Z" })];
  assertEquals(newlyBrokenIntegrations(rows).length, 1);
});

test("newlyBrokenIntegrations: multiple rows are filtered independently", () => {
  const rows = [
    row({ id: "a", revokedAlertedAt: null }),
    row({ id: "b", updatedAt: "2026-08-25T10:00:00.000Z", revokedAlertedAt: "2026-08-25T10:05:00.000Z" }),
    row({ id: "c", updatedAt: "2026-08-25T12:00:00.000Z", revokedAlertedAt: "2026-08-25T10:05:00.000Z" }),
  ];
  const out = newlyBrokenIntegrations(rows).map((r) => r.id);
  assertEquals(out, ["a", "c"]);
});

test("summarizeRevokedIntegration: uses the real last_error when present", () => {
  const s = summarizeRevokedIntegration(row({ lastError: "invalid_grant" }));
  assert(s.includes("invalid_grant"), s);
  assert(s.includes("Gmail"), s);
});

test("summarizeRevokedIntegration: falls back to a generic message when last_error is empty", () => {
  const s = summarizeRevokedIntegration(row({ lastError: null }));
  assert(s.includes("revoked or expired"), s);
});

test("summarizeRevokedIntegration: mentions it's agent-scoped when agentId is set", () => {
  const s = summarizeRevokedIntegration(row({ agentId: "agent-1", lastError: null }));
  assert(s.includes("one of your agents"), s);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
