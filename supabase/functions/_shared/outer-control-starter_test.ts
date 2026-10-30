import { askStarter, ensureStarterTools, isStarterUrl, STARTER_TASKS, STARTER_TOOLS, starterAllowed, starterTaskKeys, starterTasksUsed } from "./outer-control-starter.ts";

function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// A tiny in-memory stand-in for the two tables the starter tools touch.
function fakeAdmin(db: { external_tools: Record<string, unknown>[]; outer_control_sessions: Record<string, unknown>[] }) {
  let nextId = 1;
  return {
    from(table: "external_tools" | "outer_control_sessions") {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let head = false;
      let rows: Record<string, unknown>[] | null = null;
      const q: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
        like: (c: string, p: string) => { const pre = p.replace(/%$/, ""); filters.push((r) => String(r[c] ?? "").startsWith(pre)); return q; },
        insert: (list: Record<string, unknown>[]) => { rows = list.map((r) => ({ id: `t${nextId++}`, removed_at: null, ...r })); db[table].push(...rows); return q; },
        then: (res: (v: unknown) => unknown) => {
          const data = rows ?? db[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve(head ? { data: null, count: data.length, error: null } : { data, error: null }).then(res);
        },
      };
      return q;
    },
  };
}

Deno.test("starter tools: internal addresses, three angles, created once", async () => {
  const db = { external_tools: [] as Record<string, unknown>[], outer_control_sessions: [] as Record<string, unknown>[] };
  const admin = fakeAdmin(db);
  const first = await ensureStarterTools(admin, "acct", 20);
  assert(first.ok);
  assertEquals(first.tools.map((t) => t.name), STARTER_TOOLS.map((t) => t.name));
  assert(db.external_tools.every((t) => isStarterUrl(t.endpoint_url) && t.approved_at && t.user_id === "acct"));
  const again = await ensureStarterTools(admin, "acct", 20);
  assert(again.ok);
  assertEquals(db.external_tools.length, 3);
  assertEquals(again.tools.map((t) => t.id), first.tools.map((t) => t.id));
  assert(!isStarterUrl("https://api.openai.com/v1/chat/completions") && !isStarterUrl("nazai-internal://report"));
});

Deno.test("starter tools respect the tool limit of the account", async () => {
  const db = { external_tools: Array.from({ length: 19 }, (_, i) => ({ id: `x${i}`, user_id: "acct", endpoint_url: "https://e.example", removed_at: null })), outer_control_sessions: [] };
  const r = await ensureStarterTools(fakeAdmin(db), "acct", 20);
  assert(!r.ok);
  assertEquals(r.code, "too_many_tools");
});

Deno.test("a Task is counted once, oldest first, whether it asked one starter tool or three", () => {
  const keys = starterTaskKeys([
    { id: "s3", workflow_id: "w2", started_at: "2026-10-30T10:05:00Z" },
    { id: "s1", workflow_id: "w1", started_at: "2026-10-30T10:00:00Z" },
    { id: "s2", workflow_id: "w1", started_at: "2026-10-30T10:00:01Z" },
    { id: "s4", workflow_id: null, started_at: "2026-10-30T10:06:00Z" },
  ]);
  assertEquals(keys, ["w1", "w2", "s4"]);
});

Deno.test(`only the first ${STARTER_TASKS} Tasks may ask the starter tools; later ones are refused`, async () => {
  const db = { external_tools: [{ id: "st1", user_id: "acct", endpoint_url: "nazai-internal://starter/writer" }], outer_control_sessions: [] as Record<string, unknown>[] };
  const admin = fakeAdmin(db);
  const add = (id: string, wf: string, at: string) => db.outer_control_sessions.push({ id, user_id: "acct", tool_id: "st1", workflow_id: wf, started_at: at });
  add("a1", "w1", "2026-10-30T10:00:00Z"); add("a2", "w1", "2026-10-30T10:00:01Z");
  add("b1", "w2", "2026-10-30T10:10:00Z");
  add("c1", "w3", "2026-10-30T10:20:00Z");
  assert(await starterAllowed(admin, { id: "a2", user_id: "acct", workflow_id: "w1" }));
  assert(await starterAllowed(admin, { id: "b1", user_id: "acct", workflow_id: "w2" }));
  assert(!(await starterAllowed(admin, { id: "c1", user_id: "acct", workflow_id: "w3" })));
  assertEquals(await starterTasksUsed(admin, "acct"), STARTER_TASKS);
  // Another account's sessions never count, and an account without starter tools may not use them.
  assert(!(await starterAllowed(admin, { id: "z1", user_id: "other", workflow_id: "w9" })));
  assertEquals(await starterTasksUsed(admin, "other"), 0);
});

Deno.test("each starter tool answers from its own angle; an unknown one or a missing AI gives no answer", async () => {
  const seen: string[] = [];
  const ai = async (system: string, user: string) => { seen.push(system); return `answer to: ${user}`; };
  assertEquals(await askStarter(ai, "nazai-internal://starter/reviewer", "Is a 4-day week a good idea?"), "answer to: Is a 4-day week a good idea?");
  assert(seen[0].includes("sceptical reviewer") && seen[0].includes("Follow every rule"));
  assertEquals(await askStarter(ai, "nazai-internal://starter/unknown", "x"), null);
  assertEquals(await askStarter(async () => null, "nazai-internal://starter/writer", "x"), null);
});
