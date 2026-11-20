// Run with: deno test --no-check supabase/functions/_shared/projects-try-rule_test.ts
// Inner Control "Try it first" (Day 2, #169): an account text rule is replayed on the account's recent tool replies, with no project
// and nothing written.
import { handleProjectsAction } from "./projects.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const STEPS = [
  { session_id: "s1", reply_text: "Our price is 40 euros, with a discount for students.", created_at: "2026-11-19T10:00:00Z" },
  { session_id: "s2", reply_text: "We open at 9 on weekdays.", created_at: "2026-11-19T09:00:00Z" },
  { session_id: "s1", reply_text: "", created_at: "2026-11-19T08:00:00Z" },
];
function fakeAdmin() {
  const writes: string[] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "in", "is", "maybeSingle"]) q[m] = () => q;
    for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => { writes.push(table); return q; };
    const data = table === "outer_control_session_steps" ? STEPS
      : table === "outer_control_sessions" ? [{ id: "s1", tool_id: "t1" }, { id: "s2", tool_id: "t2" }]
      : table === "external_tools" ? [{ id: "t1", name: "Groq" }, { id: "t2", name: "ChatGPT" }] : [];
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
    return q;
  };
  return { admin: { from, rpc: async () => ({ data: null, error: null }) }, writes };
}
const deps = { fetchUrl: async () => ({ ok: false, status: 0, contentType: "", text: "", finalUrl: "" }), checkUrl: async () => ({ ok: true, reason: "" }), notion: async () => ({ ok: false, status: 0, json: null, connected: false }), now: () => 0, key: null } as never;

Deno.test("try_rule: a pattern is replayed on recent replies, with no project and nothing written", async () => {
  const { admin, writes } = fakeAdmin();
  const r = await handleProjectsAction(admin as never, "acct", "u1", { action: "try_rule", pattern: "(?:discount|price)" }, deps);
  assert(r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  assert(r.body.checked === 2 && r.body.matched === 1, `checked ${r.body.checked}, matched ${r.body.matched}`);
  const hit = (r.body.hits as { tool: string; match: string; before: string }[])[0];
  assert(hit.tool === "Groq" && hit.match === "price" && hit.before === "Our ", JSON.stringify(hit));
  assert(writes.length === 0, `nothing is written: ${writes.join(",")}`);
});

Deno.test("try_rule: an empty, too long or broken pattern is refused with the reason", async () => {
  const { admin } = fakeAdmin();
  for (const pattern of ["", "x".repeat(2001), "(unclosed", ".*", "(a+)+$"]) {
    const r = await handleProjectsAction(admin as never, "acct", "u1", { action: "try_rule", pattern }, deps);
    assert(r.status === 400 && r.body.error === "invalid_pattern", `${pattern.slice(0, 10)}: ${JSON.stringify(r.body)}`);
  }
});

Deno.test("try_rule in plain words: the judge reads each recent reply and must quote it; nothing written; no judge is said", async () => {
  const { admin, writes } = fakeAdmin();
  const judge = async (p: { user: string }) => p.user.includes("discount") ? JSON.stringify({ violations: [{ rule: "R1", quote: "discount for students", why: "A price offer." }] }) : '{"violations":[]}';
  const r = await handleProjectsAction(admin as never, "acct", "u1", { action: "try_rule", kind: "meaning", description: "Never offer a discount", rule_action: "approval" }, { ...deps, judge } as never);
  assert(r.status === 200 && r.body.kind === "meaning" && r.body.rule_action === "approval", JSON.stringify(r.body));
  assert(r.body.checked === 2 && r.body.matched === 1, `checked ${r.body.checked}, matched ${r.body.matched}`);
  assert((r.body.hits as { match: string; tool: string }[])[0].match === "discount for students", JSON.stringify(r.body.hits));
  assert(writes.length === 0, "nothing is written");
  const none = await handleProjectsAction(admin as never, "acct", "u1", { action: "try_rule", kind: "meaning", description: "Never offer a discount" }, deps);
  assert(none.status === 503 && none.body.error === "ai_unavailable", JSON.stringify(none.body));
  const empty = await handleProjectsAction(admin as never, "acct", "u1", { action: "try_rule", kind: "meaning", description: "x" }, { ...deps, judge } as never);
  assert(empty.status === 400 && empty.body.error === "invalid_description", JSON.stringify(empty.body));
});
