// Goal Tasks: the real engine against the in-memory database, a scripted outside tool and a scripted checking/planning AI.
import assert from "node:assert/strict";
const H = await import("./out-session.mjs");

type Call = { url: string; body: any };
let calls: Call[] = [];
let script: (n: number, body: any, url: string) => { status?: number; json?: any } = () => ({ json: { status: "done", answer: "ok" } });
const fetchImpl = async (url: any, init: any) => {
  const body = JSON.parse(init.body); calls.push({ url: String(url), body });
  const r = script(calls.length, body, String(url));
  return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
};
// The AI is scripted per kind of call: "judge" checks the criteria, "plan" writes the next question.
let aiCalls: { kind: "judge" | "plan"; user: string }[] = [];
let judgeReplies: (string | null)[] = [];
let planReplies: (string | null)[] = [];
const ai = async (p: { system: string; user: string }) => {
  const kind = p.system.includes("check whether the results") ? "judge" : "plan";
  aiCalls.push({ kind, user: p.user });
  return (kind === "judge" ? judgeReplies : planReplies).shift() ?? null;
};
const deps = { fetchImpl: fetchImpl as any, now: () => Date.now(), sleep: async () => {}, validateUrl: async () => ({ ok: true, reason: "" }), budgetMs: 20_000, toolTimeoutMs: 5000, goalAi: ai as any };
const U = "user-1";
const T1 = "11111111-1111-4111-8111-111111111111", T2 = "22222222-2222-4222-8222-222222222222", T3 = "33333333-3333-4333-8333-333333333333";
const client = () => H.createClient("u", "k");
let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + ": " + (e as Error).message); } }

function setup() {
  H.reset(); calls = []; aiCalls = []; judgeReplies = []; planReplies = [];
  for (const [id, name, host] of [[T1, "Research Bot", "research"], [T2, "Writer Bot", "writer"], [T3, "Third Bot", "third"]]) {
    H.table("external_tools").push({ id, user_id: U, name, endpoint_url: `https://${host}.example.com/v1`, request_format: "generic_json", model: null, auth_header: "Authorization", auth_scheme: "Bearer ", credentials_secret_id: "sec-1", enabled: true, approved_at: new Date().toISOString() });
  }
  H.state.rpc.read_integration_secret = { token: "tok" };
  script = () => ({ json: { status: "done", answer: "ok" } });
}
const legs = () => H.table("outer_control_sessions").slice().sort((a: any, b: any) => a.leg_no - b.leg_no);
const wf = () => H.table("outer_control_workflows")[0];
const judge = (...v: { id: string; met: boolean; evidence?: string }[]) => JSON.stringify({ criteria: v.map((x) => ({ id: x.id, met: x.met, evidence: x.evidence ?? "" })) });
const plan = (question: string, tool: number) => JSON.stringify({ question, tool });
async function start(o: { goal?: string; criteria?: string[]; tools?: string[]; rounds?: number; ai?: boolean } = {}) {
  const r: any = await H.startGoal(client(), U, { goal: o.goal ?? "Find the return rules for premium customers", criteria: o.criteria, tool_ids: o.tools ?? [T1], max_rounds: o.rounds }, { aiAvailable: o.ai ?? true });
  if (!r.ok) throw new Error(`startGoal refused: ${r.code} ${r.message}`);
  return r;
}
async function run(r: any, withAi: boolean = true) {
  const d = withAi ? deps : { ...deps, goalAi: undefined };
  await Promise.all(r.running.map((id: string) => H.driveSession(client(), id, d)));
}

const C1 = "States the return window", C2 = "States the refund time";
const A1 = "Premium customers can return items within thirty days of purchase.";
const A2 = "Premium customers can return items within thirty days of purchase. Refunds are issued to the original payment method within 5 business days.";

await t("start: a goal Task is stored with its criteria, one running first step carrying the goal and the criteria", async () => {
  setup();
  const r = await start({ criteria: [C1, C2], tools: [T1, T2], rounds: 3 });
  const w = wf();
  assert.equal(w.mode, "goal"); assert.equal(w.max_rounds, 3); assert.equal(w.rounds_used, 1);
  assert.deepEqual(w.done_criteria.map((c: any) => c.text), [C1, C2]);
  assert.deepEqual(w.criteria_state.map((c: any) => c.met), [null, null]);
  assert.deepEqual(w.goal_pool, [T1, T2]);
  assert.match(String(w.context), /^Overall goal: Find the return rules/);
  assert.equal(legs().length, 1); assert.equal(legs()[0].status, "running"); assert.equal(legs()[0].tool_id, T1); assert.equal(legs()[0].fallback_tool_id, T2);
  assert.ok(legs()[0].objective.includes("Find the return rules") && legs()[0].objective.includes(`- ${C1}`) && legs()[0].objective.includes(`- ${C2}`));
  assert.equal(r.running.length, 1);
});

