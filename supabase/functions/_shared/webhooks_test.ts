// Real tests for outbound webhook delivery + logging.
//
// Run with: deno test --allow-net --allow-env supabase/functions/_shared/webhooks_test.ts
import { triggerWebhooks, buildSignaturePayload, WEBHOOK_EVENTS } from "./webhooks.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("buildSignaturePayload: joins timestamp and body with a dot, deterministically", () => {
  assertEquals(buildSignaturePayload("123", '{"a":1}'), '123.{"a":1}');
});

Deno.test("WEBHOOK_EVENTS has the 4 documented event kinds", () => {
  assertEquals([...WEBHOOK_EVENTS].sort(), ["approval_created", "approval_escalated", "incident_opened", "incident_resolved"]);
});

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  insert(_row?: unknown) { return this; }
  // deno-lint-ignore no-explicit-any
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function fakeSupabase(webhooks: Hook[]) {
  const deliveries: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === "webhooks") return new FakeQuery(() => ({ data: webhooks, error: null }));
      if (table === "webhook_deliveries") {
        return { insert(row: Record<string, unknown>) { deliveries.push(row); return new FakeQuery(() => ({ data: null, error: null })); } };
      }
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { client, deliveries };
}

type Hook = { id: string; url: string; secret: string; events: string[] };

Deno.test("no webhooks subscribed to this event: nothing delivered, nothing logged", async () => {
  const { client, deliveries } = fakeSupabase([{ id: "h1", url: "https://example.com/hook", secret: "s", events: ["incident_opened"] }]);
  await triggerWebhooks(client, "user-1", "approval_created", { foo: "bar" });
  assertEquals(deliveries.length, 0);
});

Deno.test("a subscribed webhook is delivered with signature headers and logged as ok", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;

  try {
    const { client, deliveries } = fakeSupabase([{ id: "h1", url: "https://example.com/hook", secret: "topsecret", events: ["incident_opened"] }]);
    await triggerWebhooks(client, "user-1", "incident_opened", { incident_id: "i1" });

    assertEquals(deliveries.length, 1);
    assertEquals(deliveries[0].ok, true);
    assertEquals(deliveries[0].status_code, 200);
    assertEquals(deliveries[0].webhook_id, "h1");

    const headers = capturedInit?.headers as Record<string, string>;
    assert(headers["X-NazAI-Event"] === "incident_opened");
    assert(typeof headers["X-NazAI-Signature"] === "string" && headers["X-NazAI-Signature"].length === 64, "expected a 64-char hex HMAC-SHA256 signature");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("a network failure delivering a webhook is logged as not-ok, never throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("connection refused"))) as typeof fetch;
  try {
    const { client, deliveries } = fakeSupabase([{ id: "h1", url: "https://example.com/hook", secret: "s", events: ["incident_opened"] }]);
    await triggerWebhooks(client, "user-1", "incident_opened", {});
    assertEquals(deliveries.length, 1);
    assertEquals(deliveries[0].ok, false);
    assert(typeof deliveries[0].error === "string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("a webhook not subscribed to this event is skipped even if other hooks exist", async () => {
  const { client, deliveries } = fakeSupabase([
    { id: "h1", url: "https://example.com/a", secret: "s", events: ["approval_created"] },
    { id: "h2", url: "https://example.com/b", secret: "s", events: ["incident_opened"] },
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("ok", { status: 200 }))) as typeof fetch;
  try {
    await triggerWebhooks(client, "user-1", "incident_opened", {});
    assertEquals(deliveries.length, 1);
    assertEquals(deliveries[0].webhook_id, "h2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("triggerWebhooks never throws even if the webhooks table read itself fails", async () => {
  const client = {
    from() { return { select() { return { eq() { return { eq() { throw new Error("db down"); } }; } }; } }; },
    // deno-lint-ignore no-explicit-any
  } as any;
  await triggerWebhooks(client, "user-1", "incident_opened", {});
});
