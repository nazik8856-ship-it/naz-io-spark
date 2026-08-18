// Real tests for incident classification + the best-effort incident insert.
//
// Run with: deno test --allow-env supabase/functions/_shared/incidents_test.ts
import { isIncidentWorthy, openIncident, INCIDENT_KINDS } from "./incidents.ts";
import type { CriticalAlertEvent } from "./critical-alerts.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("isIncidentWorthy: automatic/abnormal events open an incident", () => {
  for (const kind of INCIDENT_KINDS) {
    assert(isIncidentWorthy(kind), `${kind} should be incident-worthy`);
  }
});

Deno.test("isIncidentWorthy: deliberate human actions and routine enforcement are NOT incidents", () => {
  const notIncidents: CriticalAlertEvent[] = ["kill_switch_on", "kill_switch_off", "hard_rule_block"];
  for (const event of notIncidents) {
    assert(!isIncidentWorthy(event), `${event} should NOT be incident-worthy`);
  }
});

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
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

Deno.test("openIncident inserts a row scoped to the user with the right kind", async () => {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === "incidents") {
        return { insert(row: Record<string, unknown>) { inserted.push(row); return new FakeQuery(() => ({ data: null, error: null })); } };
      }
      return new FakeQuery(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  await openIncident(client, "user-1", { kind: "circuit_breaker_trip", summary: "tripped", actionType: "send_email", provider: "Gmail", alertId: "alert-1" });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].user_id, "user-1");
  assertEquals(inserted[0].kind, "circuit_breaker_trip");
  assertEquals(inserted[0].alert_id, "alert-1");
});

Deno.test("openIncident never throws even if the insert fails", async () => {
  const client = {
    from() { return { insert() { return new FakeQuery(() => { throw new Error("db down"); }); } }; },
    // deno-lint-ignore no-explicit-any
  } as any;
  await openIncident(client, "user-1", { kind: "gate_error", summary: "boom" });
});
