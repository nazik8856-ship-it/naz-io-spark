// Real tests for the Control API's version-routing helper.
//
// Run with: deno test --allow-none supabase/functions/_shared/api-versioning_test.ts
import { checkApiVersion, CONTROL_API_VERSION } from "./api-versioning.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("checkApiVersion: a bare /control-api path (no version segment) is accepted as today's version", () => {
  assertEquals(checkApiVersion("/control-api"), { ok: true });
  assertEquals(checkApiVersion("/functions/v1/control-api"), { ok: true });
});

Deno.test("checkApiVersion: an explicit /v1 segment matching the current version is accepted", () => {
  assertEquals(checkApiVersion("/control-api/v1"), { ok: true });
  assertEquals(checkApiVersion("/control-api/v1/"), { ok: true });
  assertEquals(checkApiVersion("/functions/v1/control-api/v1"), { ok: true });
});

Deno.test("checkApiVersion: a future version segment is rejected, not silently served by today's behavior", () => {
  assertEquals(checkApiVersion("/control-api/v2"), { ok: false, requested: "v2" });
  assertEquals(checkApiVersion("/control-api/v2/"), { ok: false, requested: "v2" });
});

Deno.test("checkApiVersion: honors a custom 'supported' version argument", () => {
  assertEquals(checkApiVersion("/control-api/v2", "v2"), { ok: true });
  assertEquals(checkApiVersion("/control-api/v1", "v2"), { ok: false, requested: "v1" });
});

Deno.test("checkApiVersion: CONTROL_API_VERSION is exactly v1 today", () => {
  assertEquals(CONTROL_API_VERSION, "v1");
});
