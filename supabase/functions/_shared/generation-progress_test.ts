// Real tests for GAP 8's generation-progress reporter (compile-*-manifest's
// real phase checkpoints, polled by GeneratorHome.tsx instead of its old
// fake timer).
//
// Run with: deno test --allow-none supabase/functions/_shared/generation-progress_test.ts
import { reportProgress } from "./generation-progress.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("reportProgress: upserts the stage keyed by request_id when both ids are present", async () => {
  let upserted: Record<string, unknown> | null = null;
  let conflictTarget: string | null = null;
  const admin = {
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => {
        upserted = row;
        conflictTarget = opts.onConflict;
        return Promise.resolve({ error: null });
      },
    }),
  };
  await reportProgress(admin as never, "req-1", "user-1", "generating");
  assert(upserted !== null);
  const row = upserted as unknown as Record<string, unknown>;
  assertEquals(row.request_id, "req-1");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.stage, "generating");
  assertEquals(conflictTarget, "request_id");
});

Deno.test("reportProgress: a missing requestId is a silent no-op (no admin call at all)", async () => {
  let called = false;
  const admin = { from: () => { called = true; return { upsert: () => Promise.resolve({ error: null }) }; } };
  await reportProgress(admin as never, null, "user-1", "generating");
  assert(!called, "no requestId means no generation to report progress for");
});

Deno.test("reportProgress: a missing userId is a silent no-op (RLS would reject it anyway)", async () => {
  let called = false;
  const admin = { from: () => { called = true; return { upsert: () => Promise.resolve({ error: null }) }; } };
  await reportProgress(admin as never, "req-1", undefined, "generating");
  assert(!called);
});

Deno.test("reportProgress: a thrown write error never propagates (progress reporting is best-effort)", async () => {
  const admin = { from: () => ({ upsert: () => { throw new Error("db down"); } }) };
  await reportProgress(admin as never, "req-1", "user-1", "generating");
});
