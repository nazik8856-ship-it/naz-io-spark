// Real tests for account-members invite validation.
//
// Run with: deno test --allow-none supabase/functions/_shared/account-members_test.ts
import { isValidAccountRole, isValidEmail, ACCOUNT_ROLES } from "./account-members.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("isValidAccountRole accepts owner, approver, viewer", () => {
  for (const r of ACCOUNT_ROLES) assert(isValidAccountRole(r), `${r} should be valid`);
});

Deno.test("isValidAccountRole rejects unknown strings and non-strings", () => {
  assertFalse(isValidAccountRole("admin")); // the OLD global-role name — must not silently accept it
  assertFalse(isValidAccountRole(""));
  assertFalse(isValidAccountRole(null));
  assertFalse(isValidAccountRole(undefined));
  assertFalse(isValidAccountRole(42));
});

Deno.test("isValidEmail accepts a plausible email", () => {
  assert(isValidEmail("teammate@example.com"));
});

Deno.test("isValidEmail rejects obviously malformed input", () => {
  assertFalse(isValidEmail("not-an-email"));
  assertFalse(isValidEmail("missing@domain"));
  assertFalse(isValidEmail(""));
  assertFalse(isValidEmail(null));
  assertFalse(isValidEmail(42));
});
