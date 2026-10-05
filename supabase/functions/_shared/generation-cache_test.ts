// Real tests for GAP 8's generation cache (compile-agent-manifest /
// compile-website-manifest skip the expensive AI call(s) on an identical
// repeated request).
//
// Run with: deno test --allow-none supabase/functions/_shared/generation-cache_test.ts
import { GENERATION_CACHE_TTL_MINUTES, generationCacheKeyFor, findCachedGeneration, storeCachedGeneration } from "./generation-cache.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- generationCacheKeyFor ----

Deno.test("generationCacheKeyFor: identical fields in a different insertion order hash identically", async () => {
  const a = await generationCacheKeyFor({ plan: "sell coffee", role: "sales_ops", businessProfileId: "bp-1" });
  const b = await generationCacheKeyFor({ businessProfileId: "bp-1", role: "sales_ops", plan: "sell coffee" });
  assertEquals(a, b);
});

Deno.test("generationCacheKeyFor: a genuinely different field hashes differently", async () => {
  const a = await generationCacheKeyFor({ plan: "sell coffee" });
  const b = await generationCacheKeyFor({ plan: "sell pastries" });
  assert(a !== b);
});

Deno.test("generationCacheKeyFor: undefined vs the field simply absent hash the same (both serialize away)", async () => {
  const a = await generationCacheKeyFor({ plan: "x", role: undefined });
  const b = await generationCacheKeyFor({ plan: "x" });
  assertEquals(a, b);
});

// ---- findCachedGeneration ----

// deno-lint-ignore no-explicit-any
type FakeAdmin = { from(table: string): any };

function fakeFromReturning(row: unknown): FakeAdmin["from"] {
  return () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            gt: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
        }),
      }),
    }),
  });
}

Deno.test("findCachedGeneration: returns the cached manifest when the DB finds an unexpired row", async () => {
  const manifest = { name: "Acme Sales Agent", tools: [] };
  const client = { from: fakeFromReturning({ manifest }) } as unknown as FakeAdmin;
  const result = await findCachedGeneration(client as never, "user-1", "agent", "key-1");
  assertEquals(result, manifest);
});

Deno.test("findCachedGeneration: no row returns null, never throws", async () => {
  const client = { from: fakeFromReturning(null) } as unknown as FakeAdmin;
  const result = await findCachedGeneration(client as never, "user-1", "website", "key-1");
  assertEquals(result, null);
});

Deno.test("findCachedGeneration: a thrown exception (e.g. the DB unreachable) returns null, never propagates", async () => {
  const client = {
    from: () => {
      throw new Error("db down");
    },
  } as unknown as FakeAdmin;
  assertEquals(await findCachedGeneration(client as never, "user-1", "agent", "key-1"), null);
});

Deno.test("findCachedGeneration: scopes the lookup by user_id, kind, and cache_key before the expiry check", async () => {
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
                  return { gt: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) };
                },
              };
            },
          };
        },
      }),
    }),
  } as unknown as FakeAdmin;
  await findCachedGeneration(client as never, "user-1", "agent", "key-1");
  assertEquals(seenColumns, ["user_id", "kind", "cache_key"]);
});

// ---- storeCachedGeneration ----

Deno.test("storeCachedGeneration: upserts with a future expiry on the (user_id, kind, cache_key) conflict target", async () => {
  let upserted: Record<string, unknown> | null = null;
  let conflictTarget: string | null = null;
  const client = {
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => {
        upserted = row;
        conflictTarget = opts.onConflict;
        return Promise.resolve({ error: null });
      },
    }),
  };
  const manifest = { name: "Acme Site" };
  await storeCachedGeneration(client as never, "user-1", "website", "key-1", manifest);
  assert(upserted !== null);
  const row = upserted as unknown as Record<string, unknown>;
  assertEquals(row.user_id, "user-1");
  assertEquals(row.kind, "website");
  assertEquals(row.cache_key, "key-1");
  assertEquals(row.manifest, manifest);
  assert(new Date(row.expires_at as string).getTime() > Date.now());
  assert(
    new Date(row.expires_at as string).getTime() <= Date.now() + GENERATION_CACHE_TTL_MINUTES * 60 * 1000 + 1000,
    "expiry must respect the documented TTL",
  );
  assertEquals(conflictTarget, "user_id,kind,cache_key");
});

Deno.test("storeCachedGeneration: a thrown upsert error never propagates (caching is best-effort)", async () => {
  const client = {
    from: () => ({
      upsert: () => {
        throw new Error("db down");
      },
    }),
  };
  await storeCachedGeneration(client as never, "user-1", "agent", "key-1", { name: "x" });
});
