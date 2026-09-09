// Real tests for content-gap backlog staleness classification.
//
// Run with: deno test --allow-none supabase/functions/_shared/content-gap-backlog-health_test.ts
import {
  isContentGapBacklogStale, summarizeStaleContentGapBacklog, CONTENT_GAP_BACKLOG_THRESHOLD,
} from "./content-gap-backlog-health.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- isContentGapBacklogStale ----

Deno.test("isContentGapBacklogStale: no unresolved cluster at all is never stale", () => {
  assertEquals(isContentGapBacklogStale(null), false);
});

Deno.test("isContentGapBacklogStale: a small, healthy cluster is not stale", () => {
  assertEquals(isContentGapBacklogStale({ occurrenceCount: 3 }), false);
});

Deno.test("isContentGapBacklogStale: exactly at the threshold IS stale (unlike the strictly-below embedding-coverage check, this is a count that should trip the moment it's reached)", () => {
  assertEquals(CONTENT_GAP_BACKLOG_THRESHOLD, 20);
  assertEquals(isContentGapBacklogStale({ occurrenceCount: 20 }), true);
});

Deno.test("isContentGapBacklogStale: one below the threshold is not yet stale", () => {
  assertEquals(isContentGapBacklogStale({ occurrenceCount: 19 }), false);
});

Deno.test("isContentGapBacklogStale: well past the threshold is stale", () => {
  assertEquals(isContentGapBacklogStale({ occurrenceCount: 200 }), true);
});

// ---- summarizeStaleContentGapBacklog ----

Deno.test("summarizeStaleContentGapBacklog: mentions the real question and the real count", () => {
  const msg = summarizeStaleContentGapBacklog("Do you ship to Canada?", 47);
  assert(msg.includes("Do you ship to Canada?"));
  assert(msg.includes("47"));
});

Deno.test("summarizeStaleContentGapBacklog: truncates a very long representative message rather than dumping it raw", () => {
  const longMessage = "a".repeat(500);
  const msg = summarizeStaleContentGapBacklog(longMessage, 25);
  assert(msg.includes("…"));
  assert(!msg.includes("a".repeat(500)));
});
