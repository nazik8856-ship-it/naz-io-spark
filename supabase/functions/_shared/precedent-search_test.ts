// Real tests for item 3's precedent-search wrapper.
//
// Run with: deno test --allow-none supabase/functions/_shared/precedent-search_test.ts
import { excludeDecisionFromPrecedent, filterPrecedentMatches, findPrecedent, loadOutcomeDirections, loadPrecedentForPrompt, loadStoredEmbeddingLiteral, MIN_SIMILARITY, type PrecedentMatch } from "./precedent-search.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const match = (similarity: number): PrecedentMatch => ({
  decisionId: "d1", actionType: "send_email", provider: "Gmail", similarity, createdAt: "2026-08-28T00:00:00Z",
});

// ---- filterPrecedentMatches ----

Deno.test("filterPrecedentMatches: keeps matches at or above the threshold", () => {
  const rows = [match(MIN_SIMILARITY), match(0.9)];
  assertEquals(filterPrecedentMatches(rows).length, 2);
});

Deno.test("filterPrecedentMatches: drops matches below the threshold", () => {
  const rows = [match(MIN_SIMILARITY - 0.01), match(0.1)];
  assertEquals(filterPrecedentMatches(rows).length, 0);
});

Deno.test("filterPrecedentMatches: an empty list stays empty", () => {
  assertEquals(filterPrecedentMatches([]), []);
});

// ---- findPrecedent ----

type Row = { data?: unknown; error?: unknown };

Deno.test("findPrecedent: maps RPC rows into PrecedentMatch and applies the similarity floor", async () => {
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, "search_decision_precedent");
      assertEquals(args._api_key_id, "key-1");
      assertEquals(args._exclude_decision_id, "current-decision");
      return Promise.resolve({
        data: [
          { decision_id: "d1", action_type: "send_email", provider: "Gmail", similarity: 0.9, created_at: "2026-08-28T00:00:00Z" },
          { decision_id: "d2", action_type: "send_email", provider: "Gmail", similarity: 0.1, created_at: "2026-08-27T00:00:00Z" },
        ] as unknown,
        error: null,
      });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const matches = await findPrecedent(client, "key-1", "[0.1,0.2]", "current-decision");
  assertEquals(matches.length, 1, "the 0.1-similarity row must be filtered out");
  assertEquals(matches[0].decisionId, "d1");
});