await t("start: refuses an empty goal, a bad tool list, a disabled tool, and own criteria without the checking AI", async () => {
  setup();
  const bad = async (input: any, ai = true) => ((await H.startGoal(client(), U, input, { aiAvailable: ai })) as any);
  assert.equal((await bad({ goal: " ", tool_ids: [T1] })).code, "invalid_goal");
  assert.equal((await bad({ goal: "g", tool_ids: [] })).code, "invalid_tools");
  assert.equal((await bad({ goal: "g", tool_ids: [T1, T2, T3, "44444444-4444-4444-8444-444444444444"] })).code, "invalid_tools");
  assert.equal((await bad({ goal: "g", tool_ids: ["nope"] })).code, "invalid_tools");
  assert.equal((await bad({ goal: "g", tool_ids: ["55555555-5555-4555-8555-555555555555"] })).code, "tool_unavailable");
  H.table("external_tools")[0].enabled = false;
  assert.equal((await bad({ goal: "g", tool_ids: [T1] })).code, "tool_unavailable");
  H.table("external_tools")[0].enabled = true;
  assert.equal((await bad({ goal: "g", criteria: [C1], tool_ids: [T1] }, false)).code, "ai_unavailable");
  assert.equal(((await bad({ goal: "g", tool_ids: [T1] }, false)) as any).ok, true, "no criteria needs no AI");
  assert.equal(H.table("outer_control_workflows").length, 1, "only the valid start created a Task");
});

await t("default criterion: one good answer completes the Task in one round, with no AI and a valid final artifact", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  await run(await start({ goal: "Find the return window for premium customers" }), false);
  const w = wf();
  assert.equal(w.status, "completed"); assert.equal(legs().length, 1); assert.equal(aiCalls.length, 0);
  assert.equal(w.criteria_state[0].met, true); assert.ok(w.criteria_state[0].evidence);
  assert.match(w.summary, /1 of 1 criteria met; round 1 of 4\. All criteria met\./);
  assert.equal(w.blocked_reason, null);
  assert.equal(H.validateArtifact(w.final_artifact, "task").ok, true);
});

await t("two rounds: unmet criterion -> the AI writes the next question and picks the tool; the second answer completes the Task", async () => {
  setup();
  script = (n) => ({ json: { status: "done", answer: n === 1 ? A1 : A2 } });
  judgeReplies = [judge({ id: "c1", met: true, evidence: "return items within thirty days of purchase" }, { id: "c2", met: false }),
    judge({ id: "c1", met: false }, { id: "c2", met: true, evidence: "within 5 business days" })];
  planReplies = [plan("How many business days do refunds take for premium customers, and give the full policy?", 2)];
  await run(await start({ criteria: [C1, C2], tools: [T1, T2] }));
  const l = legs();
  assert.equal(l.length, 2); assert.deepEqual(l.map((x: any) => x.status), ["completed", "completed"]);
  assert.equal(l[1].tool_id, T2, "the AI chose the second tool"); assert.deepEqual(l[1].depends_on, [1]);
  assert.equal(l[1].objective, "How many business days do refunds take for premium customers, and give the full policy?");
  assert.ok(String(calls[1].body.context).includes(A1), "the second tool received the first controlled result");
  const w = wf();
  assert.equal(w.status, "completed"); assert.equal(w.rounds_used, 2);
  assert.deepEqual(w.criteria_state.map((c: any) => c.met), [true, true]);
  assert.equal(w.criteria_state[0].round, 1); assert.equal(w.criteria_state[1].round, 2);
  assert.equal(w.final_output, A2); assert.equal(H.validateArtifact(w.final_artifact, "task").ok, true);
  assert.equal(aiCalls.filter((c) => c.kind === "judge").length, 2); assert.equal(aiCalls.filter((c) => c.kind === "plan").length, 1);
});

await t("evidence: a criterion the AI calls met without a quote that appears in the results stays unmet", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  judgeReplies = [judge({ id: "c1", met: true, evidence: "returns are accepted for ninety days" }, { id: "c2", met: true })];
  planReplies = [plan("State the return window and the refund time for premium customers.", 1)];
  const r = await start({ criteria: [C1, C2], rounds: 1 });
  await run(r);
  assert.deepEqual(wf().criteria_state.map((c: any) => c.met), [false, false]);
  assert.notEqual(wf().status, "completed");
});

await t("an unusable plan falls back to the fixed question, which names what is missing", async () => {
  setup();
  script = (n) => ({ json: { status: "done", answer: n === 1 ? A1 : A2 } });
  judgeReplies = [judge({ id: "c1", met: true, evidence: "within thirty days of purchase" }, { id: "c2", met: false }), judge({ id: "c2", met: true, evidence: "within 5 business days" })];
  planReplies = ["I would ask about refunds", plan("x", 1)];
  await run(await start({ criteria: [C1, C2] }));
  assert.equal(legs().length, 2);
  assert.ok(legs()[1].objective.startsWith("Still missing for this goal: States the refund time."), legs()[1].objective);
  assert.equal(wf().status, "completed");
});

