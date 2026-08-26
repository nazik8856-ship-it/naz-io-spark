// Real tests for the decision-export endpoint's cursor/limit handling.
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-export_test.ts
import {
  encodeExportCursor, decodeExportCursor, clampExportLimit, exportCursorFilter,
  DEFAULT_EXPORT_LIMIT, MAX_EXPORT_LIMIT,
} from "./decision-export.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("encodeExportCursor/decodeExportCursor: round-trips exactly", () => {
  const cursor = { createdAt: "2026-08-27T12:00:00.000Z", id: "11111111-1111-1111-1111-111111111111" };
  const encoded = encodeExportCursor(cursor);
  assertEquals(decodeExportCursor(encoded), cursor);
});

Deno.test("decodeExportCursor: null/undefined/empty is treated as no cursor, not a crash", () => {
  assertEquals(decodeExportCursor(null), null);
  assertEquals(decodeExportCursor(undefined), null);
  assertEquals(decodeExportCursor(""), null);
});

Deno.test("decodeExportCursor: a garbage string is rejected, never misparsed", () => {
  assertEquals(decodeExportCursor("not-a-real-cursor"), null);
  assertEquals(decodeExportCursor("dxc1:not-valid-base64!!!"), null);
});

Deno.test("decodeExportCursor: a well-formed but unversioned/foreign cursor is rejected", () => {
  assertEquals(decodeExportCursor(btoa("2026-08-27|some-id")), null, "missing the dxc1: version prefix");
});

Deno.test("decodeExportCursor: malformed inner payload (no separator, or an empty half) is rejected", () => {
  assertEquals(decodeExportCursor("dxc1:" + btoa("no-separator-here")), null);
  assertEquals(decodeExportCursor("dxc1:" + btoa("|missing-created-at")), null);
  assertEquals(decodeExportCursor("dxc1:" + btoa("2026-08-27T00:00:00Z|")), null);
});

Deno.test("clampExportLimit: a normal value under the max passes through, floored", () => {
  assertEquals(clampExportLimit(50), 50);
  assertEquals(clampExportLimit(50.9), 50);
});

Deno.test("clampExportLimit: anything non-numeric, zero, or negative falls back to the default", () => {
  assertEquals(clampExportLimit("bogus"), DEFAULT_EXPORT_LIMIT);
  assertEquals(clampExportLimit(0), DEFAULT_EXPORT_LIMIT);
  assertEquals(clampExportLimit(-10), DEFAULT_EXPORT_LIMIT);
  assertEquals(clampExportLimit(null), DEFAULT_EXPORT_LIMIT);
  assertEquals(clampExportLimit(undefined), DEFAULT_EXPORT_LIMIT);
});

Deno.test("clampExportLimit: never exceeds MAX_EXPORT_LIMIT regardless of what the caller asks for", () => {
  assertEquals(clampExportLimit(100000), MAX_EXPORT_LIMIT);
  assertEquals(clampExportLimit(MAX_EXPORT_LIMIT), MAX_EXPORT_LIMIT);
  assertEquals(clampExportLimit(MAX_EXPORT_LIMIT + 1), MAX_EXPORT_LIMIT);
});

Deno.test("exportCursorFilter: builds the expected PostgREST .or() expression", () => {
  const filter = exportCursorFilter({ createdAt: "2026-08-27T12:00:00.000Z", id: "abc-123" });
  assertEquals(
    filter,
    "created_at.gt.2026-08-27T12:00:00.000Z,and(created_at.eq.2026-08-27T12:00:00.000Z,id.gt.abc-123)",
  );
});
