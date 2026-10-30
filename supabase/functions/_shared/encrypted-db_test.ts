// Run with: deno test --allow-env supabase/functions/_shared/encrypted-db_test.ts
// Data encryption, front 3: the client wrapper. What reaches the database is ciphertext; what the code reads is the text.
import { ENCRYPTED_COLUMNS, openRows, planSelect, sweepEncryptedColumns, withFieldEncryption } from "./encrypted-db.ts";
import { importFieldKeys, sealFields, toB64 } from "./field-crypto.ts";
import { createClient, reset, state, table } from "../../../tests/outer-control-engine/fake-supabase.ts";

function assert(ok: unknown, m: string) { if (!ok) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function rejects(p: PromiseLike<unknown>, text: string) { try { await p; } catch (e) { if (!String((e as Error).message).includes(text)) throw new Error(`expected "${text}", got ${(e as Error).message}`); return; } throw new Error(`expected a rejection with "${text}"`); }

const KEYS = (await importFieldKeys(toB64(new Uint8Array(32).fill(4))))!;
const OTHER = (await importFieldKeys(toB64(new Uint8Array(32).fill(5))))!;
const setup = () => { reset(); return withFieldEncryption(createClient("", ""), KEYS); };

Deno.test("insert: content is stored only encrypted, bound to a generated id; defaults are kept; other columns untouched", async () => {
  const db = setup();
  const { data } = await db.from("outer_control_sessions").insert({ user_id: "u1", objective: "Write the Q3 plan", status: "running" }).select("id, objective, status").single();
  assertEquals(data.objective, "Write the Q3 plan");
  const row = table("outer_control_sessions")[0];
  assert(/^[0-9a-f-]{36}$/.test(row.id), "an id is generated before encrypting");
  assertEquals([row.objective, row.status, row.user_id], [null, "running", "u1"]);
  assert(row.objective_enc.startsWith("v2:") && !row.objective_enc.includes("Q3"), "only ciphertext stored");
  assert(row.history_enc?.startsWith("v2:") && row.history === null, "an omitted default ([] history) is stored encrypted too");
  const { data: back } = await db.from("outer_control_sessions").select("*").eq("id", row.id).maybeSingle();
  assertEquals([back.objective, back.history, back.objective_enc], ["Write the Q3 plan", [], undefined]);
});

Deno.test("select: columns asked for come back decrypted, ids and _enc helpers are not leaked, jsonb keeps its type", async () => {
  const db = setup();
  await db.from("outer_control_workflows").insert([{ id: "11111111-1111-1111-1111-111111111111", user_id: "u1", objective: "A", goal_pool: [{ g: 1 }], kind: "task" }, { id: "22222222-2222-2222-2222-222222222222", user_id: "u1", objective: "B", kind: "task" }]);
  const { data } = await db.from("outer_control_workflows").select("objective, goal_pool, kind").eq("user_id", "u1").order("id");
  assertEquals(data.map((r: Record<string, unknown>) => [r.objective, r.goal_pool, r.kind]), [["A", [{ g: 1 }], "task"], ["B", [], "task"]]);
  const { data: aliased } = await db.from("outer_control_workflows").select("id, goal:objective").eq("id", "11111111-1111-1111-1111-111111111111").single();
  assertEquals(aliased.goal, "A", "an alias of an encrypted column works");
  const { count } = await db.from("outer_control_workflows").select("id", { count: "exact", head: true }).eq("user_id", "u1");
  assertEquals(count, 2, "counts pass through");
});

Deno.test("update by id: new values encrypted for that row; conditions still apply", async () => {
  const db = setup();
  await db.from("outer_control_sessions").insert({ id: "33333333-3333-3333-3333-333333333333", user_id: "u1", objective: "x", status: "running" });
  await db.from("outer_control_sessions").update({ final_output: "Done: 42", status: "completed" }).eq("id", "33333333-3333-3333-3333-333333333333").eq("status", "running");
  let row = table("outer_control_sessions")[0];
  assertEquals([row.final_output, row.status], [null, "completed"]);
  await db.from("outer_control_sessions").update({ final_output: "changed" }).eq("id", row.id).eq("status", "running");
  const { data } = await db.from("outer_control_sessions").select("final_output").eq("id", row.id).single();
  assertEquals(data.final_output, "Done: 42", "the condition (status running) no longer held, so nothing changed");
  row = table("outer_control_sessions")[0];
  assert(!JSON.stringify(row).includes("Done: 42"), "the text is nowhere in the stored row");
});

Deno.test("update without an id: every matching row gets values encrypted for itself", async () => {
  const db = setup();
  for (const id of ["44444444-4444-4444-4444-444444444441", "44444444-4444-4444-4444-444444444442"]) await db.from("outer_control_memory").insert({ id, user_id: "u1", session_id: "s1", kind: "note", summary: "old" });
  await db.from("outer_control_memory").insert({ id: "44444444-4444-4444-4444-444444444443", user_id: "u1", session_id: "s2", kind: "note", summary: "other" });
  const { data: updated } = await db.from("outer_control_memory").update({ summary: "new" }).eq("session_id", "s1").select("id, summary");
  assertEquals(updated.map((r: Record<string, unknown>) => r.summary), ["new", "new"]);
  const rows = table("outer_control_memory");
  assert(rows[0].summary_enc !== rows[1].summary_enc, "each row has its own ciphertext");
  const { data } = await db.from("outer_control_memory").select("summary").order("id");
  assertEquals(data.map((r: Record<string, unknown>) => r.summary), ["new", "new", "other"]);
});

Deno.test("rows written before encryption are read as stored; a plain write is picked up again", async () => {
  const db = setup();
  table("outer_control_session_steps").push({ id: "55555555-5555-5555-5555-555555555555", session_id: "s1", user_id: "u1", reply_text: "legacy reply", request: { a: 1 }, note: null });
  const { data } = await db.from("outer_control_session_steps").select("reply_text, request, note").eq("session_id", "s1");
  assertEquals(data.map((r: Record<string, unknown>) => [r.reply_text, r.request, r.note]), [["legacy reply", { a: 1 }, null]]);
});

Deno.test("a value that does not decrypt fails loudly; other tables and missing keys", async () => {
  reset();
  const raw = createClient("", "");
  await withFieldEncryption(raw, KEYS).from("outer_control_completion_checks").insert({ id: "66666666-6666-6666-6666-666666666666", user_id: "u1", session_id: "s", summary: "ok" });
  await rejects(withFieldEncryption(raw, OTHER).from("outer_control_completion_checks").select("summary"), "not configured");
  await withFieldEncryption(raw, KEYS).from("external_tools").insert({ id: "t1", name: "plain table" });
  assertEquals(table("external_tools")[0].name, "plain table", "tables not listed are untouched");
  await rejects(withFieldEncryption(raw, Promise.resolve(null)).from("outer_control_memory").select("summary"), "DATA_KEY is not configured");
  await rejects(withFieldEncryption(raw, KEYS).from("outer_control_memory").upsert({ user_id: "u1", summary: "x" }, { onConflict: "session_id" }), "needs the row id");
});

Deno.test("filtering or sorting by an encrypted column is refused, by name", async () => {
  const db = setup();
  await rejects(db.from("outer_control_workflows").select("id").order("objective"), "outer_control_workflows.objective is encrypted");
  await rejects(db.from("outer_control_sessions").select("id").eq("final_output", "x"), "final_output is encrypted");
  await rejects(db.from("outer_control_sessions").select("id").not("history", "is", null), "history is encrypted");
  await rejects(db.from("outer_control_sessions").select("id").or("objective.is.null,status.eq.running"), "objective is encrypted");
  await db.from("outer_control_sessions").select("id").eq("status", "running").order("started_at");
});

Deno.test("every listed table and column", () => {
  assertEquals(Object.keys(ENCRYPTED_COLUMNS).length, 16);
  assertEquals(Object.values(ENCRYPTED_COLUMNS).reduce((n, s) => n + s.cols.length, 0), 51);
});

Deno.test("agent events: the payload is encrypted, its ok/ref/original_event_id flags stay filterable in their own columns", async () => {
  const db = setup();
  await db.from("agent_events").insert({ agent_id: "a1", kind: "action", payload: { ok: true, ref: "e-9", original_event_id: "e-1", email: "secret text" } });
  const row = table("agent_events")[0];
  assertEquals([row.payload, row.payload_ok, row.payload_ref, row.payload_original_event_id], [null, true, "e-9", "e-1"]);
  assert(!row.payload_enc.includes("secret"), "the payload itself is only ciphertext");
  const { data } = await db.from("agent_events").select("id, payload").eq("payload_ok", true);
  assertEquals(data[0].payload.email, "secret text");
  await db.from("agent_events").update({ payload: { ok: false } }).eq("id", row.id);
  assertEquals([table("agent_events")[0].payload_ok, table("agent_events")[0].payload_ref], [false, null], "an update keeps the flags in step");
  await db.from("agent_events").insert({ agent_id: "a1", kind: "note" });
  assertEquals(table("agent_events")[1].payload_ok, null, "no payload given: the {} default, no flags");
});

Deno.test("approvals: an execution summary is scrubbed of secrets before it is encrypted; the description default is kept", async () => {
  const db = setup();
  await db.from("pending_approvals").insert({ user_id: "u1", status: "pending", execution_summary: `sent with key ${["sk", "live", "0123456789abcdefghijklmnop"].join("_")}` } /* a made-up key, built in pieces */);
  const { data } = await db.from("pending_approvals").select("description, execution_summary").eq("user_id", "u1").single();
  assert(!data.execution_summary.includes("0123456789abcdefghij"), `the key is scrubbed: ${data.execution_summary}`);
  assertEquals(data.description, "");
});

Deno.test("rows from a database function: <col>_enc is decrypted with the row's own id, wherever the function returns it", async () => {
  const sealed = await sealFields(KEYS, "pending_approvals", "row-7", { description: "Refund order 42" }, ["description"]);
  const rows = await openRows("pending_approvals", [
    { id: "decision-3", real_source: "approval", approval_row_id: "row-7", ...sealed },
    { id: "decision-4", real_source: "decision", approval_row_id: null, description: "Plain decision", description_enc: null },
  ], KEYS, "approval_row_id");
  assertEquals(rows.map((r) => [r.id, r.description, "description_enc" in r]), [["decision-3", "Refund order 42", false], ["decision-4", "Plain decision", false]]);
  await rejects(openRows("pending_approvals", [{ id: "d", approval_row_id: "row-8", ...sealed }], KEYS, "approval_row_id"), "");
  await rejects(openRows("pending_approvals", [{ id: "d", approval_row_id: "row-7", ...sealed }], null, "approval_row_id"), "DATA_KEY is not configured");
});

Deno.test("the column list sent to the database asks for the encrypted columns and the id, and nothing extra comes back", () => {
  const cols = ENCRYPTED_COLUMNS.outer_control_sessions.cols;
  const p1 = planSelect(cols, "id, status, objective, final_artifact");
  assertEquals(p1.select, "id,status,objective,final_artifact,objective_enc,final_artifact_enc");
  assertEquals([p1.open, p1.dropId, p1.drop], [["objective", "final_artifact"], false, []]);
  const p2 = planSelect(cols, "status, objective");
  assertEquals(p2.select, "status,objective,objective_enc,id", "the id is needed to decrypt");
  assert(p2.dropId, "and is removed from the result again");
  const p3 = planSelect(cols, "id, goal:objective, tool:external_tools(name)");
  assertEquals(p3.select, "id,goal:objective,tool:external_tools(name),objective_enc,objective");
  assertEquals([p3.renames, p3.drop], [[["goal", "objective"]], ["objective"]]);
  assertEquals(planSelect(cols, "id, status").select, "id,status", "no encrypted column asked for: unchanged");
  assertEquals(planSelect(cols, "*").select, "*");
  assertEquals(planSelect(cols, undefined).select, "*");
});

Deno.test("conversion: rows written before encryption are encrypted in batches; only columns the report shows work for", async () => {
  reset();
  const plain = createClient("", "");
  const t = table("outer_control_sessions");
  for (let i = 0; i < 3; i++) t.push({ id: `0000000${i}-0000-0000-0000-000000000000`, user_id: "u1", objective: `legacy ${i}`, history: [{ s: i }], status: "completed" });
  state.rpc.encryption_report = [
    { table_name: "outer_control_sessions", column_name: "objective", plain_rows: 3, keys: {} },
    { table_name: "outer_control_sessions", column_name: "history", plain_rows: 3, keys: {} },
    { table_name: "outer_control_sessions", column_name: "final_output", plain_rows: 0, keys: {} },
    { table_name: "imported_projects", column_name: "content", plain_rows: 9, keys: {} },
  ];
  const r1 = await sweepEncryptedColumns(plain, KEYS, 2);
  assertEquals([r1.columns, r1.encrypted, r1.failed], [2, 4, 0], "two columns with work, two rows each (the batch size); imported_projects is not this key's");
  await sweepEncryptedColumns(plain, KEYS, 2);
  assert(t.every((r) => r.objective === null && r.history === null && r.objective_enc && r.history_enc), "all converted");
  const { data } = await withFieldEncryption(plain, KEYS).from("outer_control_sessions").select("objective, history").order("id");
  assertEquals(data.map((r: Record<string, unknown>) => [r.objective, r.history]), [["legacy 0", [{ s: 0 }]], ["legacy 1", [{ s: 1 }]], ["legacy 2", [{ s: 2 }]]]);

  // A DATA_KEY rotation: the report shows values on the previous key, so they are moved; then there is nothing left to do.
  const rotated = (await importFieldKeys(toB64(new Uint8Array(32).fill(5)), toB64(new Uint8Array(32).fill(4))))!;
  state.rpc.encryption_report = [{ table_name: "outer_control_sessions", column_name: "objective", plain_rows: 0, keys: { [KEYS.current.id]: 3 } }];
  assertEquals((await sweepEncryptedColumns(plain, rotated, 10)).reencrypted, 3);
  assert(t.every((r) => r.objective_enc.startsWith(`v2:${rotated.current.id}:`)), "all on the new key");
  state.rpc.encryption_report = [{ table_name: "outer_control_sessions", column_name: "objective", plain_rows: 0, keys: { [rotated.current.id]: 3 } }];
  assertEquals((await sweepEncryptedColumns(plain, rotated, 10)).columns, 0, "nothing on another key: nothing to do");
  assertEquals((await sweepEncryptedColumns(plain, null)).columns, 0, "without a key it waits");
});
