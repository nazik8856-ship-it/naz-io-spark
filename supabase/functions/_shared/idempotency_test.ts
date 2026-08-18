// Real tests for the idempotency-key claim/replay/release logic.
//
// Run with: deno test --allow-env supabase/functions/_shared/idempotency_test.ts
import { claimIdempotencyKey, saveIdempotencyResponse, releaseIdempotencyKey } from "./idempotency.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  insert(_row?: unknown) { return this; }
  update(_row?: unknown) { return this; }
  delete() { return this; }
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

/** In-memory fake table backing the idempotency_keys store for these tests. */
function fakeStore(initial?: { key: string; userId: string; response: unknown | null }) {
  const rows = new Map<string, { user_id: string; idempotency_key: string; response: unknown | null }>();
  if (initial) rows.set(`${initial.userId}:${initial.key}`, { user_id: initial.userId, idempotency_key: initial.key, response: initial.response });

  const client = {
    from(table: string) {
      if (table !== "idempotency_keys") return new FakeQuery(() => ({ data: null, error: null }));
      let filterUserId: string | undefined;
      let filterKey: string | undefined;
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      let pendingDelete = false;
      let requireNullResponse = false;
      const api = {
        select() { return api; },
        eq(col: string, val: string) {
          if (col === "user_id") filterUserId = val;
          if (col === "idempotency_key") filterKey = val;
          return api;
        },
        is(col: string, val: unknown) {
          if (col === "response" && val === null) requireNullResponse = true;
          return api;
        },
        insert(row: Record<string, unknown>) { pendingInsert = row; return api; },
        update(row: Record<string, unknown>) { pendingUpdate = row; return api; },
        delete() { pendingDelete = true; return api; },
        maybeSingle() { return api; },
        // deno-lint-ignore no-explicit-any
        then(onfulfilled?: any, onrejected?: any): any {
          const resolve = () => {
            if (pendingInsert) {
              const k = `${pendingInsert.user_id}:${pendingInsert.idempotency_key}`;
              if (rows.has(k)) return { data: null, error: { message: "duplicate key" } }; // unique violation
              rows.set(k, { user_id: pendingInsert.user_id as string, idempotency_key: pendingInsert.idempotency_key as string, response: null });
              return { data: { id: k }, error: null };
            }
            if (pendingUpdate) {
              const k = `${filterUserId}:${filterKey}`;
              const row = rows.get(k);
              if (row) row.response = pendingUpdate.response ?? null;
              return { data: null, error: null };
            }
            if (pendingDelete) {
              const k = `${filterUserId}:${filterKey}`;
              const row = rows.get(k);
              if (row && (!requireNullResponse || row.response === null)) rows.delete(k);
              return { data: null, error: null };
            }
            // plain select
            const k = `${filterUserId}:${filterKey}`;
            const row = rows.get(k);
            return { data: row ? { response: row.response } : null, error: null };
          };
          return Promise.resolve(resolve()).then(onfulfilled, onrejected);
        },
      };
      return api;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { client, rows };
}

Deno.test("a fresh key is claimed successfully", async () => {
  const { client } = fakeStore();
  const result = await claimIdempotencyKey(client, "user-1", "key-1");
  assertEquals(result, { status: "claimed" });
});

Deno.test("a key already claimed with no response yet reports in_progress", async () => {
  const { client } = fakeStore({ key: "key-1", userId: "user-1", response: null });
  const result = await claimIdempotencyKey(client, "user-1", "key-1");
  assertEquals(result, { status: "in_progress" });
});

Deno.test("a key with a saved response replays it instead of re-claiming", async () => {
  const cached = { decision: "allow", executed: true };
  const { client } = fakeStore({ key: "key-1", userId: "user-1", response: cached });
  const result = await claimIdempotencyKey(client, "user-1", "key-1");
  assertEquals(result, { status: "replay", response: cached });
});

Deno.test("different users with the same literal key string each get their own claim", async () => {
  const { client } = fakeStore({ key: "key-1", userId: "user-1", response: null });
  const result = await claimIdempotencyKey(client, "user-2", "key-1");
  assertEquals(result, { status: "claimed" });
});

Deno.test("saveIdempotencyResponse fills in the response for a claimed key", async () => {
  const { client, rows } = fakeStore({ key: "key-1", userId: "user-1", response: null });
  await saveIdempotencyResponse(client, "user-1", "key-1", { ok: true });
  assertEquals(rows.get("user-1:key-1")?.response, { ok: true });
});

Deno.test("releaseIdempotencyKey removes a claim that never got a response, freeing it for a real retry", async () => {
  const { client, rows } = fakeStore({ key: "key-1", userId: "user-1", response: null });
  await releaseIdempotencyKey(client, "user-1", "key-1");
  assert(!rows.has("user-1:key-1"));
  const result = await claimIdempotencyKey(client, "user-1", "key-1");
  assertEquals(result, { status: "claimed" });
});

Deno.test("releaseIdempotencyKey never removes a row that already holds a successful response", async () => {
  const cached = { ok: true };
  const { client, rows } = fakeStore({ key: "key-1", userId: "user-1", response: cached });
  await releaseIdempotencyKey(client, "user-1", "key-1");
  assertEquals(rows.get("user-1:key-1")?.response, cached);
});

Deno.test("claimIdempotencyKey never throws even if the underlying calls throw", async () => {
  const client = {
    from() {
      return {
        eq() { return this; },
        insert() { return this; },
        maybeSingle() { return this; },
        then() { throw new Error("db down"); },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const result = await claimIdempotencyKey(client, "user-1", "key-1");
  assertEquals(result, { status: "in_progress" });
});
