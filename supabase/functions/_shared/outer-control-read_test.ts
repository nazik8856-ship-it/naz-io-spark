// Run with: deno test --allow-env supabase/functions/_shared/outer-control-read_test.ts
// Data encryption, front 3: outer-control-read accepts reads of the encrypted Outer Control tables only, built from plain data.
import { validRead } from "./outer-control-read.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const sel = (cols: string) => ({ m: "select", a: [cols] });

Deno.test("a read the screens send is accepted", () => {
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("id, objective, status"), { m: "eq", a: ["user_id", "u1"] }, { m: "is", a: ["archived_at", null] }, { m: "order", a: ["started_at", { ascending: false }] }, { m: "limit", a: [10] }] }), null);
  assertEquals(validRead({ table: "outer_control_session_steps", ops: [sel("id, reply_text"), { m: "in", a: ["session_id", ["a", "b"]] }, { m: "maybeSingle", a: [] }] }), null);
  assertEquals(validRead({ table: "pending_approvals", ops: [{ m: "select", a: ["id, description", { count: "exact" }] }, { m: "eq", a: ["status", "pending"] }] }), null, "a count with the rows");
  assertEquals(validRead({ table: "pending_approvals", ops: [{ m: "select", a: ["id", { count: "exact", head: true, x: 1 }] }] }), "invalid select options");
});

Deno.test("anything else is refused", () => {
  assertEquals(validRead(null), "unknown table");
  assertEquals(validRead({ table: "api_keys", ops: [sel("key_hash")] }), "unknown table", "only the encrypted Outer Control tables");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [] }), "ops must be 1 to 20 steps");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [{ m: "eq", a: ["id", "x"] }] }), "the first step must be select with a column list");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("id"), { m: "update", a: [{ status: "x" }] }] }), "not allowed: update");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("id"), { m: "delete", a: [] }] }), "not allowed: delete");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("id"), { m: "select", a: ["objective"] }] }), "not allowed: select");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("id"), { m: "eq", a: ["id", { a: { b: { c: 1 } } }] }] }), "invalid arguments for eq");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("x".repeat(2001))] }), "the first step must be select with a column list");
  assertEquals(validRead({ table: "outer_control_sessions", ops: [sel("id"), ...Array(20).fill({ m: "limit", a: [1] })] }), "ops must be 1 to 20 steps");
});
