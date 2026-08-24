// Real tests for the webhook secret rotation grace-window logic.
//
// Run with: deno test --allow-env supabase/functions/_shared/webhook-secret-rotation_test.ts
import { previousSecretActive } from "./webhook-secret-rotation.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
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

const now = new Date("2026-08-25T12:00:00.000Z");

test("previousSecretActive: false when there's no previous_secret at all", () => {
  assert(!previousSecretActive({ secret: "s" }, now));
});

test("previousSecretActive: false when previous_secret is set but has no expiry", () => {
  assert(!previousSecretActive({ secret: "s", previous_secret: "old" }, now));
});

test("previousSecretActive: true when inside the grace window", () => {
  assert(previousSecretActive({
    secret: "s",
    previous_secret: "old",
    previous_secret_expires_at: "2026-08-25T13:00:00.000Z",
  }, now));
});

test("previousSecretActive: false once the grace window has passed", () => {
  assert(!previousSecretActive({
    secret: "s",
    previous_secret: "old",
    previous_secret_expires_at: "2026-08-25T11:00:00.000Z",
  }, now));
});

test("previousSecretActive: false exactly at expiry (not inclusive)", () => {
  assert(!previousSecretActive({
    secret: "s",
    previous_secret: "old",
    previous_secret_expires_at: "2026-08-25T12:00:00.000Z",
  }, now));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
