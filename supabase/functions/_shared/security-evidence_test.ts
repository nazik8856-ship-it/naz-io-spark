import { cleanSubject, noteOutboundBlock, OUTBOUND_BLOCK_RE, recordEvidence, rulesDigest, sha256Of, sha256Text } from "./security-evidence.ts";
import { OutboundBlocked } from "./outbound-guard.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

const fakeAdmin = (result: { data?: unknown; error?: { message: string } | null } = { data: 7, error: null }) => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return { calls, rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: result.data ?? null, error: result.error ?? null }; } };
};

Deno.test("a row is written through record_evidence with ids and hashes only", async () => {
  const admin = fakeAdmin();
  const h = await sha256Text("the request body");
  const r = await recordEvidence(admin, {
    userId: "u-1", kind: "connector_call", actor: "agent", actorId: "agent-1",
    subject: { action: "send_email", agent: "agent-1", body: "x".repeat(500), nested: { a: 1 } as unknown as string },
    inputSha256: h, verdict: "allowed",
  });
  assert(r.ok); assertEquals(r.id, 7);
  assertEquals(admin.calls[0].name, "record_evidence");
  const a = admin.calls[0].args;
  assertEquals(a._input_sha256, h);
  assertEquals((a._subject as Record<string, unknown>).body, "x".repeat(120), "long strings are clipped");
  assertEquals((a._subject as Record<string, unknown>).nested, undefined, "objects are dropped");
});

Deno.test("no database, an error, a bad hash or a bad verdict: not ok (so a connector call does not go ahead)", async () => {
  assertEquals((await recordEvidence(fakeAdmin({ error: { message: "the security evidence key is missing" } }), { userId: "u", kind: "connector_call", actor: "system", verdict: "allowed" })).ok, false);
  assertEquals((await recordEvidence({}, { userId: "u", kind: "connector_call", actor: "system", verdict: "allowed" })).ok, false);
  assertEquals((await recordEvidence(fakeAdmin(), { userId: "u", kind: "rule_applied", actor: "system", inputSha256: "not-a-hash", verdict: "allow" })).ok, false);
  assertEquals((await recordEvidence(fakeAdmin(), { userId: "u", kind: "rule_applied", actor: "system", verdict: "Allow it!" })).ok, false);
  assertEquals((await recordEvidence(fakeAdmin(), { userId: "", kind: "rule_applied", actor: "system", verdict: "allow" })).ok, false);
});

Deno.test("an actor id or rule id that is not a plain id is left out, never written", async () => {
  const admin = fakeAdmin();
  await recordEvidence(admin, { userId: "u", kind: "rule_applied", actor: "api_key", actorId: "key 1; drop", ruleIds: ["builtin:secrets", "bad id with spaces"], verdict: "modify" });
  assertEquals(admin.calls[0].args._actor_id, null);
  assertEquals(admin.calls[0].args._rule_ids, ["builtin:secrets"]);
});

Deno.test("hashes: text, JSON values and the rule set", async () => {
  assertEquals(await sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assertEquals(await sha256Of({ a: 1 }), await sha256Text('{"a":1}'));
  const a = await rulesDigest([{ id: "r2", updated_at: "t2" }, { id: "r1", updated_at: "t1" }]);
  assertEquals(a, await rulesDigest([{ id: "r1", updated_at: "t1" }, { id: "r2", updated_at: "t2" }]), "order does not matter");
  assert(a !== await rulesDigest([{ id: "r1", updated_at: "t1" }, { id: "r2", updated_at: "t3" }]), "a changed rule changes the digest");
  assertEquals(await rulesDigest([{ id: "r1", updated_at: "t1" }, { id: "r9", shadow_mode: true }]), await rulesDigest([{ id: "r1", updated_at: "t1" }]), "shadow rules are not in force");
});

Deno.test("an outbound-guard refusal is recognised and recorded with the host and the credential's name", async () => {
  const err = new OutboundBlocked("refused: the request to evil.example carried a NazAI credential (OPENAI_API_KEY)");
  assert(OUTBOUND_BLOCK_RE.test(err.message));
  const admin = fakeAdmin();
  assertEquals(await noteOutboundBlock(admin, "u-1", err, "agent", "a-1", { run: "r-1" }), true);
  assertEquals(admin.calls[0].args._kind, "outbound_blocked");
  assertEquals(admin.calls[0].args._subject, { run: "r-1", host: "evil.example", credential: "OPENAI_API_KEY" });
  assertEquals(await noteOutboundBlock(fakeAdmin(), "u-1", "network error", "agent", null), false);
});

Deno.test("cleanSubject keeps at most 12 short scalar values", () => {
  const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
  assertEquals(Object.keys(cleanSubject(big)).length, 12);
  assertEquals(cleanSubject({ a: null, b: true, c: undefined }), { a: null, b: true });
});
