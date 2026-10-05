// Real tests for the /respond response cache (item 174).
//
// Run with: deno test --allow-none supabase/functions/_shared/response-cache_test.ts
import {
  cacheKeyFor,
  findExactCachedResponse,
  findNearDuplicateCachedResponse,
  storeCachedResponse,
  MIN_CACHE_SIMILARITY,
} from "./response-cache.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- cacheKeyFor ----

Deno.test("cacheKeyFor: identical after trimming and lowercasing hits the same key", async () => {
  const a = await cacheKeyFor("Refund policy?");
  const b = await cacheKeyFor("  refund policy?  ");
  assertEquals(a, b);
});

Deno.test("cacheKeyFor: a genuinely different message hashes differently", async () => {
  const a = await cacheKeyFor("Refund policy?");
  const b = await cacheKeyFor("Shipping policy?");
  assert(a !== b);
});

// ---- findExactCachedResponse ----

// deno-lint-ignore no-explicit-any
type FakeQuery = { data: unknown; error: unknown } & any;
// deno-lint-ignore no-explicit-any
type FakeAdmin = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): Promise<FakeQuery> };

function fakeFromReturning(row: unknown): FakeAdmin["from"] {
  return () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            gt: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: row, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  });
}

Deno.test("findExactCachedResponse: returns the cached row when the DB finds one", async () => {
  const row = { answer: "5-7 business days.", sources: null, confidence: "high" };
  const client = { from: fakeFromReturning(row) } as unknown as FakeAdmin;
  const result = await findExactCachedResponse(client as never, "key-1", "hash-1", 3);
  assertEquals(result, row);
});

Deno.test("findExactCachedResponse: no match returns null, never throws", async () => {
  const client = { from: fakeFromReturning(null) } as unknown as FakeAdmin;
  const result = await findExactCachedResponse(client as never, "key-1", "hash-1", 3);
  assertEquals(result, null);
});

Deno.test("findExactCachedResponse: a thrown exception returns null, never propagates", async () => {
  const client = {
    from: () => {
      throw new Error("db down");
    },
  } as unknown as FakeAdmin;
  assertEquals(await findExactCachedResponse(client as never, "key-1", "hash-1", 3), null);
});

// ---- findNearDuplicateCachedResponse ----

Deno.test("findNearDuplicateCachedResponse: applies the similarity floor", async () => {
  const client: FakeAdmin = {
    from: fakeFromReturning(null),
    rpc(name, args) {
      assertEquals(name, "search_response_cache");
      assertEquals(args._api_key_id, "key-1");
      assertEquals(args._policy_version, 3);
      return Promise.resolve({
        data: [{ answer: "close but not close enough", sources: null, confidence: "high", similarity: MIN_CACHE_SIMILARITY - 0.01 }],
        error: null,
      });
    },
  };
  assertEquals(await findNearDuplicateCachedResponse(client as never, "key-1", "[0.1]", 3), null);
});

Deno.test("findNearDuplicateCachedResponse: a similarity at or above the floor is returned", async () => {
  const client: FakeAdmin = {
    from: fakeFromReturning(null),
    rpc() {
      return Promise.resolve({
        data: [{ answer: "Refunds take 5-7 business days.", sources: [{ id: "e1", excerpt: "..." }], confidence: "high", similarity: 0.99 }],
        error: null,
      });
    },
  };
  const result = await findNearDuplicateCachedResponse(client as never, "key-1", "[0.1]", 3);
  assertEquals(result, { answer: "Refunds take 5-7 business days.", sources: [{ id: "e1", excerpt: "..." }], confidence: "high" });
});

Deno.test("findNearDuplicateCachedResponse: an RPC error returns null, never throws", async () => {
  const client: FakeAdmin = { from: fakeFromReturning(null), rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  assertEquals(await findNearDuplicateCachedResponse(client as never, "key-1", "[0.1]", 3), null);
});

Deno.test("findNearDuplicateCachedResponse: no matches returns null", async () => {
  const client: FakeAdmin = { from: fakeFromReturning(null), rpc: () => Promise.resolve({ data: [], error: null }) };
  assertEquals(await findNearDuplicateCachedResponse(client as never, "key-1", "[0.1]", 3), null);
});

// ---- storeCachedResponse ----

Deno.test("storeCachedResponse: inserts with the truncated message, a future expiry, and the policy version", async () => {
  let inserted: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return Promise.resolve({ error: null });
      },
    }),
  };
  await storeCachedResponse(
    client as never, "user-1", "key-1", "x".repeat(600), "hash-1", "[0.1]",
    "Refunds take 5-7 business days.", [{ id: "e1", excerpt: "..." }], "high", 3,
  );
  assert(inserted !== null);
  const row = inserted as unknown as Record<string, unknown>;
  assertEquals((row.message as string).length, 500);
  assert(new Date(row.expires_at as string).getTime() > Date.now());
  assertEquals(row.confidence, "high");
  assertEquals(row.policy_version, 3);
});

Deno.test("storeCachedResponse: a thrown insert error never propagates", async () => {
  const client = {
    from: () => ({
      insert: () => {
        throw new Error("db down");
      },
    }),
  };
  await storeCachedResponse(client as never, "user-1", "key-1", "hi", "hash-1", null, "answer", undefined, "high", 3);
});

// ---- GAP 6 (Persistent Ongoing Enforcement): policy_version scoping ----

Deno.test("findExactCachedResponse: filters on all three columns (api_key_id, message_hash, policy_version) before the expiry check", async () => {
  const seenColumns: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: (col: string) => {
          seenColumns.push(col);
          return {
            eq: (col2: string) => {
              seenColumns.push(col2);
              return {
                eq: (col3: string) => {
                  seenColumns.push(col3);
                  return { gt: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) };
                },
              };
            },
          };
        },
      }),
    }),
  } as unknown as FakeAdmin;
  await findExactCachedResponse(client as never, "key-1", "hash-1", 5);
  assertEquals(seenColumns, ["api_key_id", "message_hash", "policy_version"]);
});
