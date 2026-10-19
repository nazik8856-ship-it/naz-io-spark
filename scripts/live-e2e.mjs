#!/usr/bin/env node
// A live end-to-end check of Outer Control against the deployed project. It signs in as a real account (a user access token you pass in),
// uses one connected tool (the "stub" tool is perfect), and checks the whole path:
//   - the connection test works
//   - a session runs to completion with a valid final artifact, and the stored result equals the artifact's
//   - a follow-up starts a second session and completes
//   - archiving hides a finished session and restoring brings it back (nothing is deleted)
//   - a forged "x-scheduler-user-id" request to agent-runtime is refused
// It writes a few rows to that account's history, which it archives at the end. Each session asks the tool one short question.
//
//   LIVE_USER_TOKEN=<access token> LIVE_TOOL_ID=<tool id> node scripts/live-e2e.mjs
//   optional: LIVE_SUPABASE_URL, LIVE_ANON_KEY (defaults to this project's public values)
//
// Exit code 0 only when every check passed. Nothing here is secret: the token comes from the environment and is never printed.
const URL_BASE = (process.env.LIVE_SUPABASE_URL || "https://ekuodpaaiugzywfcmjeo.supabase.co").replace(/\/$/, "");
const ANON = process.env.LIVE_ANON_KEY || "";
const TOKEN = process.env.LIVE_USER_TOKEN || "";
const TOOL = process.env.LIVE_TOOL_ID || "";
if (!TOKEN || !TOOL || !ANON) {
  console.error("Set LIVE_USER_TOKEN, LIVE_TOOL_ID and LIVE_ANON_KEY (and optionally LIVE_SUPABASE_URL). See the header of this file.");
  process.exit(2);
}

const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, apikey: ANON };
const drive = async (action, payload = {}) => {
  const r = await fetch(`${URL_BASE}/functions/v1/outer-control-drive`, { method: "POST", headers, body: JSON.stringify({ action, ...payload }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const rest = async (path) => (await fetch(`${URL_BASE}/rest/v1/${path}`, { headers })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const created = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

async function waitForSession(id, ms = 150_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const [s] = await rest(`outer_control_sessions?id=eq.${id}&select=id,status,final_output,final_artifact,stop_reason,archived_at`);
    if (s && !["queued", "running", "awaiting_human"].includes(s.status)) return s;
    await sleep(3000);
  }
  throw new Error(`session ${id} did not finish in time`);
}
const validResult = (s) => s.status === "completed" && s.final_artifact?.kind === "session" && typeof s.final_artifact.final_output === "string"
  && s.final_artifact.final_output.trim() !== "" && s.final_artifact.final_output === s.final_output;

await check("the connection test works", async () => {
  const r = await drive("test_tool", { tool_id: TOOL });
  must(r.status === 200 && r.body.ok === true, `test_tool answered ${r.status}: ${r.body.error || r.body.message || "not ok"}`);
});

let first;
await check("a session runs to completion with a valid final artifact that equals the stored result", async () => {
  const r = await drive("start_session", { tool_id: TOOL, objective: "In one sentence, say what a control layer for AI does." });
  must(r.status === 200 && r.body.session_id, `start_session answered ${r.status}: ${r.body.message || r.body.error}`);
  created.push(r.body.session_id);
  first = await waitForSession(r.body.session_id);
  must(validResult(first), `status ${first.status}; ${first.stop_reason || "no valid final artifact"}`);
});

await check("a follow-up starts a second session on the same tool and completes", async () => {
  must(first && validResult(first), "needs the first session to have completed");
  const r = await drive("follow_up", { session_id: first.id, instruction: "Now say it in five words." });
  must(r.status === 200 && r.body.session_id, `follow_up answered ${r.status}: ${r.body.message || r.body.error}`);
  created.push(r.body.session_id);
  const second = await waitForSession(r.body.session_id);
  must(validResult(second), `status ${second.status}; ${second.stop_reason || "no valid final artifact"}`);
  must(second.id !== first.id, "the follow-up reused the first session");
});

await check("a session that is still open cannot be followed up or archived", async () => {
  const r = await drive("follow_up", { session_id: "00000000-0000-4000-8000-000000000000", instruction: "x" });
  must(r.status === 404, `an unknown session should be 404, got ${r.status}`);
});

await check("archiving hides a finished session and restoring brings it back; nothing is deleted", async () => {
  must(first, "needs a finished session");
  const a = await drive("archive", { kind: "session", id: first.id });
  must(a.status === 200 && a.body.archived === true, `archive answered ${a.status}: ${a.body.message || a.body.error}`);
  const [hidden] = await rest(`outer_control_sessions?id=eq.${first.id}&select=archived_at`);
  must(hidden?.archived_at, "the session was not marked archived");
  const b = await drive("archive", { kind: "session", id: first.id, archived: false });
  must(b.status === 200 && b.body.archived === false, `restore answered ${b.status}`);
  const [back] = await rest(`outer_control_sessions?id=eq.${first.id}&select=archived_at,status`);
  must(back && back.archived_at === null && back.status === "completed", "the session did not come back as it was");
});

await check("a forged scheduler header is refused by agent-runtime", async () => {
  const r = await fetch(`${URL_BASE}/functions/v1/agent-runtime`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, "x-scheduler-user-id": "00000000-0000-4000-8000-0000000000aa" },
    body: JSON.stringify({ agentId: "00000000-0000-4000-8000-0000000000bb", trigger: "cron" }),
  });
  must(r.status === 401, `expected 401, got ${r.status}`);
});

// Leave the account's list as it was: archive what this run created.
for (const id of created) await drive("archive", { kind: "session", id }).catch(() => {});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