await t("no AI at all: own criteria cannot be checked, so the Task is blocked (never completed) and says so", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  const r = await start({ criteria: [C1, C2] });
  await run(r, false);
  const w = wf();
  assert.equal(w.status, "awaiting_human"); assert.match(w.blocked_reason, /could not be checked/); assert.equal(w.final_output, null); assert.equal(w.final_artifact, null);
  assert.equal(legs().length, 1);
});

await t("rounds used up: the Task stops after exactly max_rounds rounds, blocked with the reason and the unmet criteria", async () => {
  setup();
  let n = 0;
  script = () => ({ json: { status: "done", answer: `Round ${++n}: the return rules for premium customers are published by support team number ${n * 7} on the help pages.` } });
  for (let i = 0; i < 4; i++) judgeReplies.push(judge({ id: "c1", met: false }));
  planReplies = [plan("State the return window for premium customers please.", 1), plan("Please state the return window for premium customers.", 1)];
  await run(await start({ criteria: [C1], rounds: 2 }));
  const w = wf();
  assert.equal(legs().length, 2, "never a round more than allowed"); assert.equal(calls.length, 2); assert.equal(w.rounds_used, 2);
  assert.equal(w.status, "awaiting_human"); assert.match(w.blocked_reason, /2 rounds were used and these criteria are still not met: "States the return window"/);
  assert.match(w.blocked_reason, /Accept the result as it is, allow more rounds, or stop/);
  assert.equal(w.final_artifact, null); assert.ok(w.blocked_at);
});

await t("no progress: the same answer again with nothing newly met blocks the Task before the rounds run out", async () => {
  setup();
  const same = "The return rules for premium customers are published by the support team on the help pages of the shop, with a short summary for every product line.";
  script = () => ({ json: { status: "done", answer: same } });
  judgeReplies = [judge({ id: "c1", met: false }), judge({ id: "c1", met: false })];
  planReplies = [plan("State the return window for premium customers please.", 1)];
  await run(await start({ criteria: [C1], rounds: 5 }));
  const w = wf();
  assert.equal(legs().length, 2); assert.equal(w.status, "awaiting_human"); assert.match(w.blocked_reason, /repeats the one before and met nothing new/);
});

await t("blocked Tasks are left alone: the sweep calling again adds no round and makes no AI call", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  judgeReplies = [judge({ id: "c1", met: false }, { id: "c2", met: false })];
  await run(await start({ criteria: [C1, C2] }), false);
  const before = { legs: legs().length, ai: aiCalls.length, reason: wf().blocked_reason };
  for (let i = 0; i < 3; i++) await H.progressWorkflow(client(), wf().id, ai);
  assert.equal(legs().length, before.legs); assert.equal(aiCalls.length, before.ai); assert.equal(wf().blocked_reason, before.reason); assert.equal(wf().status, "awaiting_human");
});

await t("two callers at once judge a round once and add one next round", async () => {
  setup();
  script = (n) => ({ json: { status: "done", answer: n === 1 ? A1 : A2 } });
  judgeReplies = [judge({ id: "c1", met: true, evidence: "within thirty days of purchase" }, { id: "c2", met: false }), judge({ id: "c2", met: true, evidence: "within 5 business days" })];
  planReplies = [plan("How many business days do refunds take for premium customers?", 1)];
  const r = await start({ criteria: [C1, C2] });
  // Run the first step only, without letting the driver continue the Task.
  await H.advanceSession(client(), r.running[0], deps);
  const [a, b] = await Promise.all([H.progressWorkflow(client(), wf().id, ai), H.progressWorkflow(client(), wf().id, ai)]);
  assert.equal(legs().length, 2, "exactly one next round"); assert.equal(aiCalls.filter((c) => c.kind === "judge").length, 1);
  assert.equal(a.length + b.length, 1, "one caller started it");
});

await t("accept: the owner takes the last result; the Task completes and says the criteria were not all confirmed", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  judgeReplies = [judge({ id: "c1", met: true, evidence: "within thirty days of purchase" }, { id: "c2", met: false })];
  await run(await start({ criteria: [C1, C2], rounds: 1 }));
  assert.equal(wf().status, "awaiting_human");
  const r: any = await H.acceptGoal(client(), wf().id, U, ai);
  assert.equal(r.ok, true);
  const w = wf();
  assert.equal(w.status, "completed"); assert.equal(w.final_output, A1); assert.equal(H.validateArtifact(w.final_artifact, "task").ok, true);
  assert.match(w.summary, /Accepted as done by the owner although 1 criterion was not confirmed/);
  assert.equal(w.blocked_reason, null);
  assert.equal(((await H.acceptGoal(client(), w.id, U)) as any).ok, false, "nothing left to decide");
});

