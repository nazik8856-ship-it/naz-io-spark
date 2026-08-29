// Real tests for the structured override-reason taxonomy.
//
// Run with: deno test --allow-none supabase/functions/_shared/override-reason_test.ts
import { isValidOverrideReasonCode, describeOverrideReasonCode, OVERRIDE_REASON_CODES, type OverrideReasonCode } from "./override-reason.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("isValidOverrideReasonCode: every real code in the taxonomy is valid", () => {
  for (const code of OVERRIDE_REASON_CODES) assert(isValidOverrideReasonCode(code));
});

Deno.test("isValidOverrideReasonCode: an unrecognized string is invalid", () => {
  assertFalse(isValidOverrideReasonCode("made_up_reason"));
});

Deno.test("isValidOverrideReasonCode: null, undefined, and non-strings are all invalid", () => {
  assertFalse(isValidOverrideReasonCode(null));
  assertFalse(isValidOverrideReasonCode(undefined));
  assertFalse(isValidOverrideReasonCode(42));
  assertFalse(isValidOverrideReasonCode({}));
});

Deno.test("describeOverrideReasonCode: every real code has a non-empty, distinct description", () => {
  const seen = new Set<string>();
  for (const code of OVERRIDE_REASON_CODES) {
    const desc = describeOverrideReasonCode(code as OverrideReasonCode);
    assert(desc.length > 0);
    assert(!seen.has(desc), `duplicate description for ${code}`);
    seen.add(desc);
  }
});
