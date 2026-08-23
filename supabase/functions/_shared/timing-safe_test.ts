// Real tests for the constant-time string comparison helper.
//
// Run with: deno test --allow-none supabase/functions/_shared/timing-safe_test.ts
import { timingSafeEqual } from "./timing-safe.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}

Deno.test("timingSafeEqual: identical strings are equal", () => {
  assert(timingSafeEqual("super-secret-123", "super-secret-123"));
});

Deno.test("timingSafeEqual: an empty string equals itself", () => {
  assert(timingSafeEqual("", ""));
});

Deno.test("timingSafeEqual: same length, differs in the first byte", () => {
  assertFalse(timingSafeEqual("aecret-123", "secret-123"));
});

Deno.test("timingSafeEqual: same length, differs only in the last byte", () => {
  assertFalse(timingSafeEqual("secret-124", "secret-123"));
});

Deno.test("timingSafeEqual: different lengths are never equal", () => {
  assertFalse(timingSafeEqual("secret", "secret-123"));
  assertFalse(timingSafeEqual("secret-123", "secret"));
});

Deno.test("timingSafeEqual: an empty string never equals a non-empty one", () => {
  assertFalse(timingSafeEqual("", "secret"));
  assertFalse(timingSafeEqual("secret", ""));
});

Deno.test("timingSafeEqual: handles multi-byte (non-ASCII) characters correctly", () => {
  assert(timingSafeEqual("sécret-🔒", "sécret-🔒"));
  assertFalse(timingSafeEqual("sécret-🔒", "secret-🔒"));
});
