// Real tests for item 14's precedent-pipeline staleness classification.
//
// Run with: deno test --allow-none supabase/functions/_shared/precedent-pipeline-health_test.ts
import {
  isEmbeddingPipelineStale, summarizeEmbeddingCoverage, summarizeStalePipeline,
  MIN_RECENT_DECISIONS_TO_JUDGE, STALE_COVERAGE_RATIO, type DecisionRow,
} from "./precedent-pipeline-health.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const decision = (id: string, apiKeyId: string): DecisionRow => ({ id, api_key_id: apiKeyId });

// ---- summarizeEmbeddingCoverage ----

Deno.test("summarizeEmbeddingCoverage: counts total decisions and how many got embedded, per api key", () => {
  const decisions = [decision("d1", "key-1"), decision("d2", "key-1"), decision("d3", "key-2")];
  const coverage = summarizeEmbeddingCoverage(decisions, ["d1"]);
  const key1 = coverage.find((c) => c.apiKeyId === "key-1")!;
  const key2 = coverage.find((c) => c.apiKeyId === "key-2")!;
  assertEquals(key1.recentDecisions, 2);
  assertEquals(key1.recentEmbeddings, 1);
  assertEquals(key2.recentDecisions, 1);
  assertEquals(key2.recentEmbeddings, 0);
});

Deno.test("summarizeEmbeddingCoverage: an embedded id that doesn't belong to any recent decision is simply ignored", () => {
  const coverage = summarizeEmbeddingCoverage([decision("d1", "key-1")], ["d1", "some-other-decision-id"]);
  assertEquals(coverage.length, 1);
  assertEquals(coverage[0].recentEmbeddings, 1);
});

Deno.test("summarizeEmbeddingCoverage: no recent decisions at all produces an empty list", () => {
  assertEquals(summarizeEmbeddingCoverage([], []), []);
});

// ---- isEmbeddingPipelineStale ----

Deno.test("isEmbeddingPipelineStale: a barely-active key is never judged, whatever its coverage", () => {
  assertEquals(MIN_RECENT_DECISIONS_TO_JUDGE, 5);
  const row = { apiKeyId: "key-1", recentDecisions: MIN_RECENT_DECISIONS_TO_JUDGE - 1, recentEmbeddings: 0 };
  assertEquals(isEmbeddingPipelineStale(row), false);
});

Deno.test("isEmbeddingPipelineStale: real volume with almost nothing embedded is stale", () => {
  const row = { apiKeyId: "key-1", recentDecisions: 20, recentEmbeddings: 1 };
  assertEquals(isEmbeddingPipelineStale(row), true);
});

Deno.test("isEmbeddingPipelineStale: healthy coverage (near 100%) is never stale", () => {
  const row = { apiKeyId: "key-1", recentDecisions: 20, recentEmbeddings: 19 };
  assertEquals(isEmbeddingPipelineStale(row), false);
});

Deno.test("isEmbeddingPipelineStale: exactly at the threshold is not yet stale (strictly below counts)", () => {
  assertEquals(STALE_COVERAGE_RATIO, 0.1);
  const row = { apiKeyId: "key-1", recentDecisions: 10, recentEmbeddings: 1 }; // exactly 10%
  assertEquals(isEmbeddingPipelineStale(row), false);
});

Deno.test("isEmbeddingPipelineStale: zero embeddings out of real volume is stale", () => {
  const row = { apiKeyId: "key-1", recentDecisions: 10, recentEmbeddings: 0 };
  assertEquals(isEmbeddingPipelineStale(row), true);
});

// ---- summarizeStalePipeline ----

Deno.test("summarizeStalePipeline: mentions the real counts, the percentage, and the window", () => {
  const msg = summarizeStalePipeline({ apiKeyId: "key-1", recentDecisions: 20, recentEmbeddings: 2 }, 3);
  assert(msg.includes("20 decisions"));
  assert(msg.includes("2"));
  assert(msg.includes("10%"));
  assert(msg.includes("3 days"));
});
