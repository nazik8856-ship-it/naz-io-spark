// Real tests for the decision-export endpoint's cursor/limit handling.
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-export_test.ts
import {
  encodeExportCursor, decodeExportCursor, clampExportLimit, exportCursorFilter,
  DEFAULT_EXPORT_LIMIT, MAX_EXPORT_LIMIT, buildExportPage, groupOutcomesByDecision,
  type ExportableOutcome,
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

// ---- "policy autonomy" item 12: buildExportPage / groupOutcomesByDecision ----

type Row = { id: string; created_at: string };
const row = (id: string, createdAt: string): Row => ({ id, created_at: createdAt });

Deno.test("buildExportPage: exactly limit rows (no extra) means no more pages, no next cursor", () => {
  const rows = [row("a", "2026-08-27T00:00:00Z"), row("b", "2026-08-27T00:00:01Z")];
  const result = buildExportPage(rows, 2);
  assertEquals(result.page, rows);
  assertEquals(result.hasMore, false);
  assertEquals(result.nextCursor, null);
});

Deno.test("buildExportPage: one extra row beyond the limit means there's more, and trims it off the returned page", () => {
  const rows = [row("a", "2026-08-27T00:00:00Z"), row("b", "2026-08-27T00:00:01Z"), row("c", "2026-08-27T00:00:02Z")];
  const result = buildExportPage(rows, 2);
  assertEquals(result.page, [rows[0], rows[1]]);
  assertEquals(result.hasMore, true);
  assertEquals(decodeExportCursor(result.nextCursor), { createdAt: "2026-08-27T00:00:01Z", id: "b" });
});

Deno.test("buildExportPage: an empty result has no more pages and no cursor", () => {
  const result = buildExportPage([], 50);
  assertEquals(result, { page: [], hasMore: false, nextCursor: null });
});

const outcome = (over: Partial<ExportableOutcome> = {}): ExportableOutcome => ({
  linked_metric: "reply_rate",
  baseline_value: 10,
  result_value: 12,
  delta: 2,
  delta_pct: 20,
  direction: "positive",
  window_days: 7,
  measured_at: "2026-08-27T00:00:00Z",
  ...over,
});

Deno.test("groupOutcomesByDecision: groups multiple outcome rows for the same decision into one array", () => {
  const grouped = groupOutcomesByDecision([
    { decision_id: "d1", ...outcome({ linked_metric: "reply_rate" }) },
    { decision_id: "d1", ...outcome({ linked_metric: "conversion", window_days: 30 }) },
    { decision_id: "d2", ...outcome({ linked_metric: "reply_rate" }) },
  ]);
  assertEquals(grouped.get("d1")?.length, 2);
  assertEquals(grouped.get("d2")?.length, 1);
  assert(!("decision_id" in (grouped.get("d1")?.[0] ?? {})), "the grouping key itself should not leak into each outcome object");
});

Deno.test("groupOutcomesByDecision: a decision with no outcome rows simply has no entry -- caller must default to an empty array", () => {
  const grouped = groupOutcomesByDecision([]);
  assertEquals(grouped.get("d1"), undefined);
  assertEquals(grouped.get("d1") ?? [], []);
});
