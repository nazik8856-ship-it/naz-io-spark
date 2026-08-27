// Real tests for sendCriticalAlert's durable-record guarantee: every alert
// must be persisted to critical_alerts regardless of whether Slack delivery
// succeeds, fails, or isn't configured at all — Slack was previously the
// only channel, and a disconnected/broken Slack integration meant the alert
// could vanish into container logs nobody watches.
//
// Run with: deno test --allow-env supabase/functions/_shared/critical-alerts_test.ts
import { sendCriticalAlert, LABELS, type CriticalAlertEvent } from "./critical-alerts.ts";

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
  insert(_row?: unknown) { return this; }
  maybeSingle() { return this; }
  single() { return this; }
  // deno-lint-ignore no-explicit-any
  then<TResult1 = Row, TResult2 = never>(
    onfulfilled?: ((value: Row) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    // deno-lint-ignore no-explicit-any
  ): any {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

/** Records every insert into critical_alerts (and incidents) so tests can assert on it. */
function fakeSupabase(opts: { slackConnected: boolean }) {
  const inserted: Record<string, unknown>[] = [];
  const incidents: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === "agent_integrations") {
        return new FakeQuery(() =>
          opts.slackConnected
            ? { data: { provider: "slack", metadata: { default_channel: "#alerts" } }, error: null }
            : { data: null, error: null }
        );
      }
      if (table === "critical_alerts") {
        return {
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return new FakeQuery(() => ({ data: { id: `alert-${inserted.length}` }, error: null }));
          },
        };
      }
      if (table === "incidents") {
        return {
          insert(row: Record<string, unknown>) {
            incidents.push(row);
            return new FakeQuery(() => ({ data: null, error: null }));
          },
        };
      }
      // slackPostMessage's own internal reads/writes (agent_integrations already
      // handled above; anything else it touches just gets an empty row).
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { client, inserted, incidents };
}

Deno.test("no Slack connected: alert is still persisted to critical_alerts, delivered_via=log", async () => {
  const { client, inserted } = fakeSupabase({ slackConnected: false });
  const via = await sendCriticalAlert(client, "user-1", {
    event: "kill_switch_on",
    summary: "Kill switch flipped on.",
  });
  assertEquals(via, "log");
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].delivered_via, "log");
  assertEquals(inserted[0].event, "kill_switch_on");
  assertEquals(inserted[0].user_id, "user-1");
});

Deno.test("every known CriticalAlertEvent has a real, non-empty label", () => {
  // LABELS is keyed by a string union, so a missing entry is only ever a
  // silent runtime `undefined`, never a compile error — exactly how
  // "gate_error" briefly rendered as "*undefined*" in the alert text until
  // this list caught up with the union in the same file. Listed by hand
  // since TS union members aren't introspectable at runtime; add any new
  // event here when adding it to the union.
  const knownEvents: CriticalAlertEvent[] = [
    "kill_switch_on", "kill_switch_off", "kill_switch_auto",
    "hard_rule_block", "circuit_breaker_trip", "self_audit_regression",
    "gate_error", "gate_error_fail_open", "approval_escalated", "confidence_miscalibrated",
    "break_glass_override", "correlated_breaker_trip", "audit_integrity_failure",
    "webhook_delivery_exhausted", "integration_revoked", "control_api_abuse", "auto_resolution_share_spike",
    "precedent_pipeline_stale",
  ];
  for (const event of knownEvents) {
    assert(typeof LABELS[event] === "string" && LABELS[event].length > 0, `missing/empty label for "${event}"`);
  }
});

Deno.test("an incident-worthy event (circuit_breaker_trip) opens an incident linked to the alert", async () => {
  const { client, incidents } = fakeSupabase({ slackConnected: false });
  await sendCriticalAlert(client, "user-1", { event: "circuit_breaker_trip", summary: "tripped", actionType: "send_email" });
  assertEquals(incidents.length, 1);
  assertEquals(incidents[0].kind, "circuit_breaker_trip");
  assertEquals(incidents[0].alert_id, "alert-1");
});

Deno.test("a confidence_miscalibrated event opens an incident linked to the alert", async () => {
  const { client, incidents } = fakeSupabase({ slackConnected: false });
  await sendCriticalAlert(client, "user-1", { event: "confidence_miscalibrated", summary: "overconfident" });
  assertEquals(incidents.length, 1);
  assertEquals(incidents[0].kind, "confidence_miscalibrated");
  assertEquals(incidents[0].alert_id, "alert-1");
});

Deno.test("a break_glass_override event opens an incident linked to the alert (2026-08-23)", async () => {
  const { client, incidents } = fakeSupabase({ slackConnected: false });
  await sendCriticalAlert(client, "user-1", {
    event: "break_glass_override", summary: "overridden", actionType: "send_email", provider: "Gmail",
  });
  assertEquals(incidents.length, 1);
  assertEquals(incidents[0].kind, "break_glass_override");
  assertEquals(incidents[0].alert_id, "alert-1");
});

Deno.test("a deliberate kill_switch_on event does NOT open an incident", async () => {
  const { client, incidents } = fakeSupabase({ slackConnected: false });
  await sendCriticalAlert(client, "user-1", { event: "kill_switch_on", summary: "on" });
  assertEquals(incidents.length, 0);
});

Deno.test("a routine hard_rule_block event does NOT open an incident", async () => {
  const { client, incidents } = fakeSupabase({ slackConnected: false });
  await sendCriticalAlert(client, "user-1", { event: "hard_rule_block", summary: "blocked" });
  assertEquals(incidents.length, 0);
});

Deno.test("a thrown error persisting the alert never throws out of sendCriticalAlert", async () => {
  const client = {
    from(table: string) {
      if (table === "critical_alerts") {
        return { insert() { return new FakeQuery(() => { throw new Error("db down"); }); } };
      }
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  const via = await sendCriticalAlert(client, "user-1", { event: "circuit_breaker_trip", summary: "tripped" });
  assertEquals(via, "log");
});
