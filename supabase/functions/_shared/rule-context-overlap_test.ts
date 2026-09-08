// Real tests for the rule/context overlap advisory's pure decision logic
// (integration round, following on from items 177/179-180).
//
// Run with: deno test --allow-none supabase/functions/_shared/rule-context-overlap_test.ts
import { findOverlappingCandidates, type OverlapCandidate } from "./rule-context-overlap.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("findOverlappingCandidates: no candidates at all returns empty", () => {
  assertEquals(findOverlappingCandidates("refund policy", []), []);
});

Deno.test("findOverlappingCandidates: an empty phrase returns empty", () => {
  const candidates: OverlapCandidate[] = [{ id: "c1", text: "Refunds are processed within 5 to 7 business days." }];
  assertEquals(findOverlappingCandidates("   ", candidates), []);
});

Deno.test("findOverlappingCandidates: a candidate containing the phrase verbatim is flagged", () => {
  const candidates: OverlapCandidate[] = [{ id: "c1", text: "Our refund policy takes 2 weeks to process." }];
  assertEquals(findOverlappingCandidates("refund policy", candidates), [{ id: "c1", excerpt: "Our refund policy takes 2 weeks to process." }]);
});

Deno.test("findOverlappingCandidates: case and whitespace differences never matter", () => {
  const candidates: OverlapCandidate[] = [{ id: "c1", text: "Our   REFUND    POLICY   is generous." }];
  assertEquals(findOverlappingCandidates("refund policy", candidates), [{ id: "c1", excerpt: "Our   REFUND    POLICY   is generous." }]);
});

Deno.test("findOverlappingCandidates: an unrelated candidate is never flagged", () => {
  const candidates: OverlapCandidate[] = [{ id: "c1", text: "We ship internationally to over 40 countries." }];
  assertEquals(findOverlappingCandidates("refund policy", candidates), []);
});

Deno.test("findOverlappingCandidates: only the matching candidates are returned, in order given", () => {
  const candidates: OverlapCandidate[] = [
    { id: "c1", text: "We ship internationally." },
    { id: "c2", text: "Our refund policy is 2 weeks." },
    { id: "c3", text: "See our refund policy page for details." },
  ];
  assertEquals(findOverlappingCandidates("refund policy", candidates), [
    { id: "c2", excerpt: "Our refund policy is 2 weeks." },
    { id: "c3", excerpt: "See our refund policy page for details." },
  ]);
});

Deno.test("findOverlappingCandidates: excerpt is truncated for a very long candidate text", () => {
  const longText = "refund policy " + "x".repeat(300);
  const candidates: OverlapCandidate[] = [{ id: "c1", text: longText }];
  const result = findOverlappingCandidates("refund policy", candidates);
  assertEquals(result.length, 1);
  assert(result[0].excerpt.endsWith("…"), "expected truncated excerpt to end with an ellipsis");
  assert(result[0].excerpt.length <= 201, "expected excerpt to be capped near MAX_OVERLAP_EXCERPT_CHARS");
});
