// Real tests for outbound webhook delivery + logging.
//
// Run with: deno test --allow-net --allow-env supabase/functions/_shared/webhooks_test.ts
import { triggerWebhooks, buildSignaturePayload, WEBHOOK_EVENTS, handleWebhookDeliveryOutcome } from "./webhooks.ts";
import { MAX_ATTEMPTS } from "./webhook-retry.ts";

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

Deno.test("WEBHOOK_EVENTS has the 5 documented event kinds", () => {
  assertEquals([...WEBHOOK_EVENTS].sort(), ["approval_created", "approval_escalated", "decision_logged", "incident_opened", "incident_resolved"]);
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
    assertEquals(deliveries[0].attempt, 1);
    // A successful delivery is never scheduled for retry.
    assertEquals(deliveries[0].next_retry_at, null);
    const payload = deliveries[0].payload as { event: string; data: unknown };
    assertEquals(payload.event, "incident_opened");
    assertEquals(payload.data, { incident_id: "i1" });

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
    assertEquals(deliveries[0].attempt, 1);
    // A failed first attempt is eligible for retry, so next_retry_at must be set.
    assert(typeof deliveries[0].next_retry_at === "string", "expected a scheduled retry time");
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

// ---- handleWebhookDeliveryOutcome (dead-letter alerting) -------------------
// alerted_at lives on the webhook itself (not the delivery row) so a
// permanently-broken endpoint doesn't re-alert for every fresh event chain
// that independently exhausts against it.

function fakeAlertingSupabase() {
  const webhookUpdates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown[]> = {};
  const generic = () => ({
    select() { return this; },
    eq() { return this; },
    insert(row?: unknown) { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(onfulfilled: (v: { data: null; error: null }) => unknown) { return Promise.resolve({ data: null, error: null }).then(onfulfilled); },
  });
  const client = {
    from(table: string) {
      if (table === "webhooks") {
        return {
          update(row: Record<string, unknown>) {
            webhookUpdates.push(row);
            return { eq() { return Promise.resolve({ data: null, error: null }); } };
          },
        };
      }
      const g = generic();
      // deno-lint-ignore no-explicit-any
      (g as any).insert = (row?: unknown) => { (inserts[table] ??= []).push(row); return g; };
      return g;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { client, webhookUpdates, inserts };
}

Deno.test("handleWebhookDeliveryOutcome: a successful delivery clears a previously-set alerted_at", async () => {
  const { client, webhookUpdates } = fakeAlertingSupabase();
  await handleWebhookDeliveryOutcome(client, "user-1", { id: "h1", url: "https://example.com", alerted_at: "2026-08-20T00:00:00Z" }, { ok: true, attempt: 1 });
  assertEquals(webhookUpdates.length, 1);
  assertEquals(webhookUpdates[0].alerted_at, null);
});

Deno.test("handleWebhookDeliveryOutcome: a successful delivery with no prior alert does nothing", async () => {
  const { client, webhookUpdates } = fakeAlertingSupabase();
  await handleWebhookDeliveryOutcome(client, "user-1", { id: "h1", url: "https://example.com", alerted_at: null }, { ok: true, attempt: 1 });
  assertEquals(webhookUpdates.length, 0);
});

Deno.test("handleWebhookDeliveryOutcome: a failed delivery under the max attempt count does not alert", async () => {
  const { client, webhookUpdates } = fakeAlertingSupabase();
  await handleWebhookDeliveryOutcome(client, "user-1", { id: "h1", url: "https://example.com", alerted_at: null }, { ok: false, attempt: 1 });
  assertEquals(webhookUpdates.length, 0);
});

Deno.test("handleWebhookDeliveryOutcome: exhausted retries fires a one-time alert and stamps alerted_at", async () => {
  const { client, webhookUpdates, inserts } = fakeAlertingSupabase();
  await handleWebhookDeliveryOutcome(client, "user-1", { id: "h1", url: "https://example.com", alerted_at: null }, { ok: false, attempt: MAX_ATTEMPTS });
  assertEquals(webhookUpdates.length, 1);
  assert(typeof webhookUpdates[0].alerted_at === "string", "expected alerted_at to be stamped");
  assertEquals((inserts.critical_alerts ?? []).length, 1, "expected the dead-letter alert to be recorded");
  assertEquals((inserts.incidents ?? []).length, 1, "webhook_delivery_exhausted is incident-worthy");
});

Deno.test("handleWebhookDeliveryOutcome: an already-alerted webhook does not alert again", async () => {
  const { client, webhookUpdates, inserts } = fakeAlertingSupabase();
  await handleWebhookDeliveryOutcome(client, "user-1", { id: "h1", url: "https://example.com", alerted_at: "2026-08-24T00:00:00Z" }, { ok: false, attempt: MAX_ATTEMPTS });
  assertEquals(webhookUpdates.length, 0, "must not alert a second time for the same still-dead endpoint");
  assertEquals((inserts.critical_alerts ?? []).length, 0);
});

Deno.test("triggerWebhooks never throws even if the webhooks table read itself fails", async () => {
  const client = {
    from() { return { select() { return { eq() { return { eq() { throw new Error("db down"); } }; } }; } }; },
    // deno-lint-ignore no-explicit-any
  } as any;
  await triggerWebhooks(client, "user-1", "incident_opened", {});
});
