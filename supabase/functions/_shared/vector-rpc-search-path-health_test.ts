// Real tests for the vector-RPC search_path health check's pure
// classification logic.
//
// Run with: deno test --allow-none supabase/functions/_shared/vector-rpc-search-path-health_test.ts
import { findBrokenVectorRpcs, vectorRpcIncidentKind, summarizeBrokenVectorRpc, type VectorRpcSearchPathRow } from "./vector-rpc-search-path-health.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("findBrokenVectorRpcs: all healthy returns an empty array", () => {
  const rows: VectorRpcSearchPathRow[] = [
    { functionName: "search_decision_precedent", searchPathOk: true },
    { functionName: "search_response_context", searchPathOk: true },
  ];
  assertEquals(findBrokenVectorRpcs(rows), []);
});

Deno.test("findBrokenVectorRpcs: reports exactly the broken ones, sorted", () => {
  const rows: VectorRpcSearchPathRow[] = [
    { functionName: "search_response_context", searchPathOk: true },
    { functionName: "search_decision_precedent", searchPathOk: false },
    { functionName: "search_response_cache", searchPathOk: false },
  ];
  assertEquals(findBrokenVectorRpcs(rows), ["search_decision_precedent", "search_response_cache"]);
});

Deno.test("findBrokenVectorRpcs: an empty input reports nothing broken, never throws", () => {
  assertEquals(findBrokenVectorRpcs([]), []);
});

Deno.test("vectorRpcIncidentKind: distinct, stable kind per function name", () => {
  assertEquals(vectorRpcIncidentKind("search_response_cache"), "vector_rpc_search_path:search_response_cache");
  assert(vectorRpcIncidentKind("a") !== vectorRpcIncidentKind("b"));
});

Deno.test("summarizeBrokenVectorRpc: names the function and the missing schema", () => {
  const summary = summarizeBrokenVectorRpc("search_response_context");
  assert(summary.includes("search_response_context"));
  assert(summary.includes("extensions"));
});
