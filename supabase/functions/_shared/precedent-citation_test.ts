// Real tests for item 9's precedent-citation trail.
//
// Run with: deno test --allow-none supabase/functions/_shared/precedent-citation_test.ts
import { buildPrecedentCitationRecord, recordPrecedentCitation, type PrecedentCitationRecord } from "./precedent-citation.ts";
import { evaluatePrecedentForAutoApprove } from "./precedent-advice.ts";
import type { PrecedentMatch } from "./precedent-search.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const match = (decisionId: string, similarity: number): PrecedentMatch => ({
  decisionId, actionType: "send_email", provider: "Gmail", similarity, createdAt: "2026-08-28T00:00:00Z",
});

// ---- buildPrecedentCitationRecord ----

Deno.test("buildPrecedentCitationRecord: names a clear non-allow majority as the reason and lists every cited decision", () => {
  const matches = [match("d1", 0.9), match("d2", 0.8), match("d3", 0.7)];
  const nonAllowFlags = [true, true, false];
  const advice = evaluatePrecedentForAutoApprove(nonAllowFlags);
  assert(advice.available);
  if (!advice.available) return;
  const record = buildPrecedentCitationRecord(advice, matches, nonAllowFlags);
  assertEquals(record.reason, "non_allow_majority");
  assertEquals(record.sampleSize, 3);
  assertEquals(record.citedDecisions.length, 3);
  assertEquals(record.citedDecisions[0], { decisionId: "d1", similarity: 0.9, nonAllow: true });
  assertEquals(record.citedDecisions[2], { decisionId: "d3", similarity: 0.7, nonAllow: false });
});

Deno.test("buildPrecedentCitationRecord: names a genuine split as 'contradictory', not a false majority", () => {
  const matches = [match("d1", 0.9), match("d2", 0.85), match("d3", 0.8), match("d4", 0.7)];
  const nonAllowFlags = [true, true, false, false];
  const advice = evaluatePrecedentForAutoApprove(nonAllowFlags);
  assert(advice.available);
  if (!advice.available) return;
  const record = buildPrecedentCitationRecord(advice, matches, nonAllowFlags);
  assertEquals(record.reason, "contradictory");
});

// ---- recordPrecedentCitation ----

type Row = { data?: unknown; error?: unknown };
class FakeUpdateQuery implements PromiseLike<Row> {
  filters: Record<string, unknown> = {};
  updated: unknown = null;
  update(row?: unknown) { this.updated = row; return this; }
  eq(col: string, val: unknown) { this.filters[col] = val; return this; }
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

Deno.test("recordPrecedentCitation: updates the right decision row with the full record", async () => {
  let q: FakeUpdateQuery | null = null;
  const client = {
    from(table: string) {
      assertEquals(table, "agent_decisions");
      q = new FakeUpdateQuery();
      return q;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const record: PrecedentCitationRecord = {
    reason: "non_allow_majority", sampleSize: 3, nonAllowShare: 0.67,
    citedDecisions: [{ decisionId: "d1", similarity: 0.9, nonAllow: true }],
  };
  await recordPrecedentCitation(client, "decision-1", record);
  assertEquals(q!.filters, { id: "decision-1" });
  assertEquals(q!.updated, { precedent_citations: record });
});

Deno.test("recordPrecedentCitation: a thrown exception never propagates -- citation is best-effort enrichment", async () => {
  const client = {
    from() { throw new Error("db down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  await recordPrecedentCitation(client, "decision-1", {
    reason: "contradictory", sampleSize: 4, nonAllowShare: 0.5, citedDecisions: [],
  });
});
