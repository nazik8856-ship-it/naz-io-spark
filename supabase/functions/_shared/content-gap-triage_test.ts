// Real tests for content-gap-triage-sweep's pure decision logic
// (items 179-180).
//
// Run with: deno test --allow-none supabase/functions/_shared/content-gap-triage_test.ts
import { pickMatchingCluster, CLUSTER_SIMILARITY_THRESHOLD, type GapClusterCandidate } from "./content-gap-triage.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("pickMatchingCluster: no candidates at all starts a new cluster", () => {
  assertEquals(pickMatchingCluster([]), null);
});

Deno.test("pickMatchingCluster: a nearest candidate above the threshold is picked", () => {
  const candidates: GapClusterCandidate[] = [{ id: "c1", representative_message: "How long do refunds take?", similarity: 0.9 }];
  assertEquals(pickMatchingCluster(candidates), { id: "c1" });
});

Deno.test("pickMatchingCluster: a nearest candidate below the threshold starts a new cluster instead", () => {
  const candidates: GapClusterCandidate[] = [{ id: "c1", representative_message: "Unrelated topic", similarity: 0.5 }];
  assertEquals(pickMatchingCluster(candidates), null);
});

Deno.test("pickMatchingCluster: only ever looks at the first (nearest) candidate", () => {
  const candidates: GapClusterCandidate[] = [
    { id: "near-but-not-close-enough", representative_message: "x", similarity: 0.6 },
    { id: "would-have-matched-if-checked", representative_message: "y", similarity: 0.95 },
  ];
  assertEquals(pickMatchingCluster(candidates), null);
});

Deno.test("pickMatchingCluster: exactly at the threshold counts as a match", () => {
  const candidates: GapClusterCandidate[] = [{ id: "c1", representative_message: "x", similarity: CLUSTER_SIMILARITY_THRESHOLD }];
  assertEquals(pickMatchingCluster(candidates), { id: "c1" });
});
