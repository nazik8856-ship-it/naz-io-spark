import { askStarter, ensurePerspectiveTool, ensureStarterTools, isNazaiAiUrl, isStarterUrl, jobFor, PERSPECTIVE_TOOL_URL, STARTER_TASKS, STARTER_TOOLS, starterAllowed, starterTaskKeys, starterTasksUsed, taskCard, type StarterTask } from "./outer-control-starter.ts";
import { challengeInstruction } from "./outer-control-report.ts";

function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// A tiny in-memory stand-in for the two tables the starter tools touch.
function fakeAdmin(db: { external_tools: Record<string, unknown>[]; outer_control_sessions: Record<string, unknown>[] }) {
  let nextId = 1;
  return {
    from(table: "external_tools" | "outer_control_sessions") {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let head = false;
      let one = false;
      let patchWith: Record<string, unknown> | null = null;
      let rows: Record<string, unknown>[] | null = null;
      const q: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
        like: (c: string, p: string) => { const pre = p.replace(/%$/, ""); filters.push((r) => String(r[c] ?? "").startsWith(pre)); return q; },
        insert: (list: Record<string, unknown>[] | Record<string, unknown>) => { rows = (Array.isArray(list) ? list : [list]).map((r) => ({ id: `t${nextId++}`, removed_at: null, ...r })); db[table].push(...rows); return q; },
        update: (p: Record<string, unknown>) => { patchWith = p; return q; },
        single: () => { one = true; return q; },
        maybeSingle: () => { one = true; return q; },
        then: (res: (v: unknown) => unknown) => {
          const data = rows ?? db[table].filter((r) => filters.every((f) => f(r)));
          if (patchWith) for (const r of data) Object.assign(r, patchWith);
          return Promise.resolve(head ? { data: null, count: data.length, error: null } : { data: one ? data[0] ?? null : data, error: null }).then(res);
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

const task = (over: Partial<StarterTask> = {}): StarterTask => ({
  instruction: "Is a 4-day week a good idea?\n\nReply in JSON.", request: "Is a 4-day week a good idea?", situation: null,
  rules: [], kind: null, checks: [], ...over,
});

Deno.test("each starter tool answers from its own angle; an unknown one or a missing AI gives no answer", async () => {
  const seen: string[] = [];
  const ai = async (system: string, user: string) => { seen.push(system + "\n" + user); return `answered`; };
  const r = await askStarter(ai, "nazai-internal://starter/reviewer", task());
  assertEquals(r?.reply, "answered");
  assert(seen[0].endsWith("Is a 4-day week a good idea?\n\nReply in JSON."), "the step's instruction is passed on whole");
  assertEquals(r?.sharpened, null);
  assert(seen[0].includes("sceptical reviewer") && seen[0].includes("Follow every rule"), seen[0]);
  assertEquals(await askStarter(ai, "nazai-internal://starter/unknown", task()), null);
  assertEquals(await askStarter(async () => null, "nazai-internal://starter/writer", task()), null);
});

// Day 3 (#150): the task card every built-in call reads first.
Deno.test("the task card: goal, situation, rules in force and what useful means, before the step's own instruction", async () => {
  const seen: string[] = [];
  const ai = async (_s: string, user: string) => { seen.push(user); return "ok"; };
  await askStarter(ai, "nazai-internal://starter/writer", task({
    request: "How do I get my first 10 customers?", situation: "Who it is for: yoga teachers in Vienna\nMain limit: 200 EUR a month",
    rules: [{ name: "No discounts above 20%", action: "block" }, { name: "Competitor names", action: "remove_text" }], omittedRules: 2, kind: "research",
    instruction: "TOPIC: How do I get my first 10 customers?\n\nGive the key findings.",
  }));
  const u = seen[0];
  assert(u.startsWith("TASK CARD"), u.slice(0, 40));
  assert(u.includes("Goal: How do I get my first 10 customers?"), "goal");
  assert(u.includes("Situation:\nWho it is for: yoga teachers in Vienna\nMain limit: 200 EUR a month"), "situation");
  assert(u.includes("must stay clear of: No discounts above 20%; Competitor names (and 2 more)"), "rules, stated as what to stay within");
  assert(/A useful answer here is findings specific enough to act on/.test(u) && /nothing that would fit any business/.test(u), "useful");
  assert(u.indexOf("TASK CARD") < u.indexOf("TOPIC: How do I get"), "the card comes first, the instruction after it");
  const none = taskCard(task(), "Your job: x");
  assert(/Situation:\nNot given\. Open your answer with one line "Assumed situation: …"/.test(none), "no situation is said plainly");
  assert(/no secrets, card numbers or destructive wording/.test(none), "the built-in checks are always named");
});

// Day 3 (#153): three tools, three jobs, where they answer the same question.
Deno.test("distinct jobs: practical answer, priorities, challenge; the same job for format-bound actions; the challenger challenges", () => {
  const jobs = STARTER_TOOLS.map((t) => jobFor(t.key, { instruction: "Q", kind: "opinions" }));
  assert(/the practical answer/.test(jobs[0]) && /prioritise/.test(jobs[1]) && /challenge/.test(jobs[2]), jobs.join(" | "));
  assertEquals(new Set(jobs).size, 3);
  for (const k of ["rewrite", "roles", "explain", "draft"] as const) {
    assert(STARTER_TOOLS.every((t) => /do exactly what the request asks/.test(jobFor(t.key, { instruction: "Q", kind: k }))), k);
  }
  assert(/do exactly what the request asks/.test(jobFor("analyst", { instruction: "Q", kind: null })), "a session on its own");
  assert(/challenge the answers you are given/.test(jobFor("writer", { instruction: challengeInstruction("pricing"), kind: "research" })), "challenger");
});

// Day 3 (#152): a generic answer is rewritten once, inside the call, before NazAI checks it.
const GENERIC = "Focus on your niche and leverage existing tools to build relationships with your target audience. It is important to stay ahead of the market and maximize reach through a strong online presence. " +
  "Use best practices, gather valuable insights and continuously improve. Consider using social channels and engage with your audience regularly so that the business grows and the customers stay with you. " +
  "Over time this approach will help you understand what works, refine the offer and keep the momentum going as the company moves forward step by step.";
const SPECIFIC = "Assumed situation: a solo yoga teacher in Vienna with 200 EUR a month.\n1. This week, list 30 studios in Vienna's 7th district from Google Maps.\n" +
  "2. Email 10 a day for 3 days offering a free 45-minute trial class on a Sunday.\n3. Spend 60 EUR on one Instagram post aimed at Neubau and Mariahilf.\n" +
  "4. Charge 15 EUR a drop-in, or 120 EUR for 10 classes (estimate based on Vienna studio prices).\n5. After 2 weeks, ask the 3 most regular students for one referral each.";

Deno.test("anti-generic: a generic answer is rewritten once with the exact problems; the rewrite is what comes back", async () => {
  const calls: { system: string; user: string }[] = [];
  const ai = async (system: string, user: string) => {
    calls.push({ system, user });
    return calls.length === 1 ? JSON.stringify({ status: "done", answer: GENERIC }) : SPECIFIC;
  };
  const r = await askStarter(ai, "nazai-internal://starter/writer", task({ request: "How do I get my first 10 students?", kind: "opinions", checks: ["concrete"] }));
  assertEquals(calls.length, 2);
  assert(/make an answer specific to one person's situation/.test(calls[1].system) && /Do not invent facts/.test(calls[1].system), calls[1].system);
  assert(calls[1].user.startsWith("TASK CARD") && calls[1].user.includes("answer to improve") && /distinct concrete details/.test(calls[1].user), calls[1].user.slice(0, 400));
  assertEquals(JSON.parse(r!.reply), { status: "done", answer: SPECIFIC });
  assert(r!.sharpened?.improved === true && /only 0 distinct concrete details/.test(r!.sharpened.problems.join(" ")), JSON.stringify(r!.sharpened));
});

Deno.test("anti-generic: a specific answer, a question, an action without checks, or a failed rewrite leave the answer as it was", async () => {
  let n = 0;
  const once = (reply: string) => async () => { n++; return reply; };
  n = 0; const ok = await askStarter(once(SPECIFIC), "nazai-internal://starter/writer", task({ kind: "opinions", checks: ["concrete"] }));
  assertEquals([n, ok!.reply, ok!.sharpened], [1, SPECIFIC, null]);
  n = 0; const q = JSON.stringify({ status: "need_info", answer: "", question: "Which city?" });
  const asking = await askStarter(once(q), "nazai-internal://starter/writer", task({ kind: "opinions", checks: ["concrete"] }));
  assertEquals([n, asking!.reply], [1, q]);
  n = 0; const plain = await askStarter(once(GENERIC), "nazai-internal://starter/writer", task({ kind: "rewrite", checks: [] }));
  assertEquals([n, plain!.reply], [1, GENERIC]);
  let k = 0;
  const failing = async () => (++k === 1 ? GENERIC : null);
  const kept = await askStarter(failing, "nazai-internal://starter/writer", task({ kind: "opinions", checks: ["concrete"] }));
  assertEquals(kept!.reply, GENERIC);
  assertEquals(kept!.sharpened?.improved, false);
});

// The single-tool suggestion: NazAI's second perspective for one Task (never listed, no free-Task limit, same task card).
Deno.test("second perspective: one internal tool per account, created once, re-enabled, refused at the tool limit", async () => {
  const db = { external_tools: [] as Record<string, unknown>[], outer_control_sessions: [] as Record<string, unknown>[] };
  const admin = fakeAdmin(db);
  const a = await ensurePerspectiveTool(admin, "acct", 20);
  assert(a.ok);
  assertEquals(db.external_tools.length, 1);
  assert(db.external_tools[0].endpoint_url === PERSPECTIVE_TOOL_URL && db.external_tools[0].approved_at && db.external_tools[0].user_id === "acct");
  assert(isNazaiAiUrl(PERSPECTIVE_TOOL_URL) && !isStarterUrl(PERSPECTIVE_TOOL_URL), "answered by NazAI's AI, but not a free starter tool");
  db.external_tools[0].enabled = false;
  const b = await ensurePerspectiveTool(admin, "acct", 20);
  assert(b.ok && a.ok && b.id === a.id && db.external_tools[0].enabled === true && db.external_tools.length === 1, "the same row, switched back on");
  const full = { external_tools: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, user_id: "u2", endpoint_url: `https://t${i}.example.com`, removed_at: null })), outer_control_sessions: [] };
  const refused = await ensurePerspectiveTool(fakeAdmin(full), "u2", 20);
  assert(!refused.ok && refused.code === "too_many_tools", JSON.stringify(refused));
});

Deno.test("second perspective: an independent second answer, with the task card and the anti-generic pass", async () => {
  assert(/independent second answer/.test(jobFor("perspective", { instruction: "Q", kind: "opinions" })));
  assert(/do exactly what the request asks/.test(jobFor("perspective", { instruction: "Q", kind: "explain" })));
  const seen: { system: string; user: string }[] = [];
  const r = await askStarter(async (system, user) => { seen.push({ system, user }); return "ok"; }, PERSPECTIVE_TOOL_URL, task({ kind: "decision" }));
  assertEquals(r?.reply, "ok");
  assert(/independent second opinion/.test(seen[0].system) && seen[0].user.startsWith("TASK CARD"), seen[0].system);
});
