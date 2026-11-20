// Run with: deno test --no-check supabase/functions/_shared/meaning-account_test.ts
// Inner Control Day 3 (#171): rules in plain words for the whole account. They are checked inside the one shared reply review
// (evaluateExternalText), so every path that passes `meaning` applies them: the Outer Control API, the relay, an agent's
// http_post, the chat's "check this text" and a Task's replies. A shadow rule only logs. At most 10 go to the judge, the
// account's first.
import { applyMeaning, MAX_MEANING_RULES, orderMeaningRows, type MeaningRule } from "./meaning-judge.ts";
import { evaluateExternalText } from "./outer-control-text-review.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const reply = "Thanks! Your parcel will arrive on Friday. Call us anytime.";
const base = { verdict: "allow" as const, output: reply, matches: [], changes: [], summary: "Allowed." };
const rule = (id: string, action: MeaningRule["action"], shadow = false): MeaningRule => ({ id, name: `Rule ${id}`, description: "Promising a delivery date", action, shadow });
const judgeSays = (...rules: string[]) => async () => JSON.stringify({ violations: rules.map((r) => ({ rule: r, quote: "will arrive on Friday", why: "A promise." })) });

Deno.test("a live rule makes the decision stricter; a shadow rule's finding is only logged", async () => {
  const live = await applyMeaning(judgeSays("R1"), [rule("a", "block")], reply, base);
  assertEquals(live.foundation.verdict, "block");
  assertEquals(live.shadow.length, 0);
  const shadow = await applyMeaning(judgeSays("R1"), [rule("a", "block", true)], reply, base);
  assertEquals(shadow.foundation, base, "a shadow rule never changes the decision");
  assertEquals(shadow.shadow.map((m) => [m.rule_id, m.sample]), [["meaning:a", "will arrive on Friday"]]);
  assertEquals(shadow.record?.findings[0].shadow, true);
});

Deno.test("no judge: a person decides only when a live rule went unchecked; an already blocked reply is not judged", async () => {
  assertEquals((await applyMeaning(null, [rule("a", "block")], reply, base)).foundation.verdict, "escalate");
  assertEquals((await applyMeaning(null, [rule("a", "block", true)], reply, base)).foundation.verdict, "allow");
  let called = false;
  const blocked = await applyMeaning(async () => { called = true; return "{}"; }, [rule("a", "block")], reply, { ...base, verdict: "block", output: null });
  assert(!called && blocked.record === null, "a blocked reply is not sent to the judge");
});

Deno.test("the cap keeps the account's rules first, then the project's, oldest first; other projects never apply", () => {
  const row = (id: string, project_id: string | null, created_at: string) => ({ id, name: id, description: "x", action: "block" as const, project_id, created_at });
  const rows = [row("p2", "P", "2026-01-02"), row("a2", null, "2026-01-05"), row("x1", "OTHER", "2026-01-01"), row("p1", "P", "2026-01-01"), row("a1", null, "2026-01-03")];
  assertEquals(orderMeaningRows(rows, "P").map((r) => r.id), ["a1", "a2", "p1", "p2"]);
  assertEquals(orderMeaningRows(rows, null).map((r) => r.id), ["a1", "a2"]);
  assertEquals(MAX_MEANING_RULES, 10);
});

// ---- the shared review, end to end on a fake database
function fakeAdmin(meaningRows: Record<string, unknown>[]) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const queried: string[] = [];
  const from = (table: string) => {
    queried.push(table);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "or", "order", "limit", "gte", "lte", "not", "neq", "filter", "contains"]) q[m] = () => q;
    let inserted: Record<string, unknown> | null = null;
    q.insert = (row: Record<string, unknown>) => { inserted = row; inserts.push({ table, row }); return q; };
    q.update = () => q;
    q.upsert = () => q;
    q.maybeSingle = async () => ({ data: inserted ? { id: `${table}-1`, created_at: "2026-11-20T10:00:00Z" } : null, error: null });
    q.single = q.maybeSingle;
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: inserted ? [{ id: `${table}-1` }] : table === "meaning_rules" ? meaningRows : [], error: null, count: 0 }).then(res);
    return q;
  };
  return { admin: { from, rpc: async () => ({ data: null, error: null }) }, inserts, queried };
}
const params = { userId: "acct", agentId: null, apiKeyId: null, isTest: false, sourceModel: "tool:Groq", content: reply, origin: "external-api" as const };
const accountRule = { id: "m1", name: "No delivery promises", description: "Promising a delivery date", action: "block", project_id: null, shadow_mode: false, created_at: "2026-11-01" };

Deno.test("the shared review applies the account's rule in plain words and records the stricter verdict", async () => {
  const { admin, inserts } = fakeAdmin([accountRule]);
  const r = await evaluateExternalText(admin as never, { ...params, meaning: { ai: judgeSays("R1") } });
  assertEquals([r.verdict, r.nextStep, r.output], ["block", "discard", null]);
  assertEquals(r.matches.map((m) => m.rule_id), ["meaning:m1"]);
  assertEquals(r.meaning?.findings.map((f) => f.rule), ["No delivery promises"]);
  const evaluation = inserts.find((i) => i.table === "outer_control_evaluations")?.row;
  assertEquals(evaluation?.verdict, "block", "the stored evaluation has the meaning verdict");
  assert(inserts.some((i) => i.table === "agent_decisions" && String(i.row.decision).startsWith("BLOCK")), "the decision log has it too");
});

Deno.test("without `meaning` (a fixed self-test) no rule in plain words is loaded or judged", async () => {
  const { admin, queried } = fakeAdmin([accountRule]);
  const r = await evaluateExternalText(admin as never, params);
  assertEquals(r.verdict, "allow");
  assert(!queried.includes("meaning_rules"), "not loaded");
});

Deno.test("a shadow rule in the shared review: allowed, with the finding among the shadow matches", async () => {
  const { admin } = fakeAdmin([{ ...accountRule, shadow_mode: true }]);
  const r = await evaluateExternalText(admin as never, { ...params, meaning: { ai: judgeSays("R1") } });
  assertEquals(r.verdict, "allow");
  assertEquals(r.shadowMatches.map((m) => m.rule_id), ["meaning:m1"]);
});