await t("more rounds: the limit grows by two, the next question is written at once, and the Task can finish", async () => {
  setup();
  let n = 0;
  script = () => ({ json: { status: "done", answer: ++n < 2 ? A1 : A2 } });
  judgeReplies = [judge({ id: "c1", met: true, evidence: "within thirty days of purchase" }, { id: "c2", met: false }), judge({ id: "c2", met: true, evidence: "within 5 business days" })];
  planReplies = [plan("How many business days do refunds take for premium customers?", 1)];
  await run(await start({ criteria: [C1, C2], rounds: 1 }));
  assert.equal(wf().status, "awaiting_human"); assert.match(wf().blocked_reason, /1 round was used/);
  const r: any = await H.extendGoal(client(), wf().id, U, ai);
  assert.equal(r.ok, true); assert.equal(wf().max_rounds, 3); assert.equal(r.started.length, 1);
  await Promise.all(r.started.map((id: string) => H.driveSession(client(), id, deps)));
  assert.equal(legs().length, 2); assert.equal(wf().status, "completed"); assert.equal(wf().rounds_used, 2);
  assert.equal(aiCalls.filter((c) => c.kind === "judge").length, 2, "the blocked round was not judged a second time");
});

await t("more rounds is refused when the Task is not blocked, belongs to someone else, or is at the maximum", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: "Premium customers get refunds within thirty days; the refund policy covers returns." } });
  await run(await start(), false);
  assert.equal(((await H.extendGoal(client(), wf().id, U, ai)) as any).ok, false, "completed Task");
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  await run(await start({ criteria: [C1, C2], rounds: 1 }), false);
  assert.equal(((await H.extendGoal(client(), wf().id, "someone-else", ai)) as any).ok, false);
  wf().max_rounds = 10;
  assert.match(((await H.extendGoal(client(), wf().id, U, ai)) as any).message, /most rounds allowed/);
});

await t("a blocked Task nobody decides on for a week ends, and a charged credit is asked back", async () => {
  setup();
  script = () => ({ json: { status: "done", answer: A1 } });
  await run(await start({ criteria: [C1, C2] }), false);
  wf().credit_charged = true;
  wf().blocked_at = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const rpcs: string[] = [];
  const c = client() as any; const orig = c.rpc?.bind(c);
  c.rpc = async (name: string, args: any) => { rpcs.push(name); return orig ? orig(name, args) : { data: true, error: null }; };
  await H.progressWorkflow(c, wf().id, ai);
  assert.equal(wf().status, "cancelled"); assert.match(wf().stop_reason, /Nobody decided within 7 days/);
  assert.ok(rpcs.includes("refund_workflow_credit"));
});

await t("a step that fails ends the Task through the usual rollup, not as a goal block", async () => {
  setup();
  script = () => ({ status: 500, json: {} } as any);
  await run(await start({ criteria: [C1] }), true);
  const w = wf();
  assert.ok(["failed", "awaiting_human"].includes(w.status));
  assert.equal(aiCalls.length, 0, "nothing to judge");
});

await t("a NazAI agent step is told which Task and step asked for the run", async () => {
  setup();
  const AG = "99999999-9999-4999-8999-999999999999";
  H.table("agents").push({ id: AG, user_id: U, name: "My agent" });
  H.table("external_tools").push({ id: AG, user_id: U, name: "My agent", endpoint_url: `nazai-agent://${AG}`, request_format: "generic_json", model: null, auth_header: "Authorization", auth_scheme: "Bearer ", credentials_secret_id: null, enabled: true, approved_at: new Date().toISOString(), agent_id: AG });
  const agentCalls: any[] = [];
  const agentFetch = async (url: any, init: any) => { agentCalls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers }); return new Response(JSON.stringify({ runId: "run-1", summary: "Booked the meeting with the customer for Friday at ten." }), { status: 200 }); };
  const d = { ...deps, fetchImpl: agentFetch as any, agent: { url: "https://x.supabase.co/functions/v1/agent-runtime", serviceKey: "svc" }, agentTimeoutMs: 5000 };
  const r: any = await H.startGoal(client(), U, { goal: "Book the meeting with the customer", tool_ids: [AG] }, { aiAvailable: false });
  assert.equal(r.ok, true);
  await Promise.all(r.running.map((id: string) => H.driveSession(client(), id, d)));
  assert.equal(agentCalls.length, 1);
  assert.equal(agentCalls[0].body.outerTaskId, r.workflowId); assert.equal(agentCalls[0].body.outerSessionId, legs()[0].id);
  assert.equal(agentCalls[0].headers["x-scheduler-user-id"], U);
});

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
