import { containmentDecision, CONTAINMENT_WINDOW_MS, countUnsafeSignals, SUSPEND_AFTER_HELD } from "./outer-control-containment.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

Deno.test("an outbound refusal suspends a tool at once; held replies need to repeat", () => {
  assertEquals(containmentDecision({ held: 0, blocked: 0 }).suspend, false);
  assertEquals(containmentDecision({ held: SUSPEND_AFTER_HELD - 1, blocked: 0 }).suspend, false);
  const held = containmentDecision({ held: SUSPEND_AFTER_HELD, blocked: 0 });
  assertEquals([held.suspend, held.trigger], [true, "content_held"]);
  const blocked = containmentDecision({ held: 0, blocked: 1 });
  assertEquals([blocked.suspend, blocked.trigger], [true, "outbound_blocked"]);
  assertEquals(containmentDecision({ held: 5, blocked: 1 }).trigger, "outbound_blocked", "the more serious signal names the reason");
});

Deno.test("signals are counted for one account and one tool, since the later of the window start and the last resume", async () => {
  const queries: Record<string, unknown>[] = [];
  const admin = {
    from: () => {
      const q: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { q[c] = v; return chain; },
        gte: (c: string, v: unknown) => { q[c] = v; queries.push({ ...q }); return Promise.resolve({ count: 2 }); },
      };
      return chain;
    },
  };
  const now = Date.parse("2026-11-10T12:00:00Z");
  const r = await countUnsafeSignals(admin, "u-1", "tool-1", now, null);
  assertEquals(r, { held: 2, blocked: 2 });
  assertEquals(queries.map((x) => x.kind), ["content_held", "outbound_blocked"]);
  assertEquals(queries[0].user_id, "u-1");
  assertEquals(queries[0]["subject->>tool"], "tool-1");
  assertEquals(queries[0].created_at, new Date(now - CONTAINMENT_WINDOW_MS).toISOString());
  await countUnsafeSignals(admin, "u-1", "tool-1", now, "2026-11-10T09:00:00Z");
  assertEquals(queries[2].created_at, "2026-11-10T09:00:00.000Z", "a resume starts the count over");
  await countUnsafeSignals(admin, "u-1", "tool-1", now, "2026-11-01T09:00:00Z");
  assertEquals(queries[4].created_at, new Date(now - CONTAINMENT_WINDOW_MS).toISOString(), "an old resume does not widen the window");
});
