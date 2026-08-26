// Real tests for the "callback" on_uncertain policy's notify-and-wait
// orchestration. Uses real (short) timeouts -- these tests take a couple
// of real seconds to run, which is expected for something that
// deliberately polls on a wall clock.
//
// Run with: deno test --allow-none supabase/functions/_shared/callback-delegation_test.ts
import { notifyAndAwaitCallback } from "./callback-delegation.ts";

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
  is(_col: string, _val: unknown) { return this; }
  update(_row?: unknown) { return this; }
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

const config = { url: "https://caller.example/callback", secret: "s3cr3t", timeoutSeconds: 1, fallback: "auto_deny" as const };

Deno.test("notifyAndAwaitCallback: a status that's already resolved by the next poll is picked up, not overridden by the fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const client = {
      from(table: string) {
        assertEquals(table, "pending_approvals");
        return new FakeQuery(() => ({ data: { status: "approved" }, error: null }));
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    const outcome = await notifyAndAwaitCallback(client, "approval-1", config, { action_type: "send_email" });
    assertEquals(outcome, { resolution: "approved" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("notifyAndAwaitCallback: no answer within the window falls back to callback_fallback (auto_deny -> rejected)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const updates: Record<string, unknown>[] = [];
    const client = {
      from(_table: string) {
        return {
          select() { return new FakeQuery(() => ({ data: { status: "pending" }, error: null })); },
          update(row: Record<string, unknown>) {
            updates.push(row);
            return new FakeQuery(() => ({ data: { id: "approval-1" }, error: null }));
          },
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    const outcome = await notifyAndAwaitCallback(client, "approval-1", config, { action_type: "send_email" });
    assertEquals(outcome, { resolution: "rejected" });
    // updates[0] is claimRowOnce's own resolved_at claim -- the decorate
    // call (setting status/comment) is the one after it.
    assertEquals(updates[1]?.status, "auto_rejected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("notifyAndAwaitCallback: callback_fallback auto_allow resolves to approved on timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const client = {
      from(_table: string) {
        return {
          select() { return new FakeQuery(() => ({ data: { status: "pending" }, error: null })); },
          update(_row: Record<string, unknown>) { return new FakeQuery(() => ({ data: { id: "approval-1" }, error: null })); },
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    const outcome = await notifyAndAwaitCallback(client, "approval-1", { ...config, fallback: "auto_allow" }, {});
    assertEquals(outcome, { resolution: "approved" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("notifyAndAwaitCallback: never throws even if the notification fetch itself fails -- still polls and falls back", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const client = {
      from(_table: string) {
        return {
          select() { return new FakeQuery(() => ({ data: { status: "pending" }, error: null })); },
          update(_row: Record<string, unknown>) { return new FakeQuery(() => ({ data: { id: "approval-1" }, error: null })); },
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    const outcome = await notifyAndAwaitCallback(client, "approval-1", config, {});
    assertEquals(outcome, { resolution: "rejected" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
