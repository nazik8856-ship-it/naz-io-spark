// Run with: deno test --allow-env supabase/functions/_shared/encrypted-write_test.ts
// Data encryption, front 4: encrypted-write accepts only the writes the website makes, built from plain data.
import { validWrite } from "./encrypted-write.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const A = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

Deno.test("the writes the screens send are accepted", () => {
  assertEquals(validWrite({ table: "missions", ops: [{ m: "insert", a: [{ user_id: "u1", directive: "Build a shop", meta: { tags: ["a"] } }] }, { m: "select", a: ["*"] }, { m: "single", a: [] }] }), null);
  assertEquals(validWrite({ table: "missions", ops: [{ m: "update", a: [{ directive: "Build a bigger shop" }] }, { m: "eq", a: ["id", "m1"] }] }), null);
  assertEquals(validWrite({ table: "knowledge_base_entries", ops: [{ m: "delete", a: [] }, { m: "eq", a: ["id", "k1"] }] }), null);
  assertEquals(validWrite({ table: "agent_events", ops: [{ m: "insert", a: [[{ agent_id: "a1", payload: { ok: true } }, { agent_id: "a1", payload: {} }]] }] }), null, "several rows at once");
  assertEquals(validWrite({ table: "agent_runs", ops: [{ m: "insert", a: [{ agent_id: "a1", instruction: "Run the weekly report" }] }] }), null);
  assertEquals(validWrite({ table: "pending_approvals", ops: [{ m: "signoff", a: [{ approval_id: A, vote: "approve", comment: "Looks right", reason_code: null }] }] }), null);
});

Deno.test("anything else is refused", () => {
  assertEquals(validWrite(null), "unknown table");
  assertEquals(validWrite({ table: "api_keys", ops: [{ m: "insert", a: [{}] }] }), "unknown table", "only the listed encrypted tables");
  assertEquals(validWrite({ table: "outer_control_sessions", ops: [{ m: "insert", a: [{}] }] }), "unknown table", "encrypted but written only by the server");
  assertEquals(validWrite({ table: "agent_runs", ops: [{ m: "update", a: [{ summary: "x" }] }, { m: "eq", a: ["id", "r1"] }] }), "not allowed on agent_runs: update");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "upsert", a: [{}] }] }), "not allowed on missions: upsert");
  assertEquals(validWrite({ table: "pending_approvals", ops: [{ m: "update", a: [{ comment: "x" }] }, { m: "eq", a: ["id", A] }] }), "not allowed on pending_approvals: update", "approvals change only through a sign-off");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "update", a: [{ directive: "x" }] }] }), "update needs a filter saying which rows");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "delete", a: [] }, { m: "select", a: ["id"] }] }), "delete needs a filter saying which rows");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "insert", a: [[]] }] }), "insert needs 1 to 50 rows of plain data");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "insert", a: [Array(51).fill({ directive: "x" })] }] }), "insert needs 1 to 50 rows of plain data");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "insert", a: [{ directive: "x" }] }, { m: "rpc", a: ["f"] }] }), "not allowed: rpc");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "update", a: [{ directive: "x" }] }, { m: "select", a: ["id"] }, { m: "eq", a: ["id", "m1"] }] }), "filters come before select");
  assertEquals(validWrite({ table: "missions", ops: [{ m: "insert", a: [{ directive: "x".repeat(2_000_001) }] }] }), "too large");
});

Deno.test("a sign-off needs a real approval id, a vote and a short comment", () => {
  const so = (x: unknown, more: unknown[] = []) => validWrite({ table: "pending_approvals", ops: [{ m: "signoff", a: [x] }, ...more] });
  assertEquals(so({ approval_id: "not-a-uuid", vote: "approve" }), "signoff needs approval_id and vote");
  assertEquals(so({ approval_id: A, vote: "maybe" }), "signoff needs approval_id and vote");
  assertEquals(so({ approval_id: A, vote: "reject", comment: "x".repeat(801) }), "the comment is at most 800 characters");
  assertEquals(so({ approval_id: A, vote: "reject", reason_code: 3 }), "invalid reason_code");
  assertEquals(so({ approval_id: A, vote: "approve" }, [{ m: "eq", a: ["id", A] }]), "signoff needs approval_id and vote", "nothing chained after a sign-off");
});