Deno.test("findPrecedent: an RPC error returns an empty array, never throws", async () => {
  const client = {
    rpc() { return Promise.resolve({ data: null, error: { message: "boom" } }); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await findPrecedent(client, "key-1", "[0.1]"), []);
});

Deno.test("findPrecedent: a thrown exception returns an empty array, never propagates", async () => {
  const client = {
    rpc() { throw new Error("network down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await findPrecedent(client, "key-1", "[0.1]"), []);
});

Deno.test("findPrecedent: a malformed (non-array) response returns an empty array", async () => {
  const client = {
    rpc() { return Promise.resolve({ data: "not an array", error: null }); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await findPrecedent(client, "key-1", "[0.1]"), []);
});

// ---- loadPrecedentForPrompt (item 4) ----

Deno.test("loadPrecedentForPrompt: joins decision/reasoning text onto each match", async () => {
  const client = {
    rpc() {
      return Promise.resolve({
        data: [{ decision_id: "d1", action_type: "send_email", provider: "Gmail", similarity: 0.9, created_at: "x" }],
        error: null,
      });
    },
    from(table: string) {
      assertEquals(table, "agent_decisions");
      return {
        select() { return this; },
        in() {
          return Promise.resolve({ data: [{ id: "d1", decision: "ALLOW send_email (Gmail)", reasoning: "fine" }], error: null });
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const rows = await loadPrecedentForPrompt(client, "key-1", "[0.1]");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].decision, "ALLOW send_email (Gmail)");
  assertEquals(rows[0].reasoning, "fine");
});

Deno.test("loadPrecedentForPrompt: no matches at all short-circuits without ever querying agent_decisions", async () => {
  let calledFrom = false;
  const client = {
    rpc() { return Promise.resolve({ data: [], error: null }); },
    from() { calledFrom = true; return { select() { return this; }, in() { return Promise.resolve({ data: [], error: null }); } }; },
    // deno-lint-ignore no-explicit-any
  } as any;
  const rows = await loadPrecedentForPrompt(client, "key-1", "[0.1]");
  assertEquals(rows, []);
  assertEquals(calledFrom, false);
});

Deno.test("loadPrecedentForPrompt: a failed join lookup returns an empty array, never throws", async () => {
  const client = {
    rpc() { return Promise.resolve({ data: [{ decision_id: "d1", action_type: "x", provider: "y", similarity: 0.9, created_at: "x" }], error: null }); },
    from() { throw new Error("db down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await loadPrecedentForPrompt(client, "key-1", "[0.1]"), []);
});

// ---- loadOutcomeDirections (item 6) ----

Deno.test("loadOutcomeDirections: maps decision id to its measured direction", async () => {
  const client = {
    from(table: string) {
      assertEquals(table, "decision_outcomes");
      return {
        select() { return this; },
        in() {
          return Promise.resolve({
            data: [{ decision_id: "d1", direction: "negative" }, { decision_id: "d2", direction: "positive" }],
            error: null,
          });
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const map = await loadOutcomeDirections(client, ["d1", "d2"]);
  assertEquals(map.get("d1"), "negative");
  assertEquals(map.get("d2"), "positive");
});

Deno.test("loadOutcomeDirections: an empty id list short-circuits without querying", async () => {
  let called = false;
  const client = {
    from() { called = true; return { select() { return this; }, in() { return Promise.resolve({ data: [], error: null }); } }; },
    // deno-lint-ignore no-explicit-any
  } as any;
  const map = await loadOutcomeDirections(client, []);
  assertEquals(map.size, 0);
  assertEquals(called, false);
});

Deno.test("loadOutcomeDirections: a thrown exception returns an empty map, never propagates", async () => {
  const client = {
    from() { throw new Error("db down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  const map = await loadOutcomeDirections(client, ["d1"]);
  assertEquals(map.size, 0);
});

// ---- excludeDecisionFromPrecedent (item 7) ----

class FakeUpdateQuery implements PromiseLike<Row> {
  filters: Record<string, unknown> = {};
  constructor(private resolve: () => Row) {}
  update(_row?: unknown) { return this; }
  eq(col: string, val: unknown) { this.filters[col] = val; return this; }
  select() { return this; }
  maybeSingle() { return this; }
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

Deno.test("excludeDecisionFromPrecedent: returns 'excluded' when a matching embedding row exists", async () => {
  let q: FakeUpdateQuery | null = null;
  const client = {
    from(table: string) {
      assertEquals(table, "decision_embeddings");
      q = new FakeUpdateQuery(() => ({ data: { id: "row-1" }, error: null }));
      return q;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const outcome = await excludeDecisionFromPrecedent(client, "user-1", "d1");
  assertEquals(outcome, "excluded");
  assertEquals(q!.filters, { decision_id: "d1", user_id: "user-1" });
});

Deno.test("excludeDecisionFromPrecedent: returns 'no_precedent_record' when nothing was embedded for that decision", async () => {
  const client = {
    from() { return new FakeUpdateQuery(() => ({ data: null, error: null })); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await excludeDecisionFromPrecedent(client, "user-1", "d1"), "no_precedent_record");
});

Deno.test("excludeDecisionFromPrecedent: a thrown exception returns 'no_precedent_record', never propagates", async () => {
  const client = {
    from() { throw new Error("db down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await excludeDecisionFromPrecedent(client, "user-1", "d1"), "no_precedent_record");
});

// ---- loadStoredEmbeddingLiteral ----

class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  maybeSingle() { return this; }
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

Deno.test("loadStoredEmbeddingLiteral: returns the stored literal when a row exists", async () => {
  const client = {
    from(table: string) {
      assertEquals(table, "decision_embeddings");
      return new FakeQuery(() => ({ data: { embedding: "[0.1,0.2,0.3]" }, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await loadStoredEmbeddingLiteral(client, "d1"), "[0.1,0.2,0.3]");
});

Deno.test("loadStoredEmbeddingLiteral: returns null when no row exists yet", async () => {
  const client = {
    from() { return new FakeQuery(() => ({ data: null, error: null })); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await loadStoredEmbeddingLiteral(client, "d1"), null);
});

Deno.test("loadStoredEmbeddingLiteral: a thrown exception returns null, never propagates", async () => {
  const client = {
    from() { throw new Error("db down"); },
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(await loadStoredEmbeddingLiteral(client, "d1"), null);
});
