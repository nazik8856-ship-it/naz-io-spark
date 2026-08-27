// Real tests for the confidence-miscalibration corrective action.
//
// Run with: deno test --allow-env supabase/functions/_shared/confidence-bucket-flags_test.ts
import { loadActiveConfidenceBucketFlags, flagBucketIfNew, widenThresholdForFlags } from "./confidence-bucket-flags.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: boolean, msg = "expected false"): void {
  assert(!cond, msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- widenThresholdForFlags (pure) -----------------------------------------

Deno.test("widenThresholdForFlags: no flags at all leaves the threshold untouched", () => {
  assertEquals(widenThresholdForFlags(60, 55, []), 60);
});

Deno.test("widenThresholdForFlags: a score outside every flagged range is untouched", () => {
  assertEquals(widenThresholdForFlags(60, 90, [{ bucket_min: 40, bucket_max: 60 }]), 60);
});

Deno.test("widenThresholdForFlags: a score inside a flagged range is widened up to the bucket's top", () => {
  // Score 45 is in the flagged 40-60 range; the account's normal threshold
  // (30) is below the bucket's top (60), so it gets raised to 60 -- every
  // decision scored 40-59 now escalates, regardless of its own confidence.
  assertEquals(widenThresholdForFlags(30, 45, [{ bucket_min: 40, bucket_max: 60 }]), 60);
});

Deno.test("widenThresholdForFlags: never narrows below the account's own already-higher threshold", () => {
  // The account's normal threshold (70) is already stricter than the
  // flagged bucket's top (60) -- widening must never LOWER it.
  assertEquals(widenThresholdForFlags(70, 45, [{ bucket_min: 40, bucket_max: 60 }]), 70);
});

Deno.test("widenThresholdForFlags: the widened result is capped at 100", () => {
  assertEquals(widenThresholdForFlags(90, 85, [{ bucket_min: 80, bucket_max: 101 }]), 100);
});

Deno.test("widenThresholdForFlags: multiple flags each apply independently -- the highest-applicable wins", () => {
  const flags = [{ bucket_min: 20, bucket_max: 40 }, { bucket_min: 40, bucket_max: 60 }];
  assertEquals(widenThresholdForFlags(10, 45, flags), 60);
  assertEquals(widenThresholdForFlags(10, 25, flags), 40);
});

// ---- loadActiveConfidenceBucketFlags / flagBucketIfNew (DB-backed) ---------

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  insert(_row?: unknown) { return this; }
  maybeSingle() { return this; }
  // deno-lint-ignore no-explicit-any
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function fakeSupabase(tables: Record<string, Row> = {}) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      return {
        select() { return new FakeQuery(() => tables[table] ?? { data: null, error: null }); },
        eq() { return this; },
        is() { return this; },
        maybeSingle() { return new FakeQuery(() => tables[table] ?? { data: null, error: null }); },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return new FakeQuery(() => ({ data: null, error: null }));
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, inserted };
}

Deno.test("loadActiveConfidenceBucketFlags: returns the configured rows", async () => {
  const { client } = fakeSupabase({
    confidence_bucket_flags: { data: [{ bucket_min: 40, bucket_max: 60 }], error: null },
  });
  const flags = await loadActiveConfidenceBucketFlags(client, "user-1");
  assertEquals(flags, [{ bucket_min: 40, bucket_max: 60 }]);
});

Deno.test("loadActiveConfidenceBucketFlags: a query failure returns an empty list, never throws", async () => {
  const client = { from() { throw new Error("boom"); } };
  // deno-lint-ignore no-explicit-any
  const flags = await loadActiveConfidenceBucketFlags(client as any, "user-1");
  assertEquals(flags, []);
});

Deno.test("flagBucketIfNew: inserts a new flag when none is active for this bucket", async () => {
  const { client, inserted } = fakeSupabase({
    confidence_bucket_flags: { data: null, error: null },
  });
  const created = await flagBucketIfNew(client, "user-1", 40, 60, "incident-1");
  assert(created);
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].bucket_min, 40);
  assertEquals(inserted[0].incident_id, "incident-1");
});

Deno.test("flagBucketIfNew: does NOT insert a duplicate when this bucket already has an active flag", async () => {
  const { client, inserted } = fakeSupabase({
    confidence_bucket_flags: { data: { id: "existing-flag" }, error: null },
  });
  const created = await flagBucketIfNew(client, "user-1", 40, 60, "incident-2");
  assertFalse(created);
  assertEquals(inserted.length, 0);
});

// ---- item 5: per-api-key flags ----

Deno.test("flagBucketIfNew: omitting apiKeyId flags the account-wide bucket, api_key_id null", async () => {
  const { client, inserted } = fakeSupabase({ confidence_bucket_flags: { data: null, error: null } });
  await flagBucketIfNew(client, "user-1", 40, 60, "incident-1");
  assertEquals(inserted[0].api_key_id, null);
});

Deno.test("flagBucketIfNew: a real apiKeyId flags that key specifically, not the account-wide bucket", async () => {
  const { client, inserted } = fakeSupabase({ confidence_bucket_flags: { data: null, error: null } });
  const created = await flagBucketIfNew(client, "user-1", 40, 60, "incident-1", "key-1");
  assert(created);
  assertEquals(inserted[0].api_key_id, "key-1");
});
