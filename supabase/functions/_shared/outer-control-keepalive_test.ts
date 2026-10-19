// Run with: deno test supabase/functions/_shared/outer-control-keepalive_test.ts
import { followUpContext, MAX_FOLLOW_UP_CHARS } from "./outer-control-workflow.ts";
import { KEEPALIVE_AFTER_MS, KEEPALIVE_BATCH, pickKeepAliveCandidates, recordConnectionTest, runKeepAlive, type KeepAliveTool } from "./outer-control-keepalive.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const NOW = Date.parse("2026-10-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const tool = (id: string, o: Partial<KeepAliveTool> = {}): KeepAliveTool => ({
  id, user_id: "u1", name: `Tool ${id}`, endpoint_url: "https://x.test/a", request_format: "openai_chat", model: null, auth_header: "Authorization",
  auth_scheme: "Bearer ", credentials_secret_id: null, last_ok_at: null, last_checked_at: null, created_at: daysAgo(60), ...o,
});

Deno.test("keep-alive: a tool checked less than 12 hours ago is left alone; an older or never-checked one is due", () => {
  const picked = pickKeepAliveCandidates([tool("fresh", { last_checked_at: hoursAgo(2) }), tool("old", { last_checked_at: hoursAgo(13) }), tool("never")], new Set(["fresh", "old", "never"]), NOW);
  assertEquals(picked.map((t) => t.id), ["never", "old"]);
});

Deno.test("keep-alive: only tools in use are tested: used in the last 30 days, or added in the last 30 days", () => {
  const tools = [tool("used", { created_at: daysAgo(90) }), tool("idle", { created_at: daysAgo(90) }), tool("new", { created_at: daysAgo(3) })];
  assertEquals(pickKeepAliveCandidates(tools, new Set(["used"]), NOW).map((t) => t.id).sort(), ["new", "used"]);
});

Deno.test("keep-alive: at most a few tests per run, the longest-unchecked first", () => {
  const tools = Array.from({ length: 9 }, (_, i) => tool(`t${i}`, { last_checked_at: hoursAgo(20 + i) }));
  const picked = pickKeepAliveCandidates(tools, new Set(tools.map((t) => t.id)), NOW);
  assertEquals(picked.length, KEEPALIVE_BATCH);
  assertEquals(picked[0].id, "t8");
});

Deno.test("keep-alive: a result is recorded on the tool; a failure keeps the last time it worked", async () => {
  const updates: unknown[] = [];
  const admin = { from: () => ({ update: (p: unknown) => ({ eq: () => { updates.push(p); return Promise.resolve({}); } }) }) };
  await recordConnectionTest(admin, { id: "t", last_ok_at: "2026-10-01T00:00:00.000Z" }, { ok: false, error: "The tool rejected the key (HTTP 401). Update the key and test again." }, NOW);
  await recordConnectionTest(admin, { id: "t", last_ok_at: null }, { ok: true, error: null }, NOW);
  assertEquals(updates[0], { last_checked_at: new Date(NOW).toISOString(), last_ok_at: "2026-10-01T00:00:00.000Z", last_error: "The tool rejected the key (HTTP 401). Update the key and test again." });
  assertEquals(updates[1], { last_checked_at: new Date(NOW).toISOString(), last_ok_at: new Date(NOW).toISOString(), last_error: null });
});

/** A fake database: the tools list, the sessions that used them, and every update written. */
function fakeAdmin(tools: KeepAliveTool[], used: string[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "or", "order", "limit", "in", "gte"]) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "external_tools" ? tools : used.map((tool_id) => ({ tool_id })) }).then(res);
      q.update = (patch: Record<string, unknown>) => ({ eq: (_c: string, id: string) => { updates.push({ id, patch }); return Promise.resolve({}); } });
      return q;
    },
  };
  return { admin, updates };
}

Deno.test("keep-alive run: tests the due tools, records each result, counts failures", async () => {
  const { admin, updates } = fakeAdmin([tool("a"), tool("b")], ["a", "b"]);
  const result = await runKeepAlive(admin, {
    now: () => NOW,
    test: (t) => Promise.resolve(t.id === "a" ? { ok: true, error: null, ms: 80, sample: "ok" } : { ok: false, error: "The tool rejected the key (HTTP 401). Update the key and test again.", ms: 90, sample: null }),
    gate: () => Promise.resolve(null),
  });
  assertEquals(result, { tested: 2, failed: 1, skipped: 0 });
  assertEquals(updates.map((u) => [u.id, u.patch.last_error]), [["a", null], ["b", "The tool rejected the key (HTTP 401). Update the key and test again."]]);
});

Deno.test("keep-alive run: a kill switch skips the tool untouched; a contact rule records a failed check without sending anything", async () => {
  const { admin, updates } = fakeAdmin([tool("a"), tool("b")], ["a", "b"]);
  let sent = 0;
  const result = await runKeepAlive(admin, {
    now: () => NOW,
    test: () => { sent++; return Promise.resolve({ ok: true, error: null, ms: 1, sample: "ok" }); },
    gate: (t) => Promise.resolve(t.id === "a" ? "skip" : "A rule forbids contacting this tool."),
  });
  assertEquals(result, { tested: 1, failed: 1, skipped: 1 });
  assertEquals(sent, 0, "nothing is sent to a tool a kill switch or a contact rule forbids");
  assertEquals(updates.map((u) => u.id), ["b"]);
});

Deno.test("keep-alive run: nothing due means no tests and no writes", async () => {
  const { admin, updates } = fakeAdmin([], []);
  const result = await runKeepAlive(admin, { now: () => NOW, test: () => Promise.reject(new Error("must not run")), gate: () => Promise.resolve(null) });
  assertEquals(result, { tested: 0, failed: 0, skipped: 0 });
  assertEquals(updates.length, 0);
  assert(KEEPALIVE_AFTER_MS === 12 * 3_600_000, "twelve hours");
});

Deno.test("follow-up context: carries the earlier question and the controlled answer, shortens a very long one", () => {
  const c = followUpContext({ objective: "Describe NazAI in one sentence", answer: "NazAI controls what AI may do.", toolName: "Bot2" });
  assert(c.includes("Earlier in this conversation with Bot2."), "names the tool");
  assert(c.includes("The question was: Describe NazAI in one sentence"), "carries the question");
  assert(c.includes("NazAI controls what AI may do."), "carries the controlled answer");
  const long = followUpContext({ objective: "q", answer: "x".repeat(MAX_FOLLOW_UP_CHARS + 500), toolName: "Bot2" });
  assert(long.includes("[Earlier answer shortened.]") && !long.includes("x".repeat(MAX_FOLLOW_UP_CHARS + 1)), "shortened");
});
